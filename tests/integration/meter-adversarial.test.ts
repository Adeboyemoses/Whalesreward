import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { StorageNotFoundError } from "../../src/server/adapters/storage";
import { newId } from "../../src/server/lib/ids";
import { createReviewsService } from "../../src/server/modules/reviews/service";
import { createCorrectionsService } from "../../src/server/modules/corrections/service";
import { createSyncService } from "../../src/server/modules/sync/service";
import { fixtureId, newSession } from "../helpers/sync-fixture";
import {
  activate,
  replacement,
  seedHistorical,
  S,
  U,
  expiry,
} from "../helpers/review-evidence-fixture";
import {
  meterDatabase,
  meterFixture,
  meterDecide,
  meterDenied,
  meterSucceeded,
  meterState,
  installMeterPolicy,
  profileVariant,
  addMeterPrice,
} from "../helpers/meter-fixture";
import { createHash, randomBytes } from "node:crypto";

type Fixture = Awaited<ReturnType<typeof meterFixture>>;
let db: Awaited<ReturnType<typeof meterDatabase>>;
const micros = (instant: string) => String(BigInt(Date.parse(instant)) * 1000n);
function service(
  x: Fixture,
  storage = x.h.storage,
  env: Readonly<Record<string, string | undefined>> = x.env,
) {
  return createReviewsService({ pool: db.pool, storage, env });
}
async function bounds(x: Fixture, start = S, receipt = U, expires = expiry) {
  await seedHistorical(
    db.pool,
    "capture_context",
    "UPDATE capture_context SET signed_in_at=$2,offline_expires_at=$3 WHERE id=$1",
    [x.f.contextId, start, expires],
  );
  await seedHistorical(
    db.pool,
    "purchase",
    "UPDATE purchase SET server_received_at=$2,capture_lower_bound=$3 WHERE id=$1",
    [x.sale.purchaseId, receipt, start],
  );
}
async function frozen(x: Fixture, at: string, valid = true) {
  const link = (
    await db.pool.query(
      "SELECT id,customer_id FROM card_customer_link WHERE card_id=$1 AND ended_at IS NULL",
      [fixtureId(29)],
    )
  ).rows[0];
  const context = (
    await db.pool.query(
      "SELECT offline_expires_at FROM capture_context WHERE id=$1",
      [x.f.contextId],
    )
  ).rows[0];
  await seedHistorical(
    db.pool,
    "purchase",
    "UPDATE purchase SET lookup_receipt_status='valid',lookup_receipt_claims=$2,capture_lower_bound=$3,capture_policy_version='lookup-v1' WHERE id=$1",
    [
      x.sale.purchaseId,
      {
        version: 1,
        purpose: "capture_lookup",
        cardCode: "A7K3M9Q",
        captureContextId: x.f.contextId,
        originatingAccountId: x.f.attendantId,
        stationId: valid ? x.f.stationId : newId(),
        cardId: fixtureId(29),
        customerId: link.customer_id,
        cardCustomerLinkId: link.id,
        issuedAt: new Date(at).toISOString(),
        expiresAt: context.offline_expires_at.toISOString(),
      },
      at,
    ],
  );
}
async function inactive(x: Fixture, revision = 2) {
  const policy = {
    ...x.meterPolicy,
    revision,
    activation: {
      state: "inactive",
      approvalReference: null,
      activatedAt: null,
    },
  };
  await db.pool.query(
    "INSERT INTO meter_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,'test',$3,$4,'Fictional deactivation')",
    [newId(), x.f.stationId, revision, policy],
  );
  return policy;
}
async function addHold(x: Fixture, kind: "card" | "date" | "price") {
  const id = newId();
  await db.pool.query(
    "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,$3,'open',$4,$5,1)",
    [
      id,
      x.sale.purchaseId,
      kind,
      x.original,
      kind === "card"
        ? "replaced_card"
        : kind === "date"
          ? "capture_date_uncertain"
          : "price_uncertain",
    ],
  );
  await db.pool.query("UPDATE purchase SET version=version+1 WHERE id=$1", [
    x.sale.purchaseId,
  ]);
  return id;
}
async function count(x: Fixture) {
  return (
    await db.pool.query(
      "SELECT (SELECT count(*)::int FROM meter_evaluation WHERE purchase_id=$1) evaluations,(SELECT count(*)::int FROM purchase_revision WHERE purchase_id=$1 AND state='accepted') accepted,(SELECT count(*)::int FROM sale_decision WHERE purchase_id=$1 AND outcome='correct_meter') decisions",
      [x.sale.purchaseId],
    )
  ).rows[0];
}
async function pendingProposal(x: Fixture) {
  const correction = newId(),
    revision = newId(),
    operation = newId();
  const session = (
    await db.pool.query(
      "SELECT id FROM auth_session WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
      [fixtureId(2)],
    )
  ).rows[0].id;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO correction_request(id,purchase_id,originating_attendant_id,operation_id,payload_digest,frozen_request_digest,based_on_revision_id,expected_purchase_version,proposed_revision_id,first_received_at,cutoff_at_receipt,time_policy_version,timing,state,reason,submitted_by_user_id,verified_author_attendant_id,authorship,recovery_executor_id,recovery_authorizing_admin_id,policy_blocks,version,authority_session_id,reserved_purchase_version,receipt) VALUES($1,$2,$3,$4,'fictional recovery','fictional recovery',$5,$6,$7,'2026-11-10T12:00:00Z','2026-11-10T23:00:00Z','p20-bounded-day-v1','before_midnight','awaiting_review','Fictional recovered numeric proposal',$8,NULL,'unverified_recovery',$9,$9,ARRAY['correction_authorship_unverified'],1,$10,$6+1,'{}')",
      [
        correction,
        x.sale.purchaseId,
        x.f.attendantId,
        operation,
        x.original,
        (await x.h.guard(x.sale.purchaseId)).expectedVersion,
        revision,
        fixtureId(2),
        fixtureId(5),
        session,
      ],
    );
    await client.query(
      "INSERT INTO purchase_revision SELECT (jsonb_populate_record(NULL::purchase_revision,to_jsonb(r)||jsonb_build_object('id',$2::text,'operation_id',$3::text,'revision_number',2,'kind','admin_correction','actor_user_id',$5::text,'reason','Fictional recovered numeric proposal','amount_kobo','3000000','quantity','30','entered_amount_kobo','3000000','based_on_revision_id',r.id,'correction_id',$4::text))).* FROM purchase_revision r WHERE r.id=$1",
      [x.original, revision, operation, correction, fixtureId(2)],
    );
    await client.query("UPDATE purchase SET version=version+1 WHERE id=$1", [
      x.sale.purchaseId,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const snapshot = (
    await db.pool.query("SELECT * FROM correction_request WHERE id=$1", [
      correction,
    ])
  ).rows;
  return { correction, snapshot };
}

describe("P-26 PostgreSQL adversarial bounds, authority and independent gates", () => {
  beforeAll(async () => {
    vi.stubEnv("WHR_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    db = await meterDatabase();
  }, 30000);
  afterAll(async () => {
    await db?.close();
    vi.unstubAllEnvs();
  });

  it.each([true, false])(
    "MR-T1-14 frozen P-23 valid=%s uses max(S,T), otherwise original S",
    async (valid) => {
      const x = await meterFixture(db);
      await frozen(x, "2026-11-10T12:30:00Z", valid);
      const { provenance } = await meterSucceeded(x);
      expect(provenance.interval.L).toBe(
        micros(valid ? "2026-11-10T12:30:00Z" : S),
      );
      expect(provenance.lookup.status).toBe(valid ? "frozen" : "fallback");
    },
  );
  it.each([
    ["point", S, S],
    ["before", S, U],
    ["equal", S, expiry],
    ["after", S, "2026-11-11T13:00:00Z"],
  ])(
    "MR-T1-14 receipt %s expiry retains original closed bounds",
    async (_label, start, receipt) => {
      const x = await meterFixture(db);
      await bounds(x, start, receipt);
      const { provenance } = await meterSucceeded(x);
      expect(provenance.interval).toMatchObject({
        S: micros(start!),
        R: micros(receipt!),
        L: micros(start!),
        U: micros(
          Date.parse(receipt!) > Date.parse(expiry) ? expiry : receipt!,
        ),
      });
    },
  );
  it("MR-T1-14 reversed bounds cannot produce a receipt", async () => {
    const x = await meterFixture(db);
    await bounds(x, S, "2026-11-10T11:59:59Z");
    await meterDenied(x, () => meterDecide(x), "evidence_insufficient", 422);
  });
  it("MR-T1-14 a fresh sign-in, newly issued token and replay never move frozen facts", async () => {
    const x = await meterFixture(db);
    await frozen(x, "2026-11-10T12:30:00Z");
    const fresh = await newSession(db.pool, x.f);
    const keys = {
      activeKid: "fixture",
      keys: new Map([["fixture", randomBytes(32)]]),
    };
    const online = createSyncService({
      pool: db.pool,
      storage: x.h.storage,
      lookupReceiptKeys: () => keys,
    });
    const lookup = await online.lookup(
      fresh.token,
      { source: "code", code: "A7K3M9Q" },
      true,
    );
    expect(lookup.lookupReceipt).toEqual(expect.any(String));
    await x.h.sync.submit(fresh.token, x.sale.original);
    const { provenance, result } = await meterSucceeded(x);
    expect(provenance.interval).toMatchObject({
      S: micros(S),
      R: micros(U),
      L: micros("2026-11-10T12:30:00Z"),
      U: micros(U),
      expiry: micros(expiry),
    });
    const before = await meterState(x);
    expect(await meterDecide(x)).toEqual(result);
    expect(await meterState(x)).toEqual(before);
  });
  it.each([
    "foreign",
    "missing",
    "deleted",
    "unvalidated",
    "placeholder",
    "digest-only",
    "transient",
  ])(
    "MR-T1-14 %s photo cannot be sufficient inspectable bound bytes",
    async (mode) => {
      const x = await meterFixture(db);
      if (mode === "deleted")
        await seedHistorical(
          db.pool,
          "photo_asset",
          "UPDATE photo_asset SET deleted_at=clock_timestamp() WHERE id=$1",
          [x.sale.assetId],
        );
      if (mode === "unvalidated")
        await seedHistorical(
          db.pool,
          "photo_asset",
          "UPDATE photo_asset SET state='staged' WHERE id=$1",
          [x.sale.assetId],
        );
      const storage = {
        ...x.h.storage,
        async read(key: string, max: number) {
          if (mode === "missing") throw new StorageNotFoundError();
          if (mode === "transient") throw new Error("private storage failure");
          if (mode === "placeholder")
            return Buffer.from("not an inspectable photo");
          if (mode === "digest-only")
            return Buffer.from(x.f.original.photo.sha256);
          return x.h.storage.read(key, max);
        },
      };
      const body =
        mode === "foreign"
          ? { ...x.body, evidence: { ...x.evidence, assetId: newId() } }
          : x.body;
      await meterDenied(
        x,
        () => meterDecide(x, body, service(x, storage)),
        mode === "transient"
          ? "temporarily_unavailable"
          : "evidence_unavailable",
        mode === "transient" ? 503 : 422,
      );
    },
  );

  it.each(["sales", "priceReview"])(
    "MR-T1-15 missing %s never grants meter review",
    async (permission) => {
      const x = await meterFixture(db);
      await db.pool.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code=$2",
        [fixtureId(1), permission],
      );
      try {
        await meterDenied(x, () => meterDecide(x), "permission_denied", 403);
      } finally {
        await db.pool.query(
          "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [fixtureId(1), permission],
        );
      }
    },
  );
  it.each([
    "disabled-account",
    "disabled-role",
    "first-password",
    "revoked",
    "auth-version",
    "recovery",
  ])("MR-T1-15 %s session has no meter authority", async (mode) => {
    const x = await meterFixture(db);
    const session = (
      await db.pool.query(
        "SELECT id FROM auth_session WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
        [fixtureId(2)],
      )
    ).rows[0].id;
    if (mode === "disabled-account")
      await db.pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
        fixtureId(2),
      ]);
    if (mode === "disabled-role")
      await db.pool.query(
        "UPDATE role SET enabled=false,version=version+1 WHERE id=$1",
        [fixtureId(1)],
      );
    if (mode === "first-password")
      await seedHistorical(
        db.pool,
        "auth_session",
        "UPDATE auth_session SET access_scope='first_password' WHERE id=$1",
        [session],
      );
    if (mode === "revoked")
      await db.pool.query(
        "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1",
        [session],
      );
    if (mode === "auth-version")
      await db.pool.query(
        "UPDATE auth_user SET auth_version=auth_version+1 WHERE id=$1",
        [fixtureId(2)],
      );
    const before = await meterState(x);
    try {
      await expect(
        mode === "recovery"
          ? service(x).decidePrice(
              undefined,
              x.sale.purchaseId,
              x.holdId,
              x.body,
            )
          : meterDecide(x),
      ).rejects.toBeDefined();
      expect(await meterState(x)).toEqual(before);
    } finally {
      await db.pool.query(
        "UPDATE auth_user SET enabled=true,auth_version=1 WHERE id=$1",
        [fixtureId(2)],
      );
      await db.pool.query(
        "UPDATE role SET enabled=true,version=version+1 WHERE id=$1",
        [fixtureId(1)],
      );
    }
  });
  it("MR-T1-15 permission revoked during photo inspection denies all domain writes", async () => {
    const x = await meterFixture(db);
    let once = false;
    const storage = {
      ...x.h.storage,
      async read(key: string, max: number) {
        const bytes = await x.h.storage.read(key, max);
        if (!once) {
          once = true;
          await db.pool.query(
            "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='priceReview'",
            [fixtureId(1)],
          );
        }
        return bytes;
      },
    };
    try {
      await meterDenied(
        x,
        () => meterDecide(x, x.body, service(x, storage)),
        "permission_denied",
        403,
      );
    } finally {
      await db.pool.query(
        "INSERT INTO role_permission(role_id,permission_code) VALUES($1,'priceReview') ON CONFLICT DO NOTHING",
        [fixtureId(1)],
      );
    }
  });

  it.each(["settings", "corrections"])(
    "MR-T1-15 %s alone is not meter-review authority",
    async (permission) => {
      const x = await meterFixture(db);
      const saved = (
        await db.pool.query(
          "SELECT permission_code FROM role_permission WHERE role_id=$1",
          [fixtureId(1)],
        )
      ).rows.map((r) => r.permission_code);
      await db.pool.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code<>$2",
        [fixtureId(1), permission],
      );
      try {
        await meterDenied(x, () => meterDecide(x), "permission_denied", 403);
      } finally {
        await db.pool.query(
          "INSERT INTO role_permission(role_id,permission_code) SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING",
          [fixtureId(1), saved],
        );
      }
    },
  );
  it.each([true, false])(
    "MR-T1-16 concurrent same operation=%s applies once",
    async (same) => {
      const x = await meterFixture(db);
      const results = await Promise.allSettled([
        meterDecide(x),
        meterDecide(x, same ? x.body : { ...x.body, operationId: newId() }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(
        same ? 2 : 1,
      );
      if (same) expect(results[0]).toEqual(results[1]);
      expect(await count(x)).toEqual({
        evaluations: 1,
        accepted: 1,
        decisions: 1,
      });
    },
  );
  it.each(["purchase", "revision", "hold"])(
    "MR-T1-16 stale %s guard has no application",
    async (mode) => {
      const x = await meterFixture(db);
      const body = {
        ...x.body,
        ...(mode === "purchase"
          ? { expectedVersion: x.body.expectedVersion + 1 }
          : mode === "revision"
            ? { expectedRevisionId: newId() }
            : { expectedHoldVersion: 2 }),
      };
      await meterDenied(x, () => meterDecide(x, body), "version_conflict", 409);
    },
  );
  it("MR-T1-16 replay after deactivation returns immutable result but rechecks live authority", async () => {
    const x = await meterFixture(db);
    const { result } = await meterSucceeded(x);
    await inactive(x);
    const before = await meterState(x);
    expect(await meterDecide(x)).toEqual(result);
    expect(await meterState(x)).toEqual(before);
    await db.pool.query(
      "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE user_id=$1",
      [fixtureId(2)],
    );
    await expect(meterDecide(x)).rejects.toMatchObject({ status: 401 });
    expect(await meterState(x)).toEqual(before);
  });
  it.each([
    "amount",
    "quantity",
    "asset",
    "references",
    "reason",
    "purchase-guard",
    "revision-guard",
    "hold-guard",
  ])("MR-T1-16 changed %s under same operation conflicts", async (mode) => {
    const x = await meterFixture(db);
    await meterSucceeded(x);
    const body = structuredClone(x.body);
    if (mode === "amount") body.decision.amountKobo = "1100001";
    if (mode === "quantity") body.decision.quantity = "10.001";
    if (mode === "asset") body.evidence.assetId = newId();
    if (mode === "references") body.evidence.referenceIds = [newId()];
    if (mode === "reason") body.reason = "Different reviewed reason";
    if (mode === "purchase-guard") body.expectedVersion++;
    if (mode === "revision-guard") body.expectedRevisionId = newId();
    if (mode === "hold-guard") body.expectedHoldVersion++;
    await meterDenied(x, () => meterDecide(x, body), "operation_conflict", 409);
  });

  it("MR-T1-16 finalization racing meter confirmation leaves one exact accepted contribution", async () => {
    const x = await meterFixture(db);
    const fresh = await newSession(db.pool, x.f);
    const results = await Promise.allSettled([
      meterDecide(x),
      x.h.sync.finalize(fresh.token, x.sale.purchaseId, {
        operationId: newId(),
        expectedVersion: x.body.expectedVersion,
        uploadId: x.sale.assetId,
      }),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(await count(x)).toEqual({
      evaluations: 1,
      accepted: 1,
      decisions: 1,
    });
    const r = (
      await db.pool.query(
        "SELECT amount_kobo,quantity FROM purchase_revision WHERE purchase_id=$1 AND state='accepted'",
        [x.sale.purchaseId],
      )
    ).rows[0];
    expect(r).toEqual({ amount_kobo: "1100000", quantity: "10.000000" });
  });
  it("MR-T1-16 ordinary correction racing meter confirmation cannot overwrite the winner", async () => {
    const x = await meterFixture(db);
    await seedHistorical(
      db.pool,
      "purchase_revision",
      "UPDATE purchase_revision SET state='accepted' WHERE id=$1",
      [x.original],
    );
    await seedHistorical(
      db.pool,
      "purchase",
      "UPDATE purchase SET current_revision_id=$2 WHERE id=$1",
      [x.sale.purchaseId, x.original],
    );
    const fresh = await newSession(db.pool, x.f),
      guard = await x.h.guard(x.sale.purchaseId);
    const corrections = createCorrectionsService({
      pool: db.pool,
      storage: x.h.storage,
    });
    const results = await Promise.allSettled([
      meterDecide(x, { ...x.body, ...guard }),
      corrections.submit(fresh.token, x.sale.purchaseId, {
        operationId: newId(),
        expectedVersion: guard.expectedVersion,
        basedOnRevisionId: x.original,
        edit: { basis: "amount", enteredAmountKobo: "1200000" },
        evidenceAssetId: x.sale.assetId,
        reason: "Fictional ordinary correction",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { status: 409 },
    });
    expect((await count(x)).evaluations).toBe(
      results[0].status === "fulfilled" ? 1 : 0,
    );
  });
  it("MR-T1-16 another hold resolution racing meter correction requires a fresh aggregate guard", async () => {
    const x = await meterFixture(db),
      date = await addHold(x, "date"),
      guard = await x.h.guard(x.sale.purchaseId),
      svc = service(x);
    const results = await Promise.allSettled([
      meterDecide(x, { ...x.body, ...guard }, svc),
      svc.decideDate(x.token, x.sale.purchaseId, date, {
        ...guard,
        operationId: newId(),
        expectedHoldVersion: 1,
        evidence: x.evidence,
        verifiedSaleDate: "2026-11-10",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "version_conflict" },
    });
    expect((await count(x)).accepted).toBe(0);
  });

  it.each([
    "price,card,date",
    "price,date,card",
    "card,price,date",
    "card,date,price",
    "date,price,card",
    "date,card,price",
  ])(
    "MR-T1-17 order %s preserves exact meter candidate and every independent block",
    async (order) => {
      const x = await meterFixture(db);
      await bounds(x, "2026-11-09T13:00:00Z", "2026-11-10T14:00:00Z", U);
      await frozen(x, S);
      await replacement(x, "2026-11-10T13:00:00.000001Z");
      const ids = {
        price: x.holdId,
        card: await addHold(x, "card"),
        date: await addHold(x, "date"),
      };
      await db.pool.query(
        "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_authorization_unresolved','fixture',clock_timestamp(),1)",
        [newId(), x.sale.purchaseId],
      );
      await db.pool.query(
        "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'eligibility_configuration_unset','fixture',clock_timestamp(),1)",
        [newId(), x.sale.purchaseId],
      );
      await seedHistorical(
        db.pool,
        "settings_version",
        "UPDATE settings_version SET purchase_cutoff=$2,upload_deadline=$2 WHERE station_id=$1",
        [x.f.stationId, U],
      );
      await seedHistorical(
        db.pool,
        "sync_validation",
        "UPDATE sync_validation SET campaign_eligible=false WHERE purchase_id=$1",
        [x.sale.purchaseId],
      );
      const proposal = await pendingProposal(x);
      const validation = (
        await db.pool.query(
          "SELECT * FROM sync_validation WHERE purchase_id=$1",
          [x.sale.purchaseId],
        )
      ).rows;
      const svc = service(x);
      let remaining = 3,
        corrected = false;
      for (const kind of order.split(",") as ("price" | "card" | "date")[]) {
        const b = {
          ...(await x.h.guard(x.sale.purchaseId)),
          expectedHoldVersion: 1,
          evidence: x.evidence,
        };
        const result =
          kind === "price"
            ? await svc.decidePrice(x.token, x.sale.purchaseId, ids.price, {
                ...b,
                decision: x.body.decision,
              })
            : kind === "card"
              ? await svc.decideCard(x.token, x.sale.purchaseId, ids.card, {
                  ...b,
                  outcome: "confirm_earlier",
                })
              : await svc.decideDate(x.token, x.sale.purchaseId, ids.date, {
                  ...b,
                  verifiedSaleDate: "2026-11-10",
                });
        corrected ||= kind === "price";
        expect(result.remainingHolds).toHaveLength(--remaining);
        expect(result.creditedAfter).toBe(false);
        expect(result.after.amountKobo).toBe("1100000");
        expect(result.after.quantity).toBe(corrected ? "10" : "11");
        expect(result.policyBlocks).toContain(
          "capture_authorization_unresolved",
        );
        expect(result.policyBlocks).toContain(
          "eligibility_configuration_unset",
        );
        expect(
          (
            await db.pool.query(
              "SELECT * FROM correction_request WHERE id=$1",
              [proposal.correction],
            )
          ).rows,
        ).toEqual(proposal.snapshot);
        expect(
          (
            await db.pool.query(
              "SELECT * FROM sync_validation WHERE purchase_id=$1",
              [x.sale.purchaseId],
            )
          ).rows,
        ).toEqual(validation);
        const p = (
          await db.pool.query(
            "SELECT current_revision_id,resolution_candidate_revision_id FROM purchase WHERE id=$1",
            [x.sale.purchaseId],
          )
        ).rows[0];
        expect(p.current_revision_id).toBeNull();
        expect(p.resolution_candidate_revision_id).not.toBeNull();
      }
      const result = await svc.decideCapture(x.token, x.sale.purchaseId, {
        ...(await x.h.guard(x.sale.purchaseId)),
        outcome: "confirm",
        evidence: x.evidence,
      });
      expect(result.creditedAfter).toBe(false);
      expect(result.after).toMatchObject({
        amountKobo: "1100000",
        quantity: "10",
        calculation: "meter_evidence",
        rateKobo: "100000",
      });
      expect(await count(x)).toEqual({
        evaluations: 1,
        accepted: 0,
        decisions: 1,
      });
    },
  );
  it.each([
    "eligibility_configuration_unset",
    "capture_time_unresolved",
    "correction_authorship_unverified",
  ])(
    "MR-T1-17 meter correction leaves %s unresolved and uncredited",
    async (code) => {
      const x = await meterFixture(db);
      await db.pool.query(
        "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,$3,'fixture',clock_timestamp(),1)",
        [newId(), x.sale.purchaseId, code],
      );
      const { result } = await meterSucceeded(x);
      expect(result.creditedAfter).toBe(false);
      expect(result.policyBlocks).toContain(code);
    },
  );
  it("MR-T1-17 ordinary P-22 edit cannot recalculate a meter-evidence base", async () => {
    const x = await meterFixture(db),
      { revisionId } = await meterSucceeded(x),
      fresh = await newSession(db.pool, x.f),
      guard = await x.h.guard(x.sale.purchaseId);
    await meterDenied(
      x,
      () =>
        createCorrectionsService({
          pool: db.pool,
          storage: x.h.storage,
        }).submit(fresh.token, x.sale.purchaseId, {
          operationId: newId(),
          expectedVersion: guard.expectedVersion,
          basedOnRevisionId: revisionId,
          edit: { basis: "amount", enteredAmountKobo: "1200000" },
          evidenceAssetId: x.sale.assetId,
          reason: "Attempted ordinary edit",
        }),
      "sale_not_correctable",
      409,
    );
  });

  it.each([
    "meter-deactivate",
    "resolver-deactivate",
    "resolver-generation",
    "profile",
    "history",
  ])(
    "MR-T1-18 %s during photo inspection prevents obsolete-snapshot application",
    async (mode) => {
      const x = await meterFixture(db);
      let once = false;
      const storage = {
        ...x.h.storage,
        async read(key: string, max: number) {
          const bytes = await x.h.storage.read(key, max);
          if (!once) {
            once = true;
            if (mode === "meter-deactivate") await inactive(x);
            if (mode === "resolver-deactivate")
              await activate(db.pool, x.f.stationId, 2, false);
            if (mode === "resolver-generation")
              await activate(db.pool, x.f.stationId, 2, true);
            if (mode === "profile")
              await installMeterPolicy(
                x,
                [profileVariant(x.profile, { amountStepKobo: "5" })],
                2,
              );
            if (mode === "history")
              await addMeterPrice(x, "2026-11-10T12:30:00Z", "120000", 3, 3);
          }
          return bytes;
        },
      };
      await meterDenied(
        x,
        () => meterDecide(x, x.body, service(x, storage)),
        mode === "history"
          ? "evidence_insufficient"
          : "meter_policy_unconfigured",
        mode === "history" ? 422 : 409,
      );
    },
  );
  it("MR-T1-18 concurrent deactivation serializes with the complete approved snapshot", async () => {
    const x = await meterFixture(db),
      before = await meterState(x);
    const results = await Promise.allSettled([meterDecide(x), inactive(x)]);
    expect(results[1].status).toBe("fulfilled");
    if (results[0].status === "fulfilled") {
      expect(await count(x)).toEqual({
        evaluations: 1,
        accepted: 1,
        decisions: 1,
      });
    } else {
      expect(results[0].reason).toMatchObject({
        code: "meter_policy_unconfigured",
      });
      expect(await meterState(x)).toEqual(before);
    }
  });
  it("MR-T1-18 rollback needs new higher approval and does not automatically release holds", async () => {
    const x = await meterFixture(db);
    await inactive(x);
    const before = await meterState(x);
    const saved = (
      await db.pool.query("SELECT * FROM meter_configuration ORDER BY revision")
    ).rows;
    const policy = await installMeterPolicy(x, [x.profile], 3);
    expect(await meterState(x)).toEqual(before);
    expect(
      (
        await db.pool.query(
          "SELECT * FROM meter_configuration WHERE revision<3 ORDER BY revision",
        )
      ).rows,
    ).toEqual(saved);
    await expect(installMeterPolicy(x, [x.profile], 1)).rejects.toThrow();
    await meterSucceeded(
      x,
      x.body,
      service(x, x.h.storage, {
        ...x.env,
        WHR_METER_POLICY: JSON.stringify(policy),
      }),
    );
  });
  it.each(["missing", "malformed", "digest", "inactive"])(
    "MR-T1-18 %s resolver never enables populated meter profiles",
    async (mode) => {
      const x = await meterFixture(db);
      const env = {
        ...x.env,
        WHR_REVIEW_EVIDENCE_POLICY:
          mode === "missing"
            ? undefined
            : mode === "malformed"
              ? "{"
              : JSON.stringify(
                  mode === "digest"
                    ? { ...x.config, digest: "a".repeat(64) }
                    : {
                        ...x.config,
                        activation: {
                          state: "inactive",
                          approvalReference: null,
                          activatedAt: null,
                        },
                      },
                ),
      };
      await meterDenied(
        x,
        () => meterDecide(x, x.body, service(x, x.h.storage, env)),
        "meter_policy_unconfigured",
        409,
      );
    },
  );

  it("MR-T1-19 exact retained profile, historical rate and artifact bytes reproduce the unrounded comparison", async () => {
    const x = await meterFixture(db, {
      amountKobo: "1234567",
      quantity: "11.223",
    });
    const { provenance: p, revisionId } = await meterSucceeded(x);
    expect(p.transcription).toEqual({
      kind: "human",
      submitted: { amountKobo: "1234567", quantity: "11.223" },
    });
    expect(
      createHash("sha256").update(p.artifacts.evaluator).digest("hex"),
    ).toBe(p.policy.digest);
    expect(
      createHash("sha256").update(p.artifacts.resolver).digest("hex"),
    ).toBe(p.resolver.digest);
    expect(p.reconciliation.rateKobo).toBe("110000");
    const decimal = (value: string) => {
      const [whole, fraction = ""] = value.split(".");
      return {
        numerator: BigInt(whole! + fraction),
        denominator: 10n ** BigInt(fraction.length),
      };
    };
    const transcribed = decimal(p.transcription.submitted.quantity);
    const retained = p.profileRecords.find(
      (r: { profile_id: string }) =>
        r.profile_id === p.reconciliation.profile.id,
    ).profile_content;
    const step = decimal(retained.quantityStep);
    const historical = BigInt(p.reconciliation.rateKobo),
      amount = BigInt(p.transcription.submitted.amountKobo);
    const delta =
      amount * transcribed.denominator - historical * transcribed.numerator;
    const residual = delta < 0n ? -delta : delta;
    expect(
      BigInt(p.reconciliation.residual.numerator) * transcribed.denominator,
    ).toBe(residual * BigInt(p.reconciliation.residual.denominator));
    const allowance =
      historical * step.numerator +
      BigInt(retained.amountStepKobo) * step.denominator;
    expect(
      BigInt(p.reconciliation.allowance.numerator) * 2n * step.denominator,
    ).toBe(allowance * BigInt(p.reconciliation.allowance.denominator));
    expect(BigInt(p.reconciliation.residual.numerator)).toBe(
      37n * BigInt(p.reconciliation.residual.denominator),
    );
    expect(BigInt(p.reconciliation.allowance.numerator) * 2n).toBe(
      111n * BigInt(p.reconciliation.allowance.denominator),
    );
    expect(p.target).toMatchObject({
      originalRevisionId: x.original,
      evaluatedRevisionId: x.original,
      predecessorRevisionId: x.original,
      resultRevisionId: revisionId,
    });
    expect(p.interval).toEqual(p.reconciliation.interval);
    expect(p.interval.L).toBe(micros(S));
    expect(p.result).toMatchObject({
      resultingRevisionId: revisionId,
      remainingHolds: [],
      remainingBlocks: [],
      credited: true,
    });
    const output = JSON.stringify(p);
    expect(output).not.toContain("final_key");
    expect(output).not.toContain("secret_verifier");
  });
  it("MR-T1-19 failed audit insert rolls back revision, evaluation, hold and contribution atomically", async () => {
    const x = await meterFixture(db);
    await db.pool.query(
      "CREATE FUNCTION reject_meter_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='price_corrected' THEN RAISE EXCEPTION 'fictional audit failure'; END IF; RETURN NEW; END $$",
    );
    await db.pool.query(
      "CREATE TRIGGER fixture_meter_audit_failure BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_meter_audit()",
    );
    try {
      const before = await meterState(x);
      await expect(meterDecide(x)).rejects.toThrow("fictional audit failure");
      expect(await meterState(x)).toEqual(before);
    } finally {
      await db.pool.query(
        "DROP TRIGGER fixture_meter_audit_failure ON audit_event",
      );
      await db.pool.query("DROP FUNCTION reject_meter_audit()");
    }
  });
  it("MR-T1-17 meter confirmation preserves unmet campaign eligibility and receipt deadline", async () => {
    const x = await meterFixture(db);
    await seedHistorical(
      db.pool,
      "settings_version",
      "UPDATE settings_version SET purchase_cutoff=$2,upload_deadline=$2 WHERE station_id=$1",
      [x.f.stationId, U],
    );
    await bounds(x, "2026-11-09T13:00:00Z", "2026-11-10T14:00:00Z", U);
    await frozen(x, S);
    await seedHistorical(
      db.pool,
      "sync_validation",
      "UPDATE sync_validation SET campaign_eligible=false WHERE purchase_id=$1",
      [x.sale.purchaseId],
    );
    const before = (
      await db.pool.query(
        "SELECT * FROM sync_validation WHERE purchase_id=$1",
        [x.sale.purchaseId],
      )
    ).rows;
    await meterSucceeded(x);
    expect(
      (
        await db.pool.query(
          "SELECT * FROM sync_validation WHERE purchase_id=$1",
          [x.sale.purchaseId],
        )
      ).rows,
    ).toEqual(before);
  });
  it.each(["valid", "self-cycle", "legacy", "cross-sale", "precision"])(
    "MR-T1-19 derived %s closure cannot fabricate independent evidence or narrower time",
    async (mode) => {
      const x = await meterFixture(db),
        date = await addHold(x, "date"),
        svc = service(x);
      const prior = await svc.decideDate(x.token, x.sale.purchaseId, date, {
        ...(await x.h.guard(x.sale.purchaseId)),
        expectedHoldVersion: 1,
        evidence: x.evidence,
        verifiedSaleDate: "2026-11-10",
      });
      const previous = (
        await db.pool.query(
          "SELECT provenance FROM review_evaluation WHERE decision_id=$1",
          [prior.id],
        )
      ).rows[0].provenance;
      if (mode === "self-cycle") {
        previous.sources.unshift({
          category: "derived_evidence",
          id: prior.id,
          dependencies: [],
        });
        await seedHistorical(
          db.pool,
          "review_evaluation",
          "UPDATE review_evaluation SET provenance=$2 WHERE decision_id=$1",
          [prior.id, previous],
        );
      }
      if (mode === "precision") {
        previous.conclusions[0].precision = "microsecond";
        await seedHistorical(
          db.pool,
          "review_evaluation",
          "UPDATE review_evaluation SET provenance=$2 WHERE decision_id=$1",
          [prior.id, previous],
        );
      }
      if (mode === "legacy" || mode === "cross-sale")
        await seedHistorical(
          db.pool,
          "review_evaluation",
          "DELETE FROM review_evaluation WHERE decision_id=$1",
          [prior.id],
        );
      if (mode === "cross-sale") {
        const fresh = await newSession(db.pool, x.f),
          other = await x.h.settle({ ...x.f, ...fresh }, x.bytes, {
            captureContextId: fresh.contextId,
            quantityPrecision: 3,
          });
        await seedHistorical(
          db.pool,
          "sale_decision",
          "UPDATE sale_decision SET purchase_id=$2 WHERE id=$1",
          [prior.id, other.purchaseId],
        );
      }
      const body = {
        ...x.body,
        ...(await x.h.guard(x.sale.purchaseId)),
        evidence: { ...x.evidence, referenceIds: [prior.id] },
      };
      if (mode !== "valid") await meterDenied(x, () => meterDecide(x, body));
      else {
        await meterDecide(x, body);
        const p = (
          await db.pool.query(
            "SELECT provenance FROM meter_evaluation WHERE purchase_id=$1",
            [x.sale.purchaseId],
          )
        ).rows[0].provenance;
        expect(p.interval).toEqual(previous.interval);
        expect(p.target.evaluatedRevisionId).not.toBe(x.original);
        expect(p.target.predecessorRevisionId).toBe(
          p.target.evaluatedRevisionId,
        );
      }
    },
  );
  it("MR-T1-19 frozen giveaway rows and source bindings remain immutable after meter acceptance", async () => {
    const x = await meterFixture(db),
      snapshot = newId(),
      campaign = (
        await db.pool.query(
          "SELECT campaign_id,id FROM settings_version WHERE station_id=$1",
          [x.f.stationId],
        )
      ).rows[0];
    await db.pool.query(
      "INSERT INTO giveaway_snapshot(id,campaign_id,settings_version_id,snapshot_number,operation_id,actor_id,reason,tie_rule,finalized_at) VALUES($1,$2,$3,1,$4,$5,'Fictional finalized history','competition',clock_timestamp())",
      [snapshot, campaign.campaign_id, campaign.id, newId(), fixtureId(5)],
    );
    await db.pool.query(
      "INSERT INTO giveaway_snapshot_source(id,snapshot_id,purchase_id,revision_id,included,exclusion_reason) VALUES($1,$2,$3,$4,false,'held')",
      [newId(), snapshot, x.sale.purchaseId, x.original],
    );
    await db.pool.query(
      "INSERT INTO giveaway_snapshot_row(id,snapshot_id,customer_id,category,qualifying_spend_kobo,currency,transaction_count,overall_rank,category_rank) VALUES($1,$2,$3,'car_owner',1,'NGN',1,1,1)",
      [newId(), snapshot, fixtureId(26)],
    );
    const snapshots = () =>
      Promise.all(
        [
          "giveaway_snapshot",
          "giveaway_snapshot_source",
          "giveaway_snapshot_row",
        ].map(
          async (table) =>
            (
              await db.pool.query(
                `SELECT to_jsonb(t) data FROM ${table} t ORDER BY id`,
              )
            ).rows,
        ),
      );
    const before = await snapshots();
    await meterSucceeded(x);
    expect(await snapshots()).toEqual(before);
    expect(
      (
        await db.pool.query(
          "SELECT reconciliation_required FROM campaign WHERE id=$1",
          [campaign.campaign_id],
        )
      ).rows[0].reconciliation_required,
    ).toBe(true);
  });
  it.each(["executor", "authorizer"])(
    "MR-T1-15 MR-T1-17 meter confirmation preserves P-19 %s exclusion and pending proposal",
    async (maker) => {
      const x = await meterFixture(db),
        correction = newId(),
        revision = newId(),
        operation = newId();
      const otherUser = newId(),
        otherAdmin = newId(),
        otherSession = newId();
      await db.pool.query(
        "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1::uuid,'admin',$1::text,$1::text,'Fictional independent admin',true,1,false,clock_timestamp())",
        [otherUser],
      );
      await db.pool.query(
        "INSERT INTO admin(id,user_id,admin_code,email_normalized,role_id,version) VALUES($1::uuid,$2,$1::text,$3,$4,1)",
        [otherAdmin, otherUser, `${otherAdmin}@example.com`, fixtureId(1)],
      );
      await db.pool.query(
        "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',1,clock_timestamp())",
        [otherSession, otherUser, "a".repeat(64)],
      );
      const executor = maker === "executor" ? fixtureId(5) : otherAdmin;
      const authorizer = maker === "authorizer" ? fixtureId(5) : otherAdmin;
      const submittedBy = maker === "executor" ? fixtureId(2) : otherUser;
      const session = (
        await db.pool.query(
          "SELECT id FROM auth_session WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
          [fixtureId(2)],
        )
      ).rows[0].id;
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO correction_request(id,purchase_id,originating_attendant_id,operation_id,payload_digest,frozen_request_digest,based_on_revision_id,expected_purchase_version,proposed_revision_id,first_received_at,cutoff_at_receipt,time_policy_version,timing,state,reason,submitted_by_user_id,verified_author_attendant_id,authorship,recovery_executor_id,recovery_authorizing_admin_id,policy_blocks,version,authority_session_id,reserved_purchase_version,receipt) VALUES($1,$2,$3,$4,'fictional recovery','fictional recovery',$5,$6,$7,'2026-11-10T12:00:00Z','2026-11-10T23:00:00Z','p20-bounded-day-v1','before_midnight','awaiting_review','Fictional recovered numeric proposal',$8,NULL,'unverified_recovery',$9,$11,ARRAY['correction_authorship_unverified'],1,$10,$6+1,'{}')",
          [
            correction,
            x.sale.purchaseId,
            x.f.attendantId,
            operation,
            x.original,
            x.body.expectedVersion,
            revision,
            submittedBy,
            executor,
            maker === "executor" ? session : otherSession,
            authorizer,
          ],
        );
        await client.query(
          "INSERT INTO purchase_revision SELECT (jsonb_populate_record(NULL::purchase_revision,to_jsonb(r)||jsonb_build_object('id',$2::text,'operation_id',$3::text,'revision_number',2,'kind','admin_correction','actor_user_id',$5::text,'reason','Fictional recovered numeric proposal','amount_kobo','3000000','quantity','30','entered_amount_kobo','3000000','based_on_revision_id',r.id,'correction_id',$4::text))).* FROM purchase_revision r WHERE r.id=$1",
          [x.original, revision, operation, correction, submittedBy],
        );
        await client.query(
          "UPDATE purchase SET version=version+1 WHERE id=$1",
          [x.sale.purchaseId],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      const proposal = (
        await db.pool.query("SELECT * FROM correction_request WHERE id=$1", [
          correction,
        ])
      ).rows;
      const body = { ...x.body, ...(await x.h.guard(x.sale.purchaseId)) };
      const { result } = await meterSucceeded(x, body);
      expect(result.after.amountKobo).toBe("1100000");
      expect(
        (
          await db.pool.query("SELECT * FROM correction_request WHERE id=$1", [
            correction,
          ])
        ).rows,
      ).toEqual(proposal);
      const { createCorrectionsService } =
        await import("../../src/server/modules/corrections/service");
      const decisionGuard = await x.h.guard(x.sale.purchaseId);
      await meterDenied(
        x,
        () =>
          createCorrectionsService({
            pool: db.pool,
            storage: x.h.storage,
          }).decide(x.token, x.sale.purchaseId, correction, {
            ...decisionGuard,
            expectedCorrectionVersion: 1,
            outcome: "approve",
          }),
        "permission_denied",
        403,
      );
    },
  );
});

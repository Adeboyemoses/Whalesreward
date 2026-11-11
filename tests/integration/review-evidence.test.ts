import { randomBytes } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { createReviewsService } from "../../src/server/modules/reviews/service";
import { newId } from "../../src/server/lib/ids";
import { StorageNotFoundError } from "../../src/server/adapters/storage";
import { fixtureId } from "../helpers/sync-fixture";
import {
  evidenceDatabase,
  evidenceFixture,
  activate,
  replacement,
  seedHistorical,
  sourceAudit,
  state,
  S,
  U,
  expiry,
  type Fixture,
  type Kind,
} from "../helpers/review-evidence-fixture";

let httpUsed = false;
let db: Awaited<ReturnType<typeof evidenceDatabase>>;
function service(
  x: Fixture,
  configuration: unknown = x.config,
  storage = x.h.storage,
) {
  return createReviewsService({
    pool: db.pool,
    storage,
    env: {
      ...process.env,
      WHR_ENV: "test",
      WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(configuration),
    },
  });
}
function decide(x: Fixture, body: unknown = x.body, svc = service(x)) {
  if (x.kind === "price")
    return svc.decidePrice(x.token, x.sale.purchaseId, x.holdId, body);
  if (x.kind === "card")
    return svc.decideCard(x.token, x.sale.purchaseId, x.holdId, body);
  if (x.kind === "date")
    return svc.decideDate(x.token, x.sale.purchaseId, x.holdId, body);
  return svc.decideCapture(x.token, x.sale.purchaseId, body);
}
async function denied(
  x: Fixture,
  operation: () => Promise<unknown>,
  code = "evidence_insufficient",
  status = 422,
) {
  const before = await state(x);
  if (code === "invalid_request")
    await expect(operation()).rejects.toMatchObject({ name: "ZodError" });
  else await expect(operation()).rejects.toMatchObject({ code, status });
  expect(await state(x)).toEqual(before);
}
async function succeeded(x: Fixture, body: unknown = x.body, svc = service(x)) {
  const originalFacts = async () =>
    (
      await db.pool.query(
        "SELECT to_jsonb(p)-ARRAY['status','version','current_revision_id','resolution_candidate_revision_id','verified_sale_date','cancellation_reason','correction_cutoff_at','correction_time_policy_version','correction_date_reliable'] AS facts FROM purchase p WHERE id=$1",
        [x.sale.purchaseId],
      )
    ).rows;
  const cards = async () =>
    (
      await db.pool.query(
        "SELECT to_jsonb(c) AS card, (SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM card_customer_link l WHERE l.card_id=c.id) AS links FROM card c ORDER BY c.id",
      )
    ).rows;
  const originalBefore = await originalFacts(),
    cardsBefore = await cards();
  const result = await decide(x, body, svc);
  expect(await originalFacts()).toEqual(originalBefore);
  expect(await cards()).toEqual(cardsBefore);
  const accepted = (
    await db.pool.query(
      "SELECT count(*)::int n FROM purchase_revision WHERE purchase_id=$1 AND state='accepted'",
      [x.sale.purchaseId],
    )
  ).rows[0].n;
  expect(accepted).toBeLessThanOrEqual(1);
  if (result.creditedAfter) expect(accepted).toBe(1);
  const evaluations = (
    await db.pool.query(
      "SELECT * FROM review_evaluation WHERE purchase_id=$1",
      [x.sale.purchaseId],
    )
  ).rows;
  expect(evaluations).toHaveLength(1);
  const immutable = await state(x);
  expect(await decide(x, body, svc)).toEqual(result);
  expect(await state(x)).toEqual(immutable);
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM sale_decision WHERE purchase_id=$1",
        [x.sale.purchaseId],
      )
    ).rows[0].n,
  ).toBe(1);
  for (const sql of [
    "UPDATE review_evaluation SET provenance='{}' WHERE purchase_id=$1",
    "DELETE FROM review_evaluation WHERE purchase_id=$1",
  ])
    await expect(db.pool.query(sql, [x.sale.purchaseId])).rejects.toThrow();
  return { result, provenance: evaluations[0].provenance };
}
async function bounds(x: Fixture, start = S, receipt = U, expires?: string) {
  await seedHistorical(
    db.pool,
    "capture_context",
    "UPDATE capture_context SET signed_in_at=$2,offline_expires_at=COALESCE($3::timestamptz,$2::timestamptz + interval '24 hours') WHERE id=$1",
    [x.f.contextId, start, expires],
  );
  await seedHistorical(
    db.pool,
    "purchase",
    "UPDATE purchase SET server_received_at=$2,capture_lower_bound=$3 WHERE id=$1",
    [x.sale.purchaseId, receipt, start],
  );
}
async function price(x: Fixture, at: string, rate = "110000", precision = 2) {
  const id = newId();
  await db.pool.query(
    "INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason) VALUES($1,$2,$3,2,$4,'NGN',$5,$6,$7,'Fictional price activation')",
    [id, x.f.stationId, fixtureId(9), rate, precision, at, fixtureId(5)],
  );
  await sourceAudit(
    db.pool,
    "price_activated",
    "product",
    fixtureId(9),
    {
      priceVersionId: id,
      version: 2,
      rateKobo: rate,
      quantityPrecision: precision,
    },
    at,
  );
  return id;
}
describe("P-25 real PostgreSQL normative review evidence", () => {
  beforeAll(async () => {
    vi.stubEnv("WHR_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    db = await evidenceDatabase();
  }, 30000);
  afterAll(async () => {
    if (httpUsed)
      await (await import("../../src/server/lib/db")).database().end();
    await db?.close();
    vi.unstubAllEnvs();
  });

  it("RE-01 RE-05 RE-21 automatic complete source closure accepts captured price with immutable exactly-once provenance", async () => {
    const x = await evidenceFixture(db);
    const { result, provenance } = await succeeded(x);
    expect(result.after).toMatchObject({
      amountKobo: "2000000",
      rateKobo: "100000",
      quantity: "20",
      quantityPrecision: 2,
    });
    expect(result.creditedAfter).toBe(true);
    expect(JSON.stringify(provenance)).toContain("price_valid_throughout");
    expect(JSON.stringify(provenance)).toContain(x.config.digest);
    expect(JSON.stringify(provenance)).toContain(x.f.contextId);
    expect(JSON.stringify(provenance)).toContain(x.sale.assetId);
  });
  it.each([
    "purchase",
    "context",
    "assignment",
    "price",
    "photo",
    "audit",
    "campaign",
    "card-link",
  ])(
    "RE-01 applicable %s reference supplements required closure",
    async (category) => {
      const x = await evidenceFixture(db);
      const refs: Record<string, string> = {
        purchase: x.sale.purchaseId,
        context: x.f.contextId,
        assignment: x.f.assignmentId,
        price: x.f.priceId,
        photo: x.sale.assetId,
        audit: x.priceAudit,
      };
      if (category === "campaign")
        refs[category] = (
          await db.pool.query(
            "SELECT id FROM settings_version WHERE station_id=$1",
            [x.f.stationId],
          )
        ).rows[0].id;
      if (category === "card-link")
        refs[category] = (
          await db.pool.query(
            "SELECT id FROM card_customer_link WHERE card_id=$1",
            [fixtureId(29)],
          )
        ).rows[0].id;
      await succeeded(x, {
        ...x.body,
        evidence: { ...x.evidence, referenceIds: [refs[category]!] },
      });
    },
  );
  it.each([
    "unknown",
    "foreign-context",
    "foreign-price",
    "foreign-photo",
    "legacy-audit",
  ])(
    "RE-01 %s reference denies without changing any domain state",
    async (category) => {
      const x = await evidenceFixture(db);
      let ref = newId();
      if (category === "foreign-context") ref = fixtureId(21);
      if (category === "foreign-price") ref = fixtureId(15);
      if (category === "legacy-audit")
        ref = await sourceAudit(
          db.pool,
          "sale_received",
          "purchase",
          x.sale.purchaseId,
          { claim: "approved" },
        );
      await denied(x, () =>
        decide(x, {
          ...x.body,
          evidence: { ...x.evidence, referenceIds: [ref] },
        }),
      );
    },
  );
  it.each(["https://example.com/proof", "private/final/image.jpg"])(
    "RE-01 arbitrary reference %s is invalid input",
    async (ref) => {
      const x = await evidenceFixture(db);
      await denied(
        x,
        () =>
          decide(x, {
            ...x.body,
            evidence: { ...x.evidence, referenceIds: [ref] },
          }),
        "invalid_request",
        422,
      );
    },
  );
  it("RE-01 notes and client assertions cannot repair incomplete price history", async () => {
    const x = await evidenceFixture(db);
    await seedHistorical(
      db.pool,
      "product_price_version",
      "UPDATE product_price_version SET effective_from=$2 WHERE id=$1",
      [x.f.priceId, U],
    );
    await denied(x, () =>
      decide(x, {
        ...x.body,
        evidence: {
          ...x.evidence,
          notes:
            "Two reviewers attest this sale was valid before the price change",
        },
      }),
    );
  });
  it.each([
    "missing",
    "deleted",
    "unvalidated",
    "placeholder",
    "digest-only",
    "transient",
  ])("RE-03 %s photo evidence cannot apply a receipt", async (mode) => {
    const x = await evidenceFixture(db);
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
        if (mode === "transient") throw new Error("private storage outage");
        if (mode === "placeholder") return Buffer.from("photo placeholder");
        if (mode === "digest-only")
          return Buffer.from(x.f.original.photo.sha256);
        return x.h.storage.read(key, max);
      },
    };
    await denied(
      x,
      () => decide(x, x.body, service(x, x.config, storage)),
      mode === "transient" ? "temporarily_unavailable" : "evidence_unavailable",
      mode === "transient" ? 503 : 422,
    );
  });
  it.each([
    ["point", S, S, expiry],
    ["before-expiry", S, U, expiry],
    ["at-expiry", S, expiry, expiry],
    ["after-expiry", S, "2026-11-11T13:00:00Z", expiry],
  ])(
    "RE-04 %s retains closed original bounds through retry",
    async (_label, start, receipt, expires) => {
      const x = await evidenceFixture(db);
      await bounds(x, start, receipt, expires);
      await succeeded(x);
    },
  );
  it("RE-04 L greater than U fails without writes", async () => {
    const x = await evidenceFixture(db);
    await bounds(x, U, S);
    await denied(x, () => decide(x));
  });
  it("RE-05 precision-only historical activation preserves captured precision and exact kobo", async () => {
    const x = await evidenceFixture(db);
    await price(x, "2026-11-10T12:30:00Z", "100000", 3);
    const { result } = await succeeded(x);
    expect(result.after.quantityPrecision).toBe(2);
    expect(result.after.amountKobo).toBe("2000000");
  });
  it.each([S, "2026-11-10T12:30:00Z", U])(
    "RE-06 different rate effective at %s prevents acceptance",
    async (at) => {
      const x = await evidenceFixture(db);
      await price(x, at);
      await denied(x, () => decide(x));
    },
  );
  it("RE-06 matching rate effective exactly at L succeeds", async () => {
    const x = await evidenceFixture(db);
    await price(x, S, "100000");
    await succeeded(x);
  });
  it("RE-06 rate event strictly after U does not make interval uncertain", async () => {
    const x = await evidenceFixture(db);
    await price(x, "2026-11-10T13:00:00.000001Z");
    await succeeded(x);
  });
  it.each(["cancel", "correct_meter"])(
    "RE-06 %s never activates unsupported price authority",
    async (outcome) => {
      const x = await evidenceFixture(db);
      await denied(
        x,
        () =>
          decide(x, {
            ...x.body,
            decision:
              outcome === "cancel"
                ? { outcome }
                : { outcome, amountKobo: "2100000", quantity: "21" },
          }),
        outcome === "cancel"
          ? "evidence_insufficient"
          : "meter_policy_unconfigured",
        outcome === "cancel" ? 422 : 409,
      );
    },
  );
  it.each([
    [
      "strict-before",
      "2026-11-10T13:00:00.000001Z",
      S,
      U,
      "2026-11-10T14:00:00Z",
      "confirm_earlier",
      true,
    ],
    ["U=E", U, S, U, U, "confirm_earlier", false],
    ["crossing", "2026-11-10T12:30:00Z", S, U, U, "confirm_earlier", false],
    ["L=E", S, S, U, U, "cancel", true],
    ["L>E", "2026-11-10T11:59:59.999999Z", S, U, U, "cancel", true],
    ["point=E", S, S, S, S, "cancel", true],
    ["point cannot confirm", S, S, S, S, "confirm_earlier", false],
    ["E>R", "2026-11-10T14:00:00Z", S, U, U, "confirm_earlier", false],
  ] as const)(
    "RE-07 card %s exact boundary",
    async (_label, event, start, upper, receipt, outcome, ok) => {
      const x = await evidenceFixture(db, "card");
      await bounds(
        x,
        receipt > upper ? "2026-11-09T13:00:00Z" : start,
        receipt,
        receipt > upper
          ? upper
          : new Date(new Date(start).getTime() + 86400000).toISOString(),
      );
      await replacement(x, event);
      const body = { ...x.body, outcome };
      if (ok) {
        await succeeded(x, body);
        expect(
          (
            await db.pool.query(
              "SELECT state,replaced_by_card_id FROM card WHERE id=$1",
              [fixtureId(29)],
            )
          ).rows[0].state,
        ).toBe("retired");
      } else await denied(x, () => decide(x, body));
    },
  );
  it("RE-08 other retirement reasons remain policy-gated", async () => {
    const x = await evidenceFixture(db, "card");
    await replacement(x, S);
    await seedHistorical(
      db.pool,
      "card",
      "UPDATE card SET retirement_reason='lost',version=version+1 WHERE id=$1",
      [fixtureId(29)],
    );
    await denied(x, () => decide(x), "policy_review_required");
  });
  it.each([
    ["2026-11-10", true, "evidence_insufficient"],
    ["2026-11-09", false, "evidence_insufficient"],
    ["2026-02-30", false, "date_invalid"],
    ["2099-01-01", false, "date_after_receipt"],
  ] as const)(
    "RE-09 date %s must be the interval's real Lagos day",
    async (day, ok, code) => {
      const x = await evidenceFixture(db, "date"),
        body = { ...x.body, verifiedSaleDate: day };
      if (ok) await succeeded(x, body);
      else await denied(x, () => decide(x, body), code);
    },
  );
  it.each(["2026-11-10T23:00:00.000000Z", "2026-11-10T23:00:00.000001Z"])(
    "RE-09 interval reaching Lagos midnight %s remains held",
    async (receipt) => {
      const x = await evidenceFixture(db, "date");
      await bounds(x, "2026-11-10T22:59:59.999999Z", receipt);
      await denied(x, () => decide(x));
    },
  );
  it("RE-09 interval ending one microsecond before Lagos midnight succeeds", async () => {
    const x = await evidenceFixture(db, "date");
    await bounds(
      x,
      "2026-11-10T22:59:59.000000Z",
      "2026-11-10T22:59:59.999999Z",
    );
    await succeeded(x);
  });
  it.each(["authorization", "timing", "both"])(
    "RE-10 capture %s confirms only its open uniform blocks",
    async (mode) => {
      const x = await evidenceFixture(db, "capture");
      if (mode === "timing")
        await seedHistorical(
          db.pool,
          "purchase_validation_block",
          "DELETE FROM purchase_validation_block WHERE purchase_id=$1",
          [x.sale.purchaseId],
        );
      if (mode !== "authorization")
        await db.pool.query(
          "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_time_unresolved','fixture',clock_timestamp(),1)",
          [newId(), x.sale.purchaseId],
        );
      await succeeded(x);
    },
  );
  it.each([
    ["before", "2026-11-10T11:00:00Z", true],
    ["at-L", S, true],
    ["inside", "2026-11-10T12:30:00Z", false],
    ["at-U", U, false],
    ["after-U", "2026-11-10T13:00:00.000001Z", false],
  ] as const)(
    "RE-11 assignment ending %s cancellation requires uniform unauthorized interval",
    async (_label, end, ok) => {
      const x = await evidenceFixture(db, "capture");
      await db.pool.query(
        "UPDATE assignment SET effective_until=$2 WHERE id=$1",
        [x.f.assignmentId, end],
      );
      await sourceAudit(
        db.pool,
        "assignment_ended",
        "attendant",
        x.f.attendantId,
        { assignmentId: x.f.assignmentId, effectiveUntil: end },
        end,
      );
      const body = { ...x.body, outcome: "cancel" };
      if (ok) await succeeded(x, body);
      else await denied(x, () => decide(x, body));
    },
  );
  it.each(["2026-11-10T12:30:00Z", U])(
    "RE-11 assignment end at %s prevents confirmation",
    async (end) => {
      const x = await evidenceFixture(db, "capture");
      await db.pool.query(
        "UPDATE assignment SET effective_until=$2 WHERE id=$1",
        [x.f.assignmentId, end],
      );
      await sourceAudit(
        db.pool,
        "assignment_ended",
        "attendant",
        x.f.attendantId,
        { assignmentId: x.f.assignmentId, effectiveUntil: end },
        end,
      );
      await denied(x, () => decide(x));
    },
  );
  it("RE-11 assignment end strictly after U permits confirmation", async () => {
    const x = await evidenceFixture(db, "capture");
    await db.pool.query(
      "UPDATE assignment SET effective_until='2026-11-10T13:00:00.000001Z' WHERE id=$1",
      [x.f.assignmentId],
    );
    await succeeded(x);
  });
  it.each(["price", "card", "date", "capture"] as Kind[])(
    "RE-13 %s independently requires sales and action permissions",
    async (kind) => {
      const x = await evidenceFixture(db, kind),
        permission = {
          price: "priceReview",
          card: "cardEligibility",
          date: "dateReview",
          capture: "dateReview",
        }[kind];
      for (const code of ["sales", permission]) {
        await db.pool.query(
          "DELETE FROM role_permission WHERE role_id=$1 AND permission_code=$2",
          [fixtureId(1), code],
        );
        try {
          await denied(x, () => decide(x), "permission_denied", 403);
        } finally {
          await db.pool.query(
            "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
            [fixtureId(1), code],
          );
        }
      }
    },
  );
  it.each(["price", "card", "date", "capture"] as Kind[])(
    "RE-13 %s rechecks session revocation during evidence read",
    async (kind) => {
      const x = await evidenceFixture(db, kind);
      const storage = {
        ...x.h.storage,
        async read(key: string, max: number) {
          const bytes = await x.h.storage.read(key, max);
          await db.pool.query(
            "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL",
            [fixtureId(2)],
          );
          return bytes;
        },
      };
      await denied(
        x,
        () => decide(x, x.body, service(x, x.config, storage)),
        "unauthenticated",
        401,
      );
    },
  );
  it.each(["sale", "revision", "hold"])(
    "RE-14 stale %s guard cannot mutate evidence",
    async (field) => {
      const x = await evidenceFixture(db);
      const edit =
        field === "sale"
          ? { expectedVersion: x.body.expectedVersion + 1 }
          : field === "revision"
            ? { expectedRevisionId: newId() }
            : { expectedHoldVersion: 2 };
      await denied(
        x,
        () => decide(x, { ...x.body, ...edit }),
        "version_conflict",
        409,
      );
    },
  );
  it("RE-14 concurrent decisions have one winner, one provenance and one accepted revision", async () => {
    const x = await evidenceFixture(db);
    const results = await Promise.allSettled([
      decide(x),
      decide(x, { ...x.body, operationId: newId() }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM review_evaluation WHERE purchase_id=$1",
          [x.sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM purchase_revision WHERE purchase_id=$1 AND state='accepted'",
          [x.sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("RE-15 replay after deactivation returns historical receipt; changed content conflicts; fresh operation denies", async () => {
    const x = await evidenceFixture(db);
    const first = await decide(x);
    const inactive = await activate(db.pool, x.f.stationId, 2, false),
      svc = service(x, inactive);
    const before = await state(x);
    expect(await decide(x, x.body, svc)).toEqual(first);
    expect(await state(x)).toEqual(before);
    await denied(
      x,
      () => decide(x, { ...x.body, reason: "Changed factual reason" }, svc),
      "operation_conflict",
      409,
    );
    await denied(
      x,
      () => decide(x, { ...x.body, operationId: newId() }, svc),
      "version_conflict",
      409,
    );
  });
  it.each([
    null,
    { release: "unsupported" },
    { revision: "1" },
    { revision: 0 },
    { revision: -1 },
    { revision: 1.5 },
    { revision: Number.MAX_SAFE_INTEGER + 1 },
    { digest: "f".repeat(64) },
    { extra: true },
    { scope: { environment: "test", stationId: "bad" } },
    {
      activation: {
        state: "active",
        approvalReference: newId(),
        activatedAt: "2099-01-01T00:00:00Z",
      },
    },
  ])(
    "RE-18 malformed or unsupported policy %j denies unchanged",
    async (edit) => {
      const x = await evidenceFixture(db);
      const config = edit === null ? null : { ...x.config, ...edit };
      await denied(x, () => decide(x, x.body, service(x, config)));
    },
  );
  it("RE-19 later inactive revision makes old activation unusable without reevaluating sales", async () => {
    const x = await evidenceFixture(db),
      before = await state(x);
    await activate(db.pool, x.f.stationId, 2, false);
    expect(await state(x)).toEqual(before);
    await denied(x, () => decide(x));
    await expect(activate(db.pool, x.f.stationId, 2)).rejects.toThrow();
  });
  async function addHold(x: Fixture, kind: "price" | "date" | "card") {
    await seedHistorical(
      db.pool,
      "purchase",
      "UPDATE purchase SET status='held',version=version+1 WHERE id=$1 AND status='credited'",
      [x.sale.purchaseId],
    );
    x.body = { ...x.body, ...(await x.h.guard(x.sale.purchaseId)) };
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
          : kind === "price"
            ? "price_uncertain"
            : "capture_date_uncertain",
      ],
    );
    return id;
  }
  async function frozenLookup(x: Fixture, at: string, valid = true) {
    const link = (
      await db.pool.query(
        "SELECT id,customer_id FROM card_customer_link WHERE card_id=$1",
        [fixtureId(29)],
      )
    ).rows[0];
    const context = (
      await db.pool.query(
        "SELECT offline_expires_at FROM capture_context WHERE id=$1",
        [x.f.contextId],
      )
    ).rows[0];
    const claims = {
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
    };
    await seedHistorical(
      db.pool,
      "purchase",
      "UPDATE purchase SET lookup_receipt_status='valid',lookup_receipt_claims=$2,capture_lower_bound=$3,capture_policy_version='lookup-v1' WHERE id=$1",
      [x.sale.purchaseId, claims, at],
    );
  }
  it.each([true, false])(
    "RE-04 frozen P-23 valid=%s supplies L only when context bindings match",
    async (valid) => {
      const x = await evidenceFixture(db);
      await frozenLookup(x, "2026-11-10T12:30:00Z", valid);
      const { provenance } = await succeeded(x);
      expect(provenance.interval.L).toBe(
        String(BigInt(Date.parse(valid ? "2026-11-10T12:30:00Z" : S)) * 1000n),
      );
      expect(provenance.lookup.status).toBe(valid ? "frozen" : "fallback");
    },
  );
  it("RE-04 a fresh sign-in and token cannot narrow a previously frozen original", async () => {
    const x = await evidenceFixture(db);
    const { newSession } = await import("../helpers/sync-fixture");
    await newSession(db.pool, x.f);
    const { provenance } = await succeeded(x);
    expect(provenance.interval.S).toBe(String(BigInt(Date.parse(S)) * 1000n));
    expect(provenance.interval.L).toBe(provenance.interval.S);
    expect(provenance.interval.R).toBe(String(BigInt(Date.parse(U)) * 1000n));
  });
  it.each([
    "valid",
    "self-reference",
    "missing-ancestor",
    "legacy",
    "precision",
    "policy",
    "cross-purchase",
    "resource-limit",
  ])(
    "RE-02 derived %s closure is reproduced or rejected atomically",
    async (mode) => {
      const x = await evidenceFixture(db);
      await decide(x);
      const previous = (
        await db.pool.query(
          "SELECT decision_id,provenance FROM review_evaluation WHERE purchase_id=$1",
          [x.sale.purchaseId],
        )
      ).rows[0];
      const hold = await addHold(x, "date");
      const body = {
        ...(await x.h.guard(x.sale.purchaseId)),
        expectedHoldVersion: 1,
        verifiedSaleDate: "2026-11-10",
        evidence: { ...x.evidence, referenceIds: [previous.decision_id] },
      };
      const p = previous.provenance;
      if (mode === "self-reference")
        p.sources.push({
          category: "derived_evidence",
          id: previous.decision_id,
        });
      if (mode === "missing-ancestor") p.sources[0].id = newId();
      if (mode === "precision") p.conclusions[0].precision = "day";
      if (mode === "policy") p.policy.digest = "e".repeat(64);
      if (mode === "resource-limit")
        p.sources = Array.from({ length: 129 }, () => p.sources[0]);
      if (mode === "cross-purchase") {
        const { newSession } = await import("../helpers/sync-fixture");
        const fresh = await newSession(db.pool, x.f);
        const other = await x.h.settle({ ...x.f, ...fresh }, x.bytes, {
          captureContextId: fresh.contextId,
        });
        await seedHistorical(
          db.pool,
          "review_evaluation",
          "DELETE FROM review_evaluation WHERE decision_id=$1",
          [previous.decision_id],
        );
        await seedHistorical(
          db.pool,
          "sale_decision",
          "UPDATE sale_decision SET purchase_id=$2 WHERE id=$1",
          [previous.decision_id, other.purchaseId],
        );
      }
      if (mode === "legacy")
        await seedHistorical(
          db.pool,
          "review_evaluation",
          "DELETE FROM review_evaluation WHERE decision_id=$1",
          [previous.decision_id],
        );
      else if (mode !== "valid" && mode !== "cross-purchase")
        await seedHistorical(
          db.pool,
          "review_evaluation",
          "UPDATE review_evaluation SET provenance=$2 WHERE decision_id=$1",
          [previous.decision_id, p],
        );
      const operation = () =>
        service(x).decideDate(x.token, x.sale.purchaseId, hold, body);
      if (mode === "valid") {
        const result = await operation(),
          after = await state(x);
        expect(await operation()).toEqual(result);
        expect(await state(x)).toEqual(after);
        const evaluations = (
          await db.pool.query(
            "SELECT provenance FROM review_evaluation WHERE purchase_id=$1",
            [x.sale.purchaseId],
          )
        ).rows;
        expect(evaluations).toHaveLength(2);
        expect(
          evaluations.some((e) =>
            e.provenance.sources.some(
              (s: { category: string }) => s.category === "derived_evidence",
            ),
          ),
        ).toBe(true);
      } else await denied(x, operation);
    },
  );
  it.each(["gap", "contradictory-audit", "missing-campaign"])(
    "RE-12 incomplete or contradictory %s history cannot authorize a conclusion",
    async (mode) => {
      const x = await evidenceFixture(
        db,
        mode === "missing-campaign" ? "capture" : "price",
      );
      if (mode === "gap")
        await seedHistorical(
          db.pool,
          "product_price_version",
          "UPDATE product_price_version SET version=2 WHERE id=$1",
          [x.f.priceId],
        );
      if (mode === "contradictory-audit")
        await sourceAudit(
          db.pool,
          "price_activated",
          "product",
          fixtureId(9),
          {
            priceVersionId: x.f.priceId,
            version: 1,
            rateKobo: "100000",
            quantityPrecision: 2,
          },
          "2026-11-09T00:00:00Z",
        );
      if (mode === "missing-campaign") {
        await db.pool.query(
          "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_time_unresolved','fixture',clock_timestamp(),1)",
          [newId(), x.sale.purchaseId],
        );
        await seedHistorical(
          db.pool,
          "settings_version",
          "UPDATE settings_version SET purchase_start=NULL WHERE station_id=$1",
          [x.f.stationId],
        );
      }
      await denied(x, () => decide(x));
    },
  );
  it.each(["inside-L", "inside-U", "outside", "after-U"])(
    "RE-10 RE-11 campaign %s boundary resolves only a uniform membership answer",
    async (mode) => {
      const x = await evidenceFixture(db, "capture");
      await db.pool.query(
        "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_time_unresolved','fixture',clock_timestamp(),1)",
        [newId(), x.sale.purchaseId],
      );
      const start =
        mode === "inside-L"
          ? S
          : mode === "inside-U"
            ? U
            : mode === "outside"
              ? "2026-11-10T14:00:00Z"
              : "2026-11-01T00:00:00Z";
      await seedHistorical(
        db.pool,
        "settings_version",
        "UPDATE settings_version SET purchase_start=$2 WHERE station_id=$1",
        [x.f.stationId, start],
      );
      if (mode === "inside-U") await denied(x, () => decide(x));
      else {
        const { provenance } = await succeeded(x);
        expect(
          provenance.conclusions.find(
            (c: { tag: string }) => c.tag === "campaign_membership_uniform",
          ).inside,
        ).toBe(mode !== "outside");
      }
    },
  );
  it("RE-11 outside campaign is not invalidity sufficient for cancellation", async () => {
    const x = await evidenceFixture(db, "capture");
    await seedHistorical(
      db.pool,
      "settings_version",
      "UPDATE settings_version SET purchase_start='2026-11-10T14:00:00Z' WHERE station_id=$1",
      [x.f.stationId],
    );
    await denied(x, () => decide(x, { ...x.body, outcome: "cancel" }));
  });
  it.each(["price", "card", "date", "capture"] as Kind[])(
    "RE-13 %s denies disabled account, role, restricted and revoked sessions",
    async (kind) => {
      const x = await evidenceFixture(db, kind);
      for (const actorState of [
        "disabled-account",
        "disabled-role",
        "first-password",
        "revoked",
      ]) {
        const session = (
          await db.pool.query(
            "SELECT id FROM auth_session WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
            [fixtureId(2)],
          )
        ).rows[0].id;
        if (actorState === "disabled-account")
          await db.pool.query(
            "UPDATE auth_user SET enabled=false WHERE id=$1",
            [fixtureId(2)],
          );
        if (actorState === "disabled-role")
          await db.pool.query(
            "UPDATE role SET enabled=false,version=version+1 WHERE id=$1",
            [fixtureId(1)],
          );
        if (actorState === "first-password")
          await seedHistorical(
            db.pool,
            "auth_session",
            "UPDATE auth_session SET access_scope='first_password' WHERE id=$1",
            [session],
          );
        if (actorState === "revoked")
          await db.pool.query(
            "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1",
            [session],
          );
        const before = await state(x);
        await expect(decide(x)).rejects.toMatchObject({
          status: actorState === "first-password" ? 403 : 401,
        });
        expect(await state(x)).toEqual(before);
        await db.pool.query("UPDATE auth_user SET enabled=true WHERE id=$1", [
          fixtureId(2),
        ]);
        await db.pool.query(
          "UPDATE role SET enabled=true,version=version+1 WHERE id=$1",
          [fixtureId(1)],
        );
        await seedHistorical(
          db.pool,
          "auth_session",
          "UPDATE auth_session SET access_scope='full',revoked_at=NULL WHERE id=$1",
          [session],
        );
      }
    },
  );
  it("RE-14 wrong hold kind, closed capture and cancelled purchase reject unchanged", async () => {
    const x = await evidenceFixture(db);
    await denied(
      x,
      () =>
        service(x).decideCard(x.token, x.sale.purchaseId, x.holdId, {
          ...awaitGuard(x),
          expectedHoldVersion: 1,
          evidence: x.evidence,
          outcome: "confirm_earlier",
        }),
      "hold_kind_mismatch",
    );
  });
  function awaitGuard(x: Fixture) {
    return {
      operationId: newId(),
      expectedVersion: x.body.expectedVersion,
      expectedRevisionId: x.body.expectedRevisionId,
      reason: "Independent evidence review",
    };
  }
  it.each([
    "price,card,date",
    "price,date,card",
    "card,price,date",
    "card,date,price",
    "date,price,card",
    "date,card,price",
  ])(
    "RE-16 mixed order %s clears only its hold and retains capture block",
    async (order) => {
      const x = await evidenceFixture(db);
      await bounds(x, "2026-11-09T13:00:00Z", "2026-11-10T14:00:00Z", U);
      await frozenLookup(x, S);
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
      const svc = service(x);
      let remaining = 3;
      for (const kind of order.split(",") as ("price" | "card" | "date")[]) {
        const b = {
          ...(await x.h.guard(x.sale.purchaseId)),
          expectedHoldVersion: 1,
          evidence: x.evidence,
        };
        const result =
          kind === "price"
            ? await svc.decidePrice(x.token, x.sale.purchaseId, ids[kind], {
                ...b,
                decision: { outcome: "accept_captured" },
              })
            : kind === "card"
              ? await svc.decideCard(x.token, x.sale.purchaseId, ids[kind], {
                  ...b,
                  outcome: "confirm_earlier",
                })
              : await svc.decideDate(x.token, x.sale.purchaseId, ids[kind], {
                  ...b,
                  verifiedSaleDate: "2026-11-10",
                });
        expect(result.remainingHolds).toHaveLength(--remaining);
        expect(result.creditedAfter).toBe(false);
        expect(result.after.amountKobo).toBe("2000000");
      }
      const b = {
        ...(await x.h.guard(x.sale.purchaseId)),
        outcome: "confirm",
        evidence: x.evidence,
      };
      const result = await svc.decideCapture(x.token, x.sale.purchaseId, b);
      expect(result.creditedAfter).toBe(true);
      const after = await state(x);
      expect(await svc.decideCapture(x.token, x.sale.purchaseId, b)).toEqual(
        result,
      );
      expect(await state(x)).toEqual(after);
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int n FROM review_evaluation WHERE purchase_id=$1",
            [x.sale.purchaseId],
          )
        ).rows[0].n,
      ).toBe(4);
    },
  );
  it("RE-17 failing audit insert rolls back decision, provenance, contribution and resolutions", async () => {
    const x = await evidenceFixture(db);
    await db.pool.query(
      "CREATE FUNCTION reject_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='price_accepted' THEN RAISE EXCEPTION 'fictional audit failure'; END IF; RETURN NEW; END $$",
    );
    await db.pool.query(
      "CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION reject_review_audit()",
    );
    try {
      const before = await state(x);
      await expect(decide(x)).rejects.toThrow("fictional audit failure");
      expect(await state(x)).toEqual(before);
    } finally {
      await db.pool.query("DROP TRIGGER fixture_audit_failure ON audit_event");
      await db.pool.query("DROP FUNCTION reject_review_audit()");
    }
  });
  it("RE-17 cancellation closes capture blocks as cancelled and preserves all sources", async () => {
    const x = await evidenceFixture(db, "capture");
    await db.pool.query(
      "UPDATE assignment SET effective_until=$2 WHERE id=$1",
      [x.f.assignmentId, S],
    );
    const { provenance } = await succeeded(x, { ...x.body, outcome: "cancel" });
    expect(provenance.result.closure).toBe("cancelled");
    expect(
      (
        await db.pool.query(
          "SELECT closure_kind FROM purchase_validation_block WHERE purchase_id=$1",
          [x.sale.purchaseId],
        )
      ).rows,
    ).toEqual([{ closure_kind: "cancelled" }]);
    expect(provenance.sources.length).toBeGreaterThan(0);
  });
  it("RE-19 deactivation committed during photo work prevents a new acceptance", async () => {
    const x = await evidenceFixture(db);
    let once = false;
    const storage = {
      ...x.h.storage,
      async read(key: string, max: number) {
        const bytes = await x.h.storage.read(key, max);
        if (!once) {
          once = true;
          await activate(db.pool, x.f.stationId, 2, false);
        }
        return bytes;
      },
    };
    await denied(x, () => decide(x, x.body, service(x, x.config, storage)));
  });
  it.each(["date", "card", "capture"] as Kind[])(
    "RE-16 %s preserves a pre-existing independent meter candidate",
    async (kind) => {
      const x = await evidenceFixture(db, kind);
      if (kind === "card") {
        await bounds(x, "2026-11-09T13:00:00Z", "2026-11-10T14:00:00Z", U);
        await frozenLookup(x, S);
        await replacement(x, "2026-11-10T13:00:00.000001Z");
      }
      const candidate = newId();
      await db.pool.query(
        "INSERT INTO purchase_revision SELECT (jsonb_populate_record(NULL::purchase_revision,to_jsonb(r)||jsonb_build_object('id',$2::text,'operation_id',$3::text,'revision_number',2,'reason','Fictional prior meter review','kind','price_resolution','calculation_mode','meter_evidence','amount_kobo','2100001','quantity','19.13','based_on_revision_id',r.id))).* FROM purchase_revision r WHERE r.id=$1",
        [x.original, candidate, newId()],
      );
      await db.pool.query(
        "UPDATE purchase SET resolution_candidate_revision_id=$2,version=version+1 WHERE id=$1",
        [x.sale.purchaseId, candidate],
      );
      const body = { ...x.body, ...(await x.h.guard(x.sale.purchaseId)) };
      const { result } = await succeeded(x, body);
      expect(
        (
          await db.pool.query(
            "SELECT calculation_mode FROM purchase_revision r JOIN purchase p ON p.current_revision_id=r.id WHERE p.id=$1",
            [x.sale.purchaseId],
          )
        ).rows[0].calculation_mode,
      ).toBe("meter_evidence");
      expect(result.after).toMatchObject({
        amountKobo: "2100001",
        quantity: "19.13",
        rateKobo: "100000",
      });
    },
  );
  it("RE-06 newer numeric candidate cannot be overwritten by accept_captured", async () => {
    const x = await evidenceFixture(db),
      candidate = newId();
    await db.pool.query(
      "INSERT INTO purchase_revision SELECT (jsonb_populate_record(NULL::purchase_revision,to_jsonb(r)||jsonb_build_object('id',$2::text,'operation_id',$3::text,'revision_number',2,'reason','Fictional prior meter review','kind','price_resolution','calculation_mode','meter_evidence','amount_kobo','2100001','quantity','19.13','based_on_revision_id',r.id))).* FROM purchase_revision r WHERE r.id=$1",
      [x.original, candidate, newId()],
    );
    await db.pool.query(
      "UPDATE purchase SET resolution_candidate_revision_id=$2,version=version+1 WHERE id=$1",
      [x.sale.purchaseId, candidate],
    );
    await denied(
      x,
      () =>
        decide(x, {
          ...x.body,
          ...awaitGuard({
            ...x,
            body: { ...x.body, expectedVersion: x.body.expectedVersion + 1 },
          }),
        }),
      "no_change",
      409,
    );
  });
  it("RE-17 finalized snapshot rows and source bindings remain byte-identical after acceptance", async () => {
    const x = await evidenceFixture(db),
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
    const snapshots = async () =>
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
    await succeeded(x);
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
  it("RE-21 protected provenance binds target, full policy, exact interval, source graph, result and remaining gates", async () => {
    const x = await evidenceFixture(db);
    await addHold(x, "date");
    const { result, provenance: p } = await succeeded(x);
    expect(result.creditedAfter).toBe(false);
    expect(p.policy).toEqual(x.config);
    expect(p.interval).toEqual({
      S: String(BigInt(Date.parse(S)) * 1000n),
      R: String(BigInt(Date.parse(U)) * 1000n),
      expiry: String(BigInt(Date.parse(expiry)) * 1000n),
      L: String(BigInt(Date.parse(S)) * 1000n),
      U: String(BigInt(Date.parse(U)) * 1000n),
      precision: "microsecond",
    });
    expect(p.target).toMatchObject({
      purchaseId: x.sale.purchaseId,
      evaluatedRevisionId: x.original,
      originalRevisionId: x.original,
      expectedPurchaseVersion: x.body.expectedVersion,
    });
    expect(p.result).toMatchObject({
      actorId: fixtureId(2),
      reason: x.body.reason,
      evidenceAssetId: x.sale.assetId,
      notes: x.evidence.notes,
      credited: false,
      closure: "confirmed",
    });
    expect(p.result.remainingHolds).toHaveLength(1);
    expect(p.evidenceDigest).toBe(x.f.original.photo.sha256);
    expect(p.historyGeneration).toMatch(/^[a-f0-9]{64}$/);
    for (const source of p.sources) {
      expect(source).toEqual(
        expect.objectContaining({
          category: expect.any(String),
          id: expect.any(String),
          version: expect.any(String),
          recordedAt: expect.any(String),
          scope: expect.objectContaining({ purchaseId: x.sale.purchaseId }),
          dependencies: expect.any(Array),
          snapshot: expect.any(Object),
        }),
      );
    }
    const categories = p.sources.map((s: { category: string }) => s.category);
    for (const c of [
      "original_purchase",
      "capturing_context",
      "validated_photo",
      "price_history",
      "assignment_history",
      "card_history",
      "campaign_history",
      "domain_audit",
    ])
      expect(categories).toContain(c);
    const audit = (
      await db.pool.query(
        "SELECT before,after,reason FROM audit_event WHERE target_id=$1",
        [x.sale.purchaseId],
      )
    ).rows;
    expect(JSON.stringify(audit)).not.toContain(x.evidence.notes);
    expect(JSON.stringify(result)).not.toContain("historyGeneration");
    expect(JSON.stringify(result)).not.toContain(x.evidence.notes);
  });
  it("RE-12 history committed while evidence is pending is reevaluated rather than mixing snapshots", async () => {
    const x = await evidenceFixture(db);
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => (entered = r)),
      barrier = new Promise<void>((r) => (release = r));
    const storage = {
      ...x.h.storage,
      async read(key: string, max: number) {
        const bytes = await x.h.storage.read(key, max);
        entered();
        await barrier;
        return bytes;
      },
    };
    const before = await state(x);
    const results = await Promise.allSettled([
      decide(x, x.body, service(x, x.config, storage)),
      (async () => {
        await ready;
        try {
          await price(x, "2026-11-10T12:30:00Z");
        } finally {
          release();
        }
      })(),
    ]);
    expect(results[0]).toMatchObject({
      status: "rejected",
      reason: { code: "evidence_insufficient", status: 422 },
    });
    expect(results[1].status).toBe("fulfilled");
    expect(await state(x)).toEqual(before);
  });
  it("RE-19 concurrent acceptance and deactivation serialize without mixed policy or double credit", async () => {
    const x = await evidenceFixture(db),
      before = await state(x);
    const results = await Promise.allSettled([
      decide(x),
      activate(db.pool, x.f.stationId, 2, false),
    ]);
    expect(results[1].status).toBe("fulfilled");
    const evaluations = (
      await db.pool.query(
        "SELECT provenance FROM review_evaluation WHERE purchase_id=$1",
        [x.sale.purchaseId],
      )
    ).rows;
    if (results[0].status === "fulfilled") {
      expect(evaluations).toHaveLength(1);
      expect(evaluations[0].provenance.policy.revision).toBe(1);
      expect(evaluations[0].provenance.result.credited).toBe(true);
    } else {
      expect(results[0].reason).toMatchObject({
        code: "evidence_insufficient",
      });
      expect(evaluations).toHaveLength(0);
      expect(await state(x)).toEqual(before);
    }
    expect(
      (
        await db.pool.query(
          "SELECT revision FROM review_evidence_configuration WHERE station_id=$1 ORDER BY revision",
          [x.f.stationId],
        )
      ).rows.map((r) => r.revision),
    ).toEqual(["1", "2"]);
  });
  it("RE-19 rollback to prior release needs a higher approved revision and preserves earlier snapshots", async () => {
    const x = await evidenceFixture(db);
    await activate(db.pool, x.f.stationId, 2, false);
    const before = (
      await db.pool.query(
        "SELECT * FROM review_evidence_configuration WHERE station_id=$1 ORDER BY revision",
        [x.f.stationId],
      )
    ).rows;
    const rollback = await activate(db.pool, x.f.stationId, 3, true);
    await succeeded(x, x.body, service(x, rollback));
    expect(
      (
        await db.pool.query(
          "SELECT * FROM review_evidence_configuration WHERE station_id=$1 AND revision<3 ORDER BY revision",
          [x.f.stationId],
        )
      ).rows,
    ).toEqual(before);
    await expect(activate(db.pool, x.f.stationId, 1)).rejects.toThrow();
  });
  it.each(["missing", "environment", "revision", "digest", "time", "future"])(
    "RE-19 approval %s binding cannot be replaced by a populated configuration",
    async (mode) => {
      const x = await evidenceFixture(db);
      const id = x.config.activation.approvalReference;
      if (mode === "missing")
        await seedHistorical(
          db.pool,
          "review_evidence_approval",
          "DELETE FROM review_evidence_approval WHERE id=$1",
          [id],
        );
      else {
        const field = {
          environment: "environment",
          revision: "revision",
          digest: "digest",
          time: "activated_at",
          future: "activated_at",
        }[mode]!;
        const value =
          mode === "environment"
            ? "production"
            : mode === "revision"
              ? 2
              : mode === "digest"
                ? "d".repeat(64)
                : mode === "time"
                  ? "2026-11-09T12:00:00Z"
                  : "2099-01-01T00:00:00Z";
        await seedHistorical(
          db.pool,
          "review_evidence_approval",
          `UPDATE review_evidence_approval SET ${field}=$2 WHERE id=$1`,
          [id, value],
        );
      }
      await denied(x, () => decide(x));
    },
  );
  it("RE-14 numeric correction competing with review cannot overwrite the winning guarded revision", async () => {
    const x = await evidenceFixture(db, "date");
    // A retained accepted numeric base can still have an independently open date hold.
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
    const fresh = (await import("../helpers/sync-fixture")).newSession;
    const session = await fresh(db.pool, x.f);
    const { createCorrectionsService } =
      await import("../../src/server/modules/corrections/service");
    const corrections = createCorrectionsService({
      pool: db.pool,
      storage: x.h.storage,
    });
    const guard = await x.h.guard(x.sale.purchaseId);
    const body = { ...x.body, ...guard };
    const correction = {
      operationId: newId(),
      expectedVersion: guard.expectedVersion,
      basedOnRevisionId: x.original,
      edit: { basis: "amount", enteredAmountKobo: "2100000" },
      evidenceAssetId: x.sale.assetId,
      reason: "Corrected fictional meter amount",
    };
    const results = await Promise.allSettled([
      decide(x, body),
      corrections.submit(session.token, x.sale.purchaseId, correction),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      status: "rejected",
      reason: { status: 409 },
    });
    for (let n = 0; n < 5 && (await corrections.processNext()); n++);
    const accepted = (
      await db.pool.query(
        "SELECT r.amount_kobo,r.id FROM purchase p JOIN purchase_revision r ON r.id=p.current_revision_id WHERE p.id=$1",
        [x.sale.purchaseId],
      )
    ).rows;
    expect(accepted).toHaveLength(1);
    expect(["2000000", "2100000"]).toContain(accepted[0].amount_kobo);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM purchase_revision WHERE purchase_id=$1 AND state='accepted'",
          [x.sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(1);
    const applied = (
      await db.pool.query(
        "SELECT count(*)::int n FROM review_evaluation WHERE purchase_id=$1",
        [x.sale.purchaseId],
      )
    ).rows[0].n;
    expect(applied).toBe(results[0].status === "fulfilled" ? 1 : 0);
  });
  it.each([
    ["evidence_insufficient", 422],
    ["evidence_unavailable", 422],
    ["temporarily_unavailable", 503],
    ["invalid_request", 400],
    ["unauthenticated", 401],
    ["permission_denied", 403],
    ["version_conflict", 409],
    ["meter_policy_unconfigured", 409],
    ["hold_kind_mismatch", 422],
    ["date_invalid", 422],
    ["date_after_receipt", 422],
    ["policy_review_required", 422],
    ["review_closed", 409],
    ["not_found", 404],
  ] as const)(
    "RE-21 HTTP %s retains status, safe envelope and retryability without applied state",
    async (code, status) => {
      const x = await evidenceFixture(
        db,
        code.startsWith("date_")
          ? "date"
          : code === "policy_review_required"
            ? "card"
            : "price",
      );
      vi.stubEnv("DATABASE_URL", db.pool.options.connectionString);
      vi.stubEnv("BETTER_AUTH_URL", "https://reviews.example.test");
      vi.stubEnv("WHR_REVIEW_EVIDENCE_POLICY", JSON.stringify(x.config));
      const { handleReviews } =
        await import("../../src/server/modules/reviews/http");
      const { correctionStorage } =
        await import("../../src/server/modules/corrections/http");
      httpUsed = true;
      const spy = vi
        .spyOn(correctionStorage, "read")
        .mockImplementation(async (key, max) => {
          if (code === "temporarily_unavailable")
            throw new Error("private storage diagnostic");
          return x.h.storage.read(key, max);
        });
      let body: unknown = x.body,
        token = x.token,
        kind = x.kind,
        id = x.sale.purchaseId;
      if (code === "evidence_insufficient")
        vi.stubEnv("WHR_REVIEW_EVIDENCE_POLICY", undefined);
      if (code === "evidence_unavailable")
        body = { ...x.body, evidence: { ...x.evidence, assetId: newId() } };
      if (code === "invalid_request") body = { ...x.body, arbitrary: true };
      if (code === "unauthenticated") token = "unknown";
      if (code === "permission_denied")
        await db.pool.query(
          "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='priceReview'",
          [fixtureId(1)],
        );
      if (code === "version_conflict")
        body = { ...x.body, expectedVersion: x.body.expectedVersion + 1 };
      if (code === "meter_policy_unconfigured")
        body = {
          ...x.body,
          decision: {
            outcome: "correct_meter",
            amountKobo: "2100000",
            quantity: "21",
          },
        };
      if (code === "hold_kind_mismatch") {
        kind = "card";
        body = {
          ...(await x.h.guard(x.sale.purchaseId)),
          expectedHoldVersion: 1,
          evidence: x.evidence,
          outcome: "confirm_earlier",
        };
      }
      if (code === "date_invalid")
        body = { ...x.body, verifiedSaleDate: "2026-02-30" };
      if (code === "date_after_receipt")
        body = { ...x.body, verifiedSaleDate: "2099-01-01" };
      if (code === "review_closed")
        await seedHistorical(
          db.pool,
          "purchase",
          "UPDATE purchase SET status='cancelled',cancellation_reason='Fictional cancellation' WHERE id=$1",
          [x.sale.purchaseId],
        );
      if (code === "not_found") id = newId();
      const before = await state(x);
      try {
        const response = await handleReviews(
          new Request(
            `https://reviews.example.test/api/admin/sales/${id}/review`,
            {
              method: "POST",
              headers: {
                origin: "https://reviews.example.test",
                "content-type": "application/json",
                cookie: `__Host-whr-admin-session=${token}`,
              },
              body: JSON.stringify(body),
            },
          ),
          kind,
          id,
          x.holdId,
        );
        const envelope = await response.json();
        expect(response.status).toBe(status);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(envelope).toEqual({
          error: {
            code,
            message: "This request could not be completed.",
            retryable: status === 503,
          },
          serverTime: expect.any(String),
          requestId: expect.any(String),
        });
        expect(JSON.stringify(envelope)).not.toContain("private");
        expect(await state(x)).toEqual(before);
      } finally {
        spy.mockRestore();
        if (code === "permission_denied")
          await db.pool.query(
            "INSERT INTO role_permission(role_id,permission_code) VALUES($1,'priceReview')",
            [fixtureId(1)],
          );
      }
    },
  );
  it("RE-04 same original replay after fresh authentication preserves S R L U and receipt evidence", async () => {
    const x = await evidenceFixture(db);
    await frozenLookup(x, "2026-11-10T12:30:00Z");
    const before = (
      await db.pool.query(
        "SELECT server_received_at,capture_lower_bound,lookup_receipt_claims,capture_context_id FROM purchase WHERE id=$1",
        [x.sale.purchaseId],
      )
    ).rows;
    const fresh = await (
      await import("../helpers/sync-fixture")
    ).newSession(db.pool, x.f);
    await x.h.sync.submit(fresh.token, x.sale.original);
    expect(
      (
        await db.pool.query(
          "SELECT server_received_at,capture_lower_bound,lookup_receipt_claims,capture_context_id FROM purchase WHERE id=$1",
          [x.sale.purchaseId],
        )
      ).rows,
    ).toEqual(before);
    await succeeded(x);
  });
  it.each(["card_policy_unresolved", "capture_history_incomplete"])(
    "RE-16 independent %s gate remains zero-credit after successful targeted resolution",
    async (reason) => {
      const x = await evidenceFixture(db);
      await seedHistorical(
        db.pool,
        "sync_validation",
        "UPDATE sync_validation SET reasons=$2,campaign_eligible=false WHERE purchase_id=$1",
        [x.sale.purchaseId, JSON.stringify([reason])],
      );
      const { result, provenance } = await succeeded(x);
      expect(result.creditedAfter).toBe(false);
      expect(provenance.result.credited).toBe(false);
      expect(
        (
          await db.pool.query(
            "SELECT current_revision_id FROM purchase WHERE id=$1",
            [x.sale.purchaseId],
          )
        ).rows[0].current_revision_id,
      ).toBeNull();
    },
  );
  it("RE-16 capture confirmation does not waive receipt deadline or change persisted original eligibility", async () => {
    const x = await evidenceFixture(db, "capture");
    await db.pool.query(
      "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_time_unresolved','fixture',clock_timestamp(),1)",
      [newId(), x.sale.purchaseId],
    );
    await seedHistorical(
      db.pool,
      "settings_version",
      "UPDATE settings_version SET purchase_cutoff=$2,upload_deadline=$3 WHERE station_id=$1",
      [x.f.stationId, U, U],
    );
    await bounds(x, "2026-11-09T13:00:00Z", "2026-11-10T14:00:00Z", U);
    await frozenLookup(x, S);
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
    await succeeded(x);
    expect(
      (
        await db.pool.query(
          "SELECT * FROM sync_validation WHERE purchase_id=$1",
          [x.sale.purchaseId],
        )
      ).rows,
    ).toEqual(before);
  });
  it("RE-13 RE-17 capture confirmation cannot approve a recovered numeric proposal or remove P-19 maker exclusion", async () => {
    const x = await evidenceFixture(db, "capture"),
      correction = newId(),
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
          x.body.expectedVersion,
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
    const { result } = await succeeded(x, body);
    expect(result.after.amountKobo).toBe("2000000");
    expect(
      (
        await db.pool.query("SELECT * FROM correction_request WHERE id=$1", [
          correction,
        ])
      ).rows,
    ).toEqual(proposal);
    const { createCorrectionsService } =
      await import("../../src/server/modules/corrections/service");
    await denied(
      x,
      () =>
        createCorrectionsService({
          pool: db.pool,
          storage: x.h.storage,
        }).decide(x.token, x.sale.purchaseId, correction, {
          ...awaitGuard({
            ...x,
            body: {
              ...x.body,
              expectedVersion: body.expectedVersion + 1,
              expectedRevisionId: x.original,
            },
          }),
          expectedCorrectionVersion: 1,
          outcome: "approve",
        }),
      "permission_denied",
      403,
    );
  });
  it("RE-14 no open capture block cannot invent a capture decision", async () => {
    const x = await evidenceFixture(db, "capture");
    await seedHistorical(
      db.pool,
      "purchase_validation_block",
      "DELETE FROM purchase_validation_block WHERE purchase_id=$1",
      [x.sale.purchaseId],
    );
    await denied(x, () => decide(x), "review_closed", 409);
  });
  it("RE-14 capture block version change during evidence work rejects stale sale guard", async () => {
    const x = await evidenceFixture(db, "capture");
    let once = false;
    const storage = {
      ...x.h.storage,
      async read(key: string, max: number) {
        const bytes = await x.h.storage.read(key, max);
        if (!once) {
          once = true;
          await db.pool.query(
            "UPDATE purchase_validation_block SET version=version+1 WHERE purchase_id=$1",
            [x.sale.purchaseId],
          );
          await db.pool.query(
            "UPDATE purchase SET version=version+1 WHERE id=$1",
            [x.sale.purchaseId],
          );
        }
        return bytes;
      },
    };
    await expect(
      decide(x, x.body, service(x, x.config, storage)),
    ).rejects.toMatchObject({ code: "version_conflict", status: 409 });
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM review_evaluation WHERE purchase_id=$1",
          [x.sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await db.pool.query(
          "SELECT resolved_at FROM purchase_validation_block WHERE purchase_id=$1",
          [x.sale.purchaseId],
        )
      ).rows[0].resolved_at,
    ).toBeNull();
  });
  it.each(["confirm", "cancel"])(
    "RE-17 later finalize after capture %s cannot reopen resolved blocks or double-credit",
    async (outcome) => {
      const x = await evidenceFixture(db, "capture");
      if (outcome === "cancel")
        await db.pool.query(
          "UPDATE assignment SET effective_until=$2 WHERE id=$1",
          [x.f.assignmentId, S],
        );
      await succeeded(x, { ...x.body, outcome });
      let assignmentId = x.f.assignmentId;
      if (outcome === "cancel") {
        assignmentId = newId();
        await db.pool.query(
          "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,2,clock_timestamp(),$4,'Fictional new assignment')",
          [assignmentId, x.f.attendantId, x.f.pumpId, fixtureId(5)],
        );
      }
      const fresh = await (
        await import("../helpers/sync-fixture")
      ).newSession(db.pool, { ...x.f, assignmentId });
      const before = await state(x);
      const originalFinalize = (
        await db.pool.query(
          "SELECT operation_id,expected_version,upload_id FROM sync_finalize_operation WHERE purchase_id=$1",
          [x.sale.purchaseId],
        )
      ).rows[0];
      await x.h.sync.finalize(fresh.token, x.sale.purchaseId, {
        operationId: originalFinalize.operation_id,
        expectedVersion: originalFinalize.expected_version,
        uploadId: originalFinalize.upload_id,
      });
      expect(await state(x)).toEqual(before);
    },
  );
  it("RE-14 review competing with finalization cannot replace the chosen revision twice", async () => {
    const x = await evidenceFixture(db);
    const fresh = await (
      await import("../helpers/sync-fixture")
    ).newSession(db.pool, x.f);
    const results = await Promise.allSettled([
      decide(x),
      x.h.sync.finalize(fresh.token, x.sale.purchaseId, {
        operationId: newId(),
        expectedVersion: x.body.expectedVersion,
        uploadId: x.sale.assetId,
      }),
    ]);
    expect(results[0].status).toBe("fulfilled");
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM review_evaluation WHERE purchase_id=$1",
          [x.sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM purchase_revision WHERE purchase_id=$1 AND state='accepted'",
          [x.sale.purchaseId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it.each(["station", "environment", "scope-extra", "activation-extra"])(
    "RE-18 exact %s scope and nested fields are enforced by real endpoint guards",
    async (mode) => {
      const x = await evidenceFixture(db),
        config = structuredClone(x.config);
      const changed =
        mode === "station"
          ? { ...config, scope: { ...config.scope, stationId: newId() } }
          : mode === "environment"
            ? {
                ...config,
                scope: { ...config.scope, environment: "production" },
              }
            : mode === "scope-extra"
              ? { ...config, scope: { ...config.scope, arbitrary: true } }
              : {
                  ...config,
                  activation: { ...config.activation, arbitrary: true },
                };
      await denied(x, () => decide(x, x.body, service(x, changed)));
    },
  );
});

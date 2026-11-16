import pg from "pg";
import { createCorrectionsService } from "../../src/server/modules/corrections/service";
import { settle } from "../../src/server/modules/sync/settle";
import { transaction, type Purchase } from "../../src/server/modules/sync/repo";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { newId } from "../../src/server/lib/ids";
import { digest } from "../../src/server/modules/auth/crypto";
import { createHeldReleaseService } from "../../src/server/modules/reviews/release-service";
import { reviewEvidenceV2ReleaseArtifact } from "../../src/server/modules/reviews/release-v2";
import {
  evidenceDatabase,
  S,
  seedHistorical,
} from "../helpers/review-evidence-fixture";
import { heldReleaseFixture } from "../helpers/held-release-fixture";
// Dormant protocol only: actual installation remains denied and is verified separately.
vi.mock(
  "../../src/server/modules/reviews/release-v2",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    assertReleaseV2Installation: vi.fn(async () => {}),
  }),
);
let db: Awaited<ReturnType<typeof evidenceDatabase>>;
async function fixture(kind: "card" | "price" | "date" | "capture" = "card") {
  const x = await heldReleaseFixture(db, kind);
  const approval = newId();
  const policy = {
    release: "review-evidence-v2",
    digest: createHash("sha256")
      .update(reviewEvidenceV2ReleaseArtifact)
      .digest("hex"),
    revision: 2,
    scope: { stationId: x.f.stationId, environment: "test" },
    activation: {
      state: "active",
      approvalReference: approval,
      activatedAt: S,
    },
  };
  await db.pool.query(
    "INSERT INTO review_evidence_approval(id,release,digest,revision,station_id,environment,activated_at,authorization_reference) VALUES($1,$2,$3,2,$4,'test',$5,'Fictional isolated test approval')",
    [approval, policy.release, policy.digest, x.f.stationId, S],
  );
  await db.pool.query(
    "INSERT INTO review_evidence_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,'test',2,$3,'Fictional isolated test approval')",
    [newId(), x.f.stationId, policy],
  );
  const sheet = newId(),
    bytes = await x.h.image();
  await db.pool.query(
    "INSERT INTO held_release_sheet(id,purchase_id,station_id,uploader_id,uploader_person_id,target,sha256,bytes,staging_key,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp()+interval '15 minutes')",
    [
      sheet,
      x.sale.purchaseId,
      x.f.stationId,
      x.actors[0],
      x.people[0],
      x.target,
      createHash("sha256").update(bytes).digest("hex"),
      bytes.length,
      `staging/${sheet}`,
    ],
  );
  await db.pool.query(
    "INSERT INTO held_release_sheet_validation(asset_id,final_key,display_key) VALUES($1,$2,$3)",
    [sheet, `final/${sheet}`, `display/${sheet}`],
  );
  x.h.objects.set(`final/${sheet}`, bytes);
  x.h.objects.set(`display/${sheet}`, bytes);
  const reviewerToken = randomBytes(32).toString("hex");
  await db.pool.query(
    "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',1,clock_timestamp())",
    [newId(), x.actors[1], digest(reviewerToken)],
  );
  const body = {
    ...(await x.h.guard(x.sale.purchaseId)),
    target: x.target,
    outcome: "confirm",
    sheetAssetId: sheet,
    meterAssetId: x.sale.assetId,
    facts: x.facts,
  };
  const env = {
    ...process.env,
    WHR_ENV: "test",
    WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(policy),
  };
  const raw = createHeldReleaseService({
    pool: db.pool,
    storage: x.h.storage,
    env,
    readerFactory: () => ({
      read: x.h.storage.read,
      available: async () => true,
      signGet: async () => "https://evidence.example.test/fictional",
    }),
  });
  const proposalResponse = z
    .object({
      id: z.string().uuid(),
      state: z.enum(["pending", "approved", "rejected", "superseded"]),
    })
    .passthrough();
  const svc = {
    ...raw,
    async propose(...args: Parameters<typeof raw.propose>) {
      return z
        .object({ proposal: proposalResponse, replayed: z.boolean() })
        .parse(await raw.propose(...args));
    },
    async decide(...args: Parameters<typeof raw.decide>) {
      return z
        .object({
          proposal: proposalResponse,
          decision: z.object({ result: z.unknown() }).passthrough(),
        })
        .passthrough()
        .parse(await raw.decide(...args));
    },
  };
  return {
    ...x,
    body,
    policy,
    reviewerToken,
    svc,
  };
}

beforeAll(async () => {
  db = await evidenceDatabase();
}, 30000);
afterAll(async () => {
  await db.close();
});
async function approve(x: Awaited<ReturnType<typeof fixture>>) {
  const proposed = await x.svc.propose(x.token, x.sale.purchaseId, x.body);
  const result = await x.svc.decide(
    x.reviewerToken,
    x.sale.purchaseId,
    proposed.proposal.id,
    {
      ...(await x.h.guard(x.sale.purchaseId)),
      expectedProposalVersion: 1,
      outcome: "approve",
    },
  );
  return { proposed, result };
}
async function corrupt(x: Awaited<ReturnType<typeof fixture>>) {
  await seedHistorical(
    db.pool,
    "held_release_transition",
    "UPDATE held_release_transition SET content=jsonb_set(content,'{attestation,sourceIds}','[]') WHERE proposal_id IN (SELECT id FROM held_release_proposal WHERE purchase_id=$1) AND state='approved'",
    [x.sale.purchaseId],
  );
}
async function freshSeller(x: Awaited<ReturnType<typeof fixture>>) {
  const context = newId();
  await db.pool.query(
    "INSERT INTO capture_context(id,attendant_id,assignment_id,signed_in_at,offline_expires_at,seller_name,seller_username,device_binding_digest) SELECT $1,attendant_id,assignment_id,clock_timestamp(),clock_timestamp()+interval '24 hours',seller_name,seller_username,device_binding_digest FROM capture_context WHERE id=$2",
    [context, x.f.contextId],
  );
  const token = newId();
  await db.pool.query(
    "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,assignment_id,capture_context_id) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',1,clock_timestamp(),$4,$5)",
    [newId(), x.f.userId, digest(token), x.f.assignmentId, context],
  );
  x.f.token = token;
}
async function correction(x: Awaited<ReturnType<typeof fixture>>) {
  await freshSeller(x);
  const svc = createCorrectionsService({ pool: db.pool, storage: x.h.storage });
  const guard = await x.h.guard(x.sale.purchaseId);
  const submitted = await svc.submit(x.f.token, x.sale.purchaseId, {
    operationId: newId(),
    expectedVersion: guard.expectedVersion,
    basedOnRevisionId: guard.expectedRevisionId,
    edit: { basis: "amount", enteredAmountKobo: "3000000" },
    evidenceAssetId: x.sale.assetId,
    reason: "Fictional later correction",
  });
  for (let i = 0; i < 3 && (await svc.processNext()); i++);
  const c = (
    await db.pool.query(
      "SELECT id,version,state FROM correction_request WHERE id=$1",
      [submitted.data.id],
    )
  ).rows[0];
  return { svc, c };
}
it("SR-02a later validation rejects missing applied attestation provenance without rewriting original receipt", async () => {
  const x = await fixture();
  await approve(x);
  await corrupt(x);
  const before = (
    await db.pool.query(
      "SELECT to_jsonb(p) value FROM purchase p WHERE id=$1",
      [x.sale.purchaseId],
    )
  ).rows;
  await expect(
    transaction(db.pool, async (client) => {
      const p = (
        await client.query<Purchase>(
          "SELECT * FROM purchase WHERE id=$1 FOR UPDATE",
          [x.sale.purchaseId],
        )
      ).rows[0]!;
      await settle(client, p, x.f.userId, newId(), x.sale.assetId);
    }),
  ).rejects.toMatchObject({ code: "evidence_insufficient" });
  expect(
    (
      await db.pool.query(
        "SELECT to_jsonb(p) value FROM purchase p WHERE id=$1",
        [x.sale.purchaseId],
      )
    ).rows,
  ).toEqual(before);
});
it("SR-02a later correction approval rejects corrupt retained attestation and preserves accepted values", async () => {
  const x = await fixture();
  await approve(x);
  const { svc, c } = await correction(x);
  expect(c.state).toBe("awaiting_review");
  await corrupt(x);
  const before = (
    await db.pool.query(
      "SELECT current_revision_id,version,status FROM purchase WHERE id=$1",
      [x.sale.purchaseId],
    )
  ).rows;
  await expect(
    svc.decide(x.reviewerToken, x.sale.purchaseId, c.id, {
      ...(await x.h.guard(x.sale.purchaseId)),
      expectedCorrectionVersion: c.version,
      outcome: "approve",
    }),
  ).rejects.toMatchObject({ code: "evidence_insufficient" });
  expect(
    (
      await db.pool.query(
        "SELECT current_revision_id,version,status FROM purchase WHERE id=$1",
        [x.sale.purchaseId],
      )
    ).rows,
  ).toEqual(before);
});
it("SR-05 later valid correction keeps attestation history while accepting exactly one numeric revision", async () => {
  const x = await fixture();
  await approve(x);
  const history = (
    await db.pool.query(
      "SELECT to_jsonb(t) value FROM held_release_transition t ORDER BY id",
    )
  ).rows;
  const { svc, c } = await correction(x);
  expect(c.state).toBe("awaiting_review");
  const input = {
    ...(await x.h.guard(x.sale.purchaseId)),
    expectedCorrectionVersion: c.version,
    outcome: "approve",
  };
  const result = await svc.decide(
    x.reviewerToken,
    x.sale.purchaseId,
    c.id,
    input,
  );
  expect(result.after.amountKobo).toBe("3000000");
  expect(
    await svc.decide(x.reviewerToken, x.sale.purchaseId, c.id, input),
  ).toEqual(result);
  expect(
    (
      await db.pool.query(
        "SELECT to_jsonb(t) value FROM held_release_transition t ORDER BY id",
      )
    ).rows,
  ).toEqual(history);
});
it("SR-05 card attestation preserves exact retained meter candidate instead of restoring captured numbers", async () => {
  const x = await fixture();
  const candidate = newId();
  await seedHistorical(
    db.pool,
    "purchase_revision",
    "INSERT INTO purchase_revision SELECT (jsonb_populate_record(NULL::purchase_revision,to_jsonb(r)||jsonb_build_object('id',$2::text,'operation_id',$3::text,'revision_number',2,'kind','price_resolution','reason','Fictional prior meter decision','calculation_mode','meter_evidence','amount_kobo',1999000,'quantity',19.99,'based_on_revision_id',r.id))).* FROM purchase_revision r WHERE id=$1",
    [x.original, candidate, newId()],
  );
  await seedHistorical(
    db.pool,
    "purchase",
    "UPDATE purchase SET resolution_candidate_revision_id=$2 WHERE id=$1",
    [x.sale.purchaseId, candidate],
  );
  x.original = candidate;
  x.body.facts.recordedAmountKobo = "1999000";
  x.body.facts.recordedQuantity = "19.99";
  const before = (
    await db.pool.query(
      "SELECT amount_kobo::text,quantity::text,entered_amount_kobo::text,rate_kobo::text,calculation_mode FROM purchase_revision WHERE id=$1",
      [x.original],
    )
  ).rows;
  const { result } = await approve(x);
  expect(result.decision.result).toMatchObject({
    after: {
      amountKobo: "1999000",
      quantity: "19.99",
      calculation: "meter_evidence",
    },
  });
  expect(
    (
      await db.pool.query(
        "SELECT amount_kobo::text,quantity::text,entered_amount_kobo::text,rate_kobo::text,calculation_mode FROM purchase_revision WHERE id=$1",
        [x.original],
      )
    ).rows,
  ).toEqual(before);
});
it("SR-08 non-superuser cannot update delete or truncate retained proposal transition and sheet history", async () => {
  const x = await fixture();
  await approve(x);
  const role = `release_retention_${newId().replaceAll("-", "")}`,
    q = pg.escapeIdentifier(role),
    schema = (await db.pool.query("SELECT current_schema() s")).rows[0].s;
  await db.pool.query(`CREATE ROLE ${q} NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  try {
    await db.pool.query(
      `GRANT USAGE ON SCHEMA ${pg.escapeIdentifier(schema)} TO ${q}`,
    );
    await db.pool.query(
      `GRANT SELECT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA ${pg.escapeIdentifier(schema)} TO ${q}`,
    );
    for (const table of [
      "held_release_proposal",
      "held_release_transition",
      "held_release_sheet",
      "held_release_sheet_validation",
    ]) {
      for (const sql of [
        `UPDATE ${table} SET ${table === "held_release_sheet_validation" ? "final_key=final_key" : "" + (table === "held_release_transition" ? "content=content" : "id=id")}`,
        `DELETE FROM ${table}`,
        `TRUNCATE ${table} CASCADE`,
      ]) {
        const client = await db.pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(`SET LOCAL ROLE ${q}`);
          expect(
            (
              await client.query(
                "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",
              )
            ).rows[0].rolsuper,
          ).toBe(false);
          await expect(client.query(sql)).rejects.toBeDefined();
        } finally {
          await client.query("ROLLBACK");
          client.release();
        }
      }
    }
  } finally {
    await db.pool.query(`DROP OWNED BY ${q}`);
    await db.pool.query(`DROP ROLE ${q}`);
  }
  expect(
    (await db.pool.query("SELECT count(*)::int n FROM held_release_proposal"))
      .rows[0].n,
  ).toBe(1);
});

it("SR-05/SR-06 ordinary target closure supersedes pending paper proposal with linked immutable event", async () => {
  const x = await fixture(),
    proposed = await x.svc.propose(x.token, x.sale.purchaseId, x.body);
  // Fixture models corrected authoritative replacement history that now lets v1 settle.
  for (const [table, sql] of [
    [
      "card",
      "UPDATE card SET retired_at='2026-11-10T11:59:00Z' WHERE id=(SELECT card_id FROM purchase WHERE id=$1)",
    ],
    [
      "card_customer_link",
      "UPDATE card_customer_link SET ended_at='2026-11-10T11:59:00Z' WHERE card_id=(SELECT card_id FROM purchase WHERE id=$1) AND ended_at IS NOT NULL",
    ],
    [
      "audit_event",
      "UPDATE audit_event SET occurred_at='2026-11-10T11:59:00Z' WHERE action='card_replaced' AND target_id=(SELECT card_id FROM purchase WHERE id=$1)",
    ],
  ])
    await seedHistorical(db.pool, table!, sql!, [x.sale.purchaseId]);
  const { createReviewsService } =
    await import("../../src/server/modules/reviews/service");
  const svc = createReviewsService({
    pool: db.pool,
    storage: x.h.storage,
    env: {
      WHR_ENV: "test",
      WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(x.policy),
    },
  });
  const guard = await x.h.guard(x.sale.purchaseId);
  const result = await svc.decideCard(x.token, x.sale.purchaseId, x.holdId, {
    ...guard,
    expectedHoldVersion: 1,
    outcome: "cancel",
    evidence: x.evidence,
  });
  expect(result.creditedAfter).toBe(false);
  expect(
    (
      await db.pool.query(
        "SELECT state FROM held_release_state WHERE proposal_id=$1",
        [proposed.proposal.id],
      )
    ).rows[0].state,
  ).toBe("superseded");
  const event = (
    await db.pool.query(
      "SELECT related_event_ids FROM audit_event WHERE action='held_release_superseded' AND target_id=$1",
      [x.sale.purchaseId],
    )
  ).rows[0];
  expect(event.related_event_ids).toContain(result.auditEventId);
});

it("SR-05 concurrent later correction approvals retain attestation and accept one guarded revision", async () => {
  const x = await fixture();
  await approve(x);
  const { svc, c } = await correction(x),
    guard = await x.h.guard(x.sale.purchaseId);
  const results = await Promise.allSettled([
    svc.decide(x.token, x.sale.purchaseId, c.id, {
      ...guard,
      expectedCorrectionVersion: c.version,
      outcome: "approve",
    }),
    svc.decide(x.reviewerToken, x.sale.purchaseId, c.id, {
      ...guard,
      operationId: newId(),
      expectedCorrectionVersion: c.version,
      outcome: "approve",
    }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM held_release_state WHERE state='approved'",
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM sale_decision WHERE purchase_id=$1 AND kind='correction'",
        [x.sale.purchaseId],
      )
    ).rows[0].n,
  ).toBe(1);
});

it("SR-05 ordinary target closure racing stale paper approval has one terminal application", async () => {
  const x = await fixture(),
    proposed = await x.svc.propose(x.token, x.sale.purchaseId, x.body);
  // Fixture models corrected authoritative replacement history that now lets v1 settle.
  for (const [table, sql] of [
    [
      "card",
      "UPDATE card SET retired_at='2026-11-10T11:59:00Z' WHERE id=(SELECT card_id FROM purchase WHERE id=$1)",
    ],
    [
      "card_customer_link",
      "UPDATE card_customer_link SET ended_at='2026-11-10T11:59:00Z' WHERE card_id=(SELECT card_id FROM purchase WHERE id=$1) AND ended_at IS NOT NULL",
    ],
    [
      "audit_event",
      "UPDATE audit_event SET occurred_at='2026-11-10T11:59:00Z' WHERE action='card_replaced' AND target_id=(SELECT card_id FROM purchase WHERE id=$1)",
    ],
  ])
    await seedHistorical(db.pool, table!, sql!, [x.sale.purchaseId]);
  const { createReviewsService } =
    await import("../../src/server/modules/reviews/service");
  const svc = createReviewsService({
    pool: db.pool,
    storage: x.h.storage,
    env: {
      WHR_ENV: "test",
      WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(x.policy),
    },
  });
  const guard = await x.h.guard(x.sale.purchaseId);
  const results = await Promise.allSettled([
    svc.decideCard(x.token, x.sale.purchaseId, x.holdId, {
      ...guard,
      expectedHoldVersion: 1,
      outcome: "cancel",
      evidence: x.evidence,
    }),
    x.svc.decide(x.reviewerToken, x.sale.purchaseId, proposed.proposal.id, {
      ...guard,
      operationId: newId(),
      expectedProposalVersion: 1,
      outcome: "approve",
    }),
  ]);
  expect(results[0]!.status).toBe("fulfilled");
  expect(results[1]!.status).toBe("rejected");
  const result = (
    results[0] as PromiseFulfilledResult<
      Awaited<ReturnType<typeof svc.decideCard>>
    >
  ).value;
  expect(result.creditedAfter).toBe(false);
  expect(
    (
      await db.pool.query(
        "SELECT state FROM held_release_state WHERE proposal_id=$1",
        [proposed.proposal.id],
      )
    ).rows[0].state,
  ).toBe("superseded");
  const event = (
    await db.pool.query(
      "SELECT related_event_ids FROM audit_event WHERE action='held_release_superseded' AND target_id=$1",
      [x.sale.purchaseId],
    )
  ).rows[0];
  expect(event.related_event_ids).toContain(result.auditEventId);
});

it("SR-05 correction submission racing paper proposal cannot reuse the same purchase guard", async () => {
  const x = await fixture();
  // Existing accepted candidate under a later card hold; neither pending proposal changes credit.
  await seedHistorical(
    db.pool,
    "purchase_revision",
    "UPDATE purchase_revision SET state='accepted',decision_actor_id=$2,decision_reason='Fictional retained acceptance',decided_at=clock_timestamp() WHERE id=$1",
    [x.original, x.actors[0]],
  );
  await seedHistorical(
    db.pool,
    "purchase",
    "UPDATE purchase SET current_revision_id=$2 WHERE id=$1",
    [x.sale.purchaseId, x.original],
  );
  await freshSeller(x);
  const guard = await x.h.guard(x.sale.purchaseId),
    svc = createCorrectionsService({ pool: db.pool, storage: x.h.storage });
  const replies = await Promise.allSettled([
    x.svc.propose(x.token, x.sale.purchaseId, { ...x.body, ...guard }),
    svc.submit(x.f.token, x.sale.purchaseId, {
      operationId: newId(),
      expectedVersion: guard.expectedVersion,
      basedOnRevisionId: guard.expectedRevisionId,
      edit: { basis: "amount", enteredAmountKobo: "3000000" },
      evidenceAssetId: x.sale.assetId,
      reason: "Fictional racing correction",
    }),
  ]);
  expect(replies.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(replies.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM purchase_hold WHERE purchase_id=$1 AND state='open'",
        [x.sale.purchaseId],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.pool.query(
        "SELECT current_revision_id FROM purchase WHERE id=$1",
        [x.sale.purchaseId],
      )
    ).rows[0].current_revision_id,
  ).toBe(x.original);
});

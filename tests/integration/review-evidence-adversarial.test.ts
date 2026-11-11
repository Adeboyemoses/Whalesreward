import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createReviewsService } from "../../src/server/modules/reviews/service";
import {
  cookieToken,
  COOKIE,
} from "../../src/server/modules/admin-access/http";
import { digest } from "../../src/server/modules/auth/crypto";
import { newId } from "../../src/server/lib/ids";
import { fixtureId, newSession } from "../helpers/sync-fixture";
import {
  activate,
  evidenceDatabase,
  evidenceFixture,
  replacement,
  seedHistorical,
  state,
  type Fixture,
  type Kind,
} from "../helpers/review-evidence-fixture";

let db: Awaited<ReturnType<typeof evidenceDatabase>>;
function service(x: Fixture, configuration: unknown = x.config) {
  return createReviewsService({
    pool: db.pool,
    storage: x.h.storage,
    env: {
      ...process.env,
      WHR_ENV: "test",
      WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(configuration),
    },
  });
}
function decide(
  x: Fixture,
  body: unknown = x.body,
  svc = service(x),
  token: string | null = x.token,
) {
  if (x.kind === "price")
    return svc.decidePrice(
      token ?? undefined,
      x.sale.purchaseId,
      x.holdId,
      body,
    );
  if (x.kind === "card")
    return svc.decideCard(
      token ?? undefined,
      x.sale.purchaseId,
      x.holdId,
      body,
    );
  if (x.kind === "date")
    return svc.decideDate(
      token ?? undefined,
      x.sale.purchaseId,
      x.holdId,
      body,
    );
  return svc.decideCapture(token ?? undefined, x.sale.purchaseId, body);
}
async function denied(
  x: Fixture,
  operation: () => Promise<unknown>,
  code = "evidence_insufficient",
  status = 422,
) {
  const before = await state(x);
  await expect(operation()).rejects.toMatchObject({ code, status });
  expect(await state(x)).toEqual(before);
}
async function dateHold(x: Fixture) {
  const id = newId();
  await seedHistorical(
    db.pool,
    "purchase",
    "UPDATE purchase SET status='held',version=version+1 WHERE id=$1 AND status='credited'",
    [x.sale.purchaseId],
  );
  await db.pool.query(
    "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,'date','open',$3,'capture_date_uncertain',1)",
    [id, x.sale.purchaseId, x.original],
  );
  return {
    id,
    body: {
      ...(await x.h.guard(x.sale.purchaseId)),
      expectedHoldVersion: 1,
      verifiedSaleDate: "2026-11-10",
      evidence: x.evidence,
    },
  };
}

describe("P-25 adversarial evidence identity and replay", () => {
  beforeAll(async () => {
    vi.stubEnv("WHR_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    db = await evidenceDatabase();
  }, 30000);
  afterAll(async () => {
    await db?.close();
    vi.unstubAllEnvs();
  });

  it("RE-01 one UUID naming two applicable source categories is ambiguous and cannot authorize", async () => {
    const x = await evidenceFixture(db);
    await seedHistorical(
      db.pool,
      "audit_event",
      "UPDATE audit_event SET id=$2 WHERE id=$1",
      [x.priceAudit, x.f.contextId],
    );
    await denied(x, () =>
      decide(x, {
        ...x.body,
        evidence: { ...x.evidence, referenceIds: [x.f.contextId] },
      }),
    );
    // The historical evidence remains sufficient without the ambiguous explicit reference.
    expect((await decide(x)).creditedAfter).toBe(true);
  });
  it.each(["reference", "primary"])(
    "RE-01 actual other-sale photo supplied as %s does not disclose or authorize",
    async (mode) => {
      const x = await evidenceFixture(db);
      const fresh = await newSession(db.pool, x.f);
      const foreign = await x.h.settle({ ...x.f, ...fresh }, x.bytes, {
        captureContextId: fresh.contextId,
        appCapturedAt: new Date().toISOString(),
      });
      expect(foreign.purchaseId).not.toBe(x.sale.purchaseId);
      expect(
        (
          await db.pool.query("SELECT state FROM photo_asset WHERE id=$1", [
            foreign.assetId,
          ])
        ).rows[0].state,
      ).toBe("validated");
      const evidence =
        mode === "reference"
          ? { ...x.evidence, referenceIds: [foreign.assetId] }
          : { ...x.evidence, assetId: foreign.assetId };
      await denied(
        x,
        () => decide(x, { ...x.body, evidence }),
        mode === "primary" ? "evidence_unavailable" : "evidence_insufficient",
      );
    },
  );
  it("RE-02 a two-decision dependency cycle is rejected with no new receipt or contribution", async () => {
    const x = await evidenceFixture(db);
    await decide(x);
    const first = (
      await db.pool.query(
        "SELECT decision_id,provenance FROM review_evaluation WHERE purchase_id=$1",
        [x.sale.purchaseId],
      )
    ).rows[0];
    const h = await dateHold(x);
    await service(x).decideDate(x.token, x.sale.purchaseId, h.id, h.body);
    const second = (
      await db.pool.query(
        "SELECT decision_id,provenance FROM review_evaluation WHERE purchase_id=$1 AND decision_id<>$2",
        [x.sale.purchaseId, first.decision_id],
      )
    ).rows[0];
    // Build corrupt historical provenance, restoring all immutability guards before service execution.
    for (const [from, to] of [
      [first, second],
      [second, first],
    ]) {
      from.provenance.sources.unshift({
        category: "derived_evidence",
        id: to.decision_id,
        dependencies: [],
      });
      await seedHistorical(
        db.pool,
        "review_evaluation",
        "UPDATE review_evaluation SET provenance=$2 WHERE decision_id=$1",
        [from.decision_id, from.provenance],
      );
    }
    const next = await dateHold(x);
    await denied(x, () =>
      service(x).decideDate(x.token, x.sale.purchaseId, next.id, {
        ...next.body,
        evidence: { ...x.evidence, referenceIds: [first.decision_id] },
      }),
    );
  });
  it.each(["valid", "old-card", "customer", "replacement", "missing-link"])(
    "RE-08 %s binding proves only an exact historical card replacement",
    async (mode) => {
      const x = await evidenceFixture(db, "card");
      const audit = await replacement(x, "2026-11-10T13:00:00.000001Z");
      // Keep E<=R and U<E by capping the original interval at its original expiry.
      await seedHistorical(
        db.pool,
        "capture_context",
        "UPDATE capture_context SET signed_in_at='2026-11-09T13:00:00Z',offline_expires_at='2026-11-10T13:00:00Z' WHERE id=$1",
        [x.f.contextId],
      );
      await seedHistorical(
        db.pool,
        "purchase",
        "UPDATE purchase SET server_received_at='2026-11-10T14:00:00Z',capture_lower_bound='2026-11-10T12:00:00Z' WHERE id=$1",
        [x.sale.purchaseId],
      );
      if (mode === "missing-link")
        await seedHistorical(
          db.pool,
          "card_customer_link",
          "DELETE FROM card_customer_link WHERE card_id=$1",
          [fixtureId(29)],
        );
      else if (mode === "old-card")
        await seedHistorical(
          db.pool,
          "audit_event",
          "UPDATE audit_event SET target_id=$2 WHERE id=$1",
          [audit, newId()],
        );
      else if (mode !== "valid")
        await seedHistorical(
          db.pool,
          "audit_event",
          "UPDATE audit_event SET after=jsonb_set(after,$2::text[],to_jsonb($3::text)) WHERE id=$1",
          [
            audit,
            [mode === "customer" ? "customerId" : "replacementCardId"],
            newId(),
          ],
        );
      if (mode === "valid")
        expect((await decide(x)).outcome).toBe("confirm_earlier");
      else await denied(x, () => decide(x));
      expect(
        (
          await db.pool.query("SELECT state FROM card WHERE id=$1", [
            fixtureId(29),
          ])
        ).rows[0].state,
      ).toBe("retired");
    },
  );
  it.each(["price", "card", "date", "capture"] as Kind[])(
    "RE-13 %s rejects a valid recovery grant in recovery and admin cookie positions",
    async (kind) => {
      const x = await evidenceFixture(db, kind),
        token = randomBytes(32).toString("hex");
      await db.pool.query(
        "INSERT INTO recovery_grant(id,admin_id,originating_attendant_id,device_binding_digest,manifest_digest,secret_hash,reason,expires_at,version) VALUES($1,$2,$3,'fictional-device','fictional-manifest',$4,'Fictional recovery',clock_timestamp()+interval '1 hour',1)",
        [newId(), fixtureId(5), fixtureId(6), digest(token)],
      );
      for (const name of ["__Host-whr-recovery", COOKIE]) {
        const parsed = cookieToken(
          new Request("https://example.test/api/admin/sales/review", {
            headers: { cookie: `${name}=${token}` },
          }),
        );
        await denied(
          x,
          () => decide(x, x.body, service(x), parsed ?? null),
          "unauthenticated",
          401,
        );
      }
    },
  );
  it("RE-15 an active higher policy revision replays the immutable original exactly once", async () => {
    const x = await evidenceFixture(db),
      result = await decide(x);
    const before = await state(x),
      next = await activate(db.pool, x.f.stationId, 2);
    expect(await decide(x, x.body, service(x, next))).toEqual(result);
    expect(await state(x)).toEqual(before);
    const rows = (
      await db.pool.query(
        "SELECT provenance FROM review_evaluation WHERE purchase_id=$1",
        [x.sale.purchaseId],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].provenance.policy).toEqual(x.config);
  });
  it("RE-15 a revoked caller cannot retrieve a previously successful replay", async () => {
    const x = await evidenceFixture(db);
    await decide(x);
    await db.pool.query(
      "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE secret_verifier=$1",
      [digest(x.token)],
    );
    await denied(x, () => decide(x), "unauthenticated", 401);
  });
});

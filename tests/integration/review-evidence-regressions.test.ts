import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createReviewsService } from "../../src/server/modules/reviews/service";
import { newId } from "../../src/server/lib/ids";
import { fixtureId } from "../helpers/sync-fixture";
import {
  evidenceDatabase,
  evidenceFixture,
  replacement,
  seedHistorical,
  state,
  U,
  type Fixture,
} from "../helpers/review-evidence-fixture";

let db: Awaited<ReturnType<typeof evidenceDatabase>>;
function service(x: Fixture) {
  return createReviewsService({
    pool: db.pool,
    storage: x.h.storage,
    env: {
      ...process.env,
      WHR_ENV: "test",
      WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(x.config),
    },
  });
}
async function freezeLookup(x: Fixture) {
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
  const at = "2026-11-10T12:30:00.000Z";
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
        stationId: x.f.stationId,
        cardId: fixtureId(29),
        customerId: link.customer_id,
        cardCustomerLinkId: link.id,
        issuedAt: at,
        expiresAt: context.offline_expires_at.toISOString(),
      },
      at,
    ],
  );
}
async function dateDecision(x: Fixture, reference: string) {
  await seedHistorical(
    db.pool,
    "purchase",
    "UPDATE purchase SET status='held',version=version+1 WHERE id=$1 AND status='credited'",
    [x.sale.purchaseId],
  );
  const holdId = newId();
  await db.pool.query(
    "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,'date','open',$3,'capture_date_uncertain',1)",
    [holdId, x.sale.purchaseId, x.original],
  );
  const body = {
    ...(await x.h.guard(x.sale.purchaseId)),
    expectedHoldVersion: 1,
    verifiedSaleDate: "2026-11-10",
    evidence: { ...x.evidence, referenceIds: [reference] },
  };
  return {
    run: () => service(x).decideDate(x.token, x.sale.purchaseId, holdId, body),
  };
}
async function twoHop(x: Fixture) {
  await freezeLookup(x);
  const a = await service(x).decidePrice(
    x.token,
    x.sale.purchaseId,
    x.holdId,
    x.body,
  );
  const b = await (await dateDecision(x, a.id)).run();
  return { a, b };
}
describe("review evidence round-one regressions", () => {
  beforeAll(async () => {
    db = await evidenceDatabase();
  });
  afterAll(async () => {
    await db?.close();
  });
  it.each(["2026-11-10T13:00:00.000001Z", "2026-11-10T13:00:00.000002Z"])(
    "confirms U<E<=R at stored microsecond precision with R=%s",
    async (receipt) => {
      const x = await evidenceFixture(db, "card");
      await seedHistorical(
        db.pool,
        "capture_context",
        "UPDATE capture_context SET offline_expires_at=$2,signed_in_at=$2::timestamptz-interval '24 hours' WHERE id=$1",
        [x.f.contextId, U],
      );
      await seedHistorical(
        db.pool,
        "purchase",
        "UPDATE purchase SET server_received_at=$2 WHERE id=$1",
        [x.sale.purchaseId, receipt],
      );
      await replacement(x, "2026-11-10T13:00:00.000001Z");
      const result = await service(x).decideCard(
        x.token,
        x.sale.purchaseId,
        x.holdId,
        x.body,
      );
      expect(result.outcome).toBe("confirm_earlier");
      expect(result.remainingHolds).toEqual([]);
      const after = await state(x);
      expect(
        await service(x).decideCard(
          x.token,
          x.sale.purchaseId,
          x.holdId,
          x.body,
        ),
      ).toEqual(result);
      expect(await state(x)).toEqual(after);
      const provenance = (
        await db.pool.query(
          "SELECT provenance FROM review_evaluation WHERE decision_id=$1",
          [result.id],
        )
      ).rows[0].provenance;
      expect(BigInt(provenance.interval.U)).toBeLessThan(
        BigInt(provenance.conclusions[0].replacementAt),
      );
      expect(
        BigInt(provenance.conclusions[0].replacementAt),
      ).toBeLessThanOrEqual(BigInt(provenance.interval.R));
    },
  );
  it("reproduces persisted P-23 evidence across A to B to C without treating frozen lookup dependencies as UUIDs", async () => {
    const x = await evidenceFixture(db, "price");
    const { a, b } = await twoHop(x);
    const c = await dateDecision(x, b.id);
    const result = await c.run();
    const after = await state(x);
    expect(await c.run()).toEqual(result);
    expect(await state(x)).toEqual(after);
    const evaluations = (
      await db.pool.query(
        "SELECT decision_id,provenance FROM review_evaluation WHERE purchase_id=$1",
        [x.sale.purchaseId],
      )
    ).rows;
    expect(evaluations).toHaveLength(3);
    const final = evaluations.find(
      (e) => e.decision_id === result.id,
    ).provenance;
    expect(final.lookup.status).toBe("frozen");
    expect(
      final.sources
        .filter((s: { category: string }) => s.category === "derived_evidence")
        .map((s: { id: string }) => s.id),
    ).toEqual(expect.arrayContaining([a.id, b.id]));
  });
  it.each(["not-a-uuid", "00000000-0000-4000-8000-000000000000:lookup"])(
    "rejects malformed or foreign internal dependency %s with 422 and no writes",
    async (dependency) => {
      const x = await evidenceFixture(db, "price");
      const { b } = await twoHop(x);
      const provenance = (
        await db.pool.query(
          "SELECT provenance FROM review_evaluation WHERE decision_id=$1",
          [b.id],
        )
      ).rows[0].provenance;
      provenance.sources
        .find((s: { category: string }) => s.category === "derived_evidence")
        .dependencies.push(dependency);
      await seedHistorical(
        db.pool,
        "review_evaluation",
        "UPDATE review_evaluation SET provenance=$2 WHERE decision_id=$1",
        [b.id, provenance],
      );
      const c = await dateDecision(x, b.id);
      const before = await state(x);
      await expect(c.run()).rejects.toMatchObject({
        code: "evidence_insufficient",
        status: 422,
      });
      expect(await state(x)).toEqual(before);
    },
  );
});

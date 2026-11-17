import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readSales } from "../../src/server/modules/sales/service";
import { createReviewsService } from "../../src/server/modules/reviews/service";
import { saleDetailSchema } from "../../src/shared/contracts/sales";
import { newSession } from "../helpers/sync-fixture";
import { newId } from "../../src/server/lib/ids";
import {
  evidenceDatabase,
  evidenceFixture,
  seedHistorical,
} from "../helpers/review-evidence-fixture";

let db: Awaited<ReturnType<typeof evidenceDatabase>>;
const config = {
  secret: randomBytes(32).toString("hex"),
  origin: "https://reviews.example.test",
};
async function detail(token: string, id: string) {
  return saleDetailSchema.parse(
    await readSales(db.pool, config, token, "admin", "detail", {}, id),
  );
}
async function original(id: string) {
  return (
    await db.pool.query(
      "SELECT to_jsonb(r) value FROM purchase_revision r WHERE purchase_id=$1 AND kind='original'",
      [id],
    )
  ).rows[0]!.value;
}

describe("WHR-181 immutable original date on real PostgreSQL", () => {
  beforeAll(async () => {
    vi.stubEnv("WHR_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("BETTER_AUTH_SECRET", config.secret);
    db = await evidenceDatabase();
  }, 30000);
  afterAll(async () => {
    await db?.close();
    vi.unstubAllEnvs();
  });
  it.each([false, true])(
    "I-34 ordinary date resolution preserves original Values with another hold=%s",
    async (anotherHold) => {
      const x = await evidenceFixture(db, "date");
      if (anotherHold)
        await db.pool.query(
          "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,'price','open',$3,'price_uncertain',1)",
          [newId(), x.sale.purchaseId, x.original],
        );
      const before = await detail(x.token, x.sale.purchaseId);
      const revisionBefore = await original(x.sale.purchaseId);
      expect(before.original.verifiedSaleDate).toBeNull();
      const svc = createReviewsService({
        pool: db.pool,
        storage: x.h.storage,
        env: {
          ...process.env,
          WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(x.config),
        },
      });
      const decision = await svc.decideDate(
        x.token,
        x.sale.purchaseId,
        x.holdId,
        x.body,
      );
      expect(
        await svc.decideDate(x.token, x.sale.purchaseId, x.holdId, x.body),
      ).toEqual(decision);
      const after = await detail(x.token, x.sale.purchaseId);
      expect(after.original).toEqual(before.original);
      expect(await original(x.sale.purchaseId)).toEqual(revisionBefore);
      expect(after.verifiedSaleDate).toBe("2026-11-10");
      expect(decision.after.verifiedSaleDate).toBe("2026-11-10");
      expect(after.credited).toBe(!anotherHold);
      expect(after.displayedValues.verifiedSaleDate).toBe(
        anotherHold ? null : "2026-11-10",
      );
      expect(after.displayedSource).toBe(
        anotherHold ? "original" : "accepted_revision",
      );
    },
  );
  it("I-41 retains a non-null date captured in the original revision instead of hard-coding null", async () => {
    const x = await evidenceFixture(db, "price");
    await seedHistorical(
      db.pool,
      "purchase_revision",
      "UPDATE purchase_revision SET verified_sale_date='2026-11-09' WHERE id=$1",
      [x.original],
    );
    await db.pool.query(
      "UPDATE purchase SET verified_sale_date='2026-11-10',version=version+1 WHERE id=$1",
      [x.sale.purchaseId],
    );
    const sale = await detail(x.token, x.sale.purchaseId);
    expect(sale.original.verifiedSaleDate).toBe("2026-11-09");
    expect(sale.displayedValues.verifiedSaleDate).toBe("2026-11-09");
    expect(sale.verifiedSaleDate).toBe("2026-11-10");
  });
  it("I-41 pending purchase without an original revision has an original null verified date", async () => {
    const x = await evidenceFixture(db, "date");
    const session = await newSession(db.pool, x.f);
    const pending = await x.h.sync.submit(session.token, {
      ...x.sale.original,
      captureContextId: session.contextId,
      operationId: newId(),
    });
    const sale = await detail(x.token, pending.status.purchaseId);
    expect(sale.original.verifiedSaleDate).toBeNull();
    expect(sale.displayedValues.verifiedSaleDate).toBeNull();
  });
});

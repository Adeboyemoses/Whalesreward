import { randomBytes } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { evidenceDatabase } from "../helpers/review-evidence-fixture";
import { reviewFixtureHarness } from "../helpers/review-fixture";
import { runDuplicateBatch } from "../../src/server/modules/duplicates/service";
import { changePrice } from "../helpers/sync-fixture";

let db: Awaited<ReturnType<typeof evidenceDatabase>>;
let h: ReturnType<typeof reviewFixtureHarness>;
describe("I-41 canonical transactional sales audit", () => {
  beforeAll(async () => {
    vi.stubEnv("WHR_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    db = await evidenceDatabase();
    h = reviewFixtureHarness(db.pool);
  }, 30000);
  afterAll(async () => {
    await db?.close();
    vi.unstubAllEnvs();
  });
  it("intake and accepted settlement each write once with actual executor and original seller", async () => {
    const bytes = await h.image(),
      f = await h.context(bytes);
    const sale = await h.settle(f, bytes);
    await h.sync.submit(f.token, sale.original);
    const rows = (
      await db.pool.query(
        "SELECT * FROM audit_event WHERE target_id=$1 ORDER BY occurred_at,id",
        [sale.purchaseId],
      )
    ).rows;
    expect(rows.map((r) => r.action)).toEqual([
      "sale_received",
      "sale_credited",
    ]);
    expect(rows[0].actor_snapshot).toMatchObject({
      kind: "attendant",
      userId: f.userId,
    });
    expect(rows[1].actor_snapshot).toMatchObject({
      kind: "system",
      service: "validation",
    });
    expect(rows[1].originating_seller_snapshot.accountId).toBe(f.userId);
    expect(rows[1].before).toMatchObject({
      state: "photo_pending",
      photoAssetId: null,
      candidateRevisionId: null,
      credited: false,
      creditedSpendKobo: "0",
    });
    expect(rows[1].after).toMatchObject({
      revisionId: sale.currentRevisionId,
      credited: true,
      creditedSpendKobo: "2000000",
      calculation: "captured_rate",
      holdKinds: [],
      policyBlocks: [],
    });
    expect(JSON.stringify(rows)).not.toContain(sale.original.photo.sha256);
    expect(JSON.stringify(rows)).not.toContain(sale.original.cardCode);
  });
  it("held original exposes candidate separately and zero accepted contribution", async () => {
    const bytes = await h.image(),
      f = await h.context(bytes);
    await changePrice(db.pool, f);
    const sale = await h.settle(f, bytes);
    const row = (
      await db.pool.query(
        "SELECT * FROM audit_event WHERE target_id=$1 AND action='sale_held'",
        [sale.purchaseId],
      )
    ).rows[0];
    expect(row).toBeDefined();
    expect(row.after).toMatchObject({
      revisionId: null,
      credited: false,
      creditedSpendKobo: "0",
      holdKinds: ["price"],
      calculation: "captured_rate",
    });
    expect(row.after.candidateRevisionId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("unmatched cancellation has a system executor and retry creates no second decision", async () => {
    const bytes = await h.image(),
      f = await h.context(bytes);
    const original = { ...f.original, cardCode: "ZZZZZZZ" };
    const sale = await h.sync.submit(f.token, original);
    await h.sync.submit(f.token, original);
    const rows = (
      await db.pool.query(
        "SELECT * FROM audit_event WHERE target_id=$1 ORDER BY occurred_at,id",
        [sale.status.purchaseId],
      )
    ).rows;
    expect(rows.map((r) => r.action)).toEqual([
      "sale_received",
      "sale_cancelled_unmatched",
    ]);
    expect(rows[1].actor_user_id).toBeNull();
    expect(rows[1].actor_snapshot).toMatchObject({
      kind: "system",
      service: "sync",
    });
    expect(rows[1].originating_seller_snapshot.accountId).toBe(f.userId);
    expect(rows[1].before).toEqual({
      state: "received",
      credited: false,
      creditedSpendKobo: "0",
    });
    expect(rows[1].after).toEqual({
      state: "cancelled",
      credited: false,
      creditedSpendKobo: "0",
    });
  });
  it("settlement audit failure rolls back accepted revision and emits no applied event", async () => {
    const bytes = await h.image(),
      f = await h.context(bytes);
    await db.pool.query(
      "CREATE FUNCTION fail_sales_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='sale_credited' THEN RAISE EXCEPTION 'Fictional audit failure'; END IF; RETURN NEW; END $$",
    );
    await db.pool.query(
      "CREATE TRIGGER fail_sales_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION fail_sales_audit()",
    );
    try {
      await expect(h.settle(f, bytes)).rejects.toThrow(
        "Fictional audit failure",
      );
      const p = (
        await db.pool.query(
          "SELECT id,status,current_revision_id FROM purchase WHERE station_id=$1",
          [f.stationId],
        )
      ).rows[0];
      expect(p.status).toBe("photo_pending");
      expect(p.current_revision_id).toBeNull();
      expect(
        (
          await db.pool.query(
            "SELECT id FROM purchase_revision WHERE purchase_id=$1",
            [p.id],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await db.pool.query(
            "SELECT action FROM audit_event WHERE target_id=$1",
            [p.id],
          )
        ).rows,
      ).toEqual([{ action: "sale_received" }]);
    } finally {
      await db.pool.query("DROP TRIGGER fail_sales_audit ON audit_event");
      await db.pool.query("DROP FUNCTION fail_sales_audit()");
    }
  });
  it("three matching settlements produce exactly three typed detector events across worker replay", async () => {
    const bytes = await h.image(),
      f = await h.context(bytes);
    await Promise.all([
      h.settle(f, bytes),
      h.settle(f, bytes),
      h.settle(f, bytes),
    ]);
    while (await runDuplicateBatch(db.pool)) {}
    const rows = (
      await db.pool.query(
        "SELECT * FROM audit_event WHERE action='duplicate_flagged' AND target_id IN (SELECT id FROM purchase WHERE station_id=$1)",
        [f.stationId],
      )
    ).rows;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.actor_snapshot).toMatchObject({
        kind: "system",
        service: "validation",
      });
      expect(row.after.duplicateState).toBe("open");
      expect(row.after.purchaseIds).toEqual([...row.after.purchaseIds].sort());
      expect(row.target_id).toBe(row.after.purchaseIds[0]);
      expect(JSON.stringify(row)).not.toContain(f.original.photo.sha256);
    }
    expect(await runDuplicateBatch(db.pool)).toBe(false);
  });
});

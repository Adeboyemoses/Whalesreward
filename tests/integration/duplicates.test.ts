import { readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { reviewFixtureHarness } from "../helpers/review-fixture";
import { newId } from "../../src/server/lib/ids";
import { sha256, fixtureId } from "../helpers/sync-fixture";
import { runDuplicateBatch } from "../../src/server/modules/duplicates/service";
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const schema = `duplicates_${randomBytes(6).toString("hex")}`;
let pool: pg.Pool, h: ReturnType<typeof reviewFixtureHarness>;
async function drain() {
  for (let n = 0; n < 1000; n++) {
    if (!(await runDuplicateBatch(pool))) return;
  }
  throw new Error("detector did not drain");
}
async function flags(station: string) {
  return (
    await pool.query(
      "SELECT f.* FROM duplicate_flag f JOIN purchase p ON p.id=f.purchase_id WHERE p.station_id=$1",
      [station],
    )
  ).rows;
}
describe("P-24 real-Postgres advisory duplicates", () => {
  beforeAll(async () => {
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.searchParams.set("options", `-c search_path=${schema},public`);
    pool = new pg.Pool({ connectionString: url.toString(), max: 10 });
    const migrations = new URL("../../prisma/migrations/", import.meta.url);
    for (const d of (await readdir(migrations, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name)))
      await pool.query(
        await readFile(new URL(`${d.name}/migration.sql`, migrations), "utf8"),
      );
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    vi.stubEnv("WHR_ENV", "test");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
    vi.stubEnv(
      "DUPLICATE_WINDOW_POLICY",
      JSON.stringify({ version: 1, windowSeconds: 600 }),
    );
    h = reviewFixtureHarness(pool);
  }, 30000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await pool?.end();
    await root.query(`DROP SCHEMA ${schema} CASCADE`);
    await root.end();
  });
  it.each([600, 601, -600, -601])(
    "exact inclusive time boundary %s seconds leaves contribution unchanged",
    async (seconds) => {
      const a = await h.image(),
        b = await h.image("#ff0000"),
        f = await h.context(a);
      vi.stubEnv("DUPLICATE_WINDOW_STATION_ID", f.stationId);
      const first = await h.settle(f, a);
      const second = await h.settle(f, b, {
        appCapturedAt: new Date(
          f.start.getTime() + seconds * 1000,
        ).toISOString(),
        photo: { ...f.original.photo, sha256: sha256(b), bytes: b.length },
      });
      const before = (
        await pool.query(
          "SELECT id,status,current_revision_id FROM purchase WHERE id=ANY($1::uuid[]) ORDER BY id",
          [[first.purchaseId, second.purchaseId]],
        )
      ).rows;
      await drain();
      expect(await flags(f.stationId)).toHaveLength(
        Math.abs(seconds) <= 600 ? 1 : 0,
      );
      expect(
        (
          await pool.query(
            "SELECT id,status,current_revision_id FROM purchase WHERE id=ANY($1::uuid[]) ORDER BY id",
            [[first.purchaseId, second.purchaseId]],
          )
        ).rows,
      ).toEqual(before);
    },
  );
  it.each([
    "null",
    "{}",
    '{"version":1,"windowSeconds":0}',
    '{"version":1,"windowSeconds":"600"}',
    '{"version":1,"windowSeconds":600,"active":false}',
  ])(
    "invalid window %s disables time rule but keeps validated-photo matching",
    async (policy) => {
      vi.stubEnv("DUPLICATE_WINDOW_POLICY", policy);
      const a = await h.image(),
        b = await h.image("#00ff00"),
        f = await h.context(a);
      vi.stubEnv("DUPLICATE_WINDOW_STATION_ID", f.stationId);
      await h.settle(f, a);
      await h.settle(f, b, {
        photo: { ...f.original.photo, sha256: sha256(b), bytes: b.length },
      });
      await drain();
      expect(await flags(f.stationId)).toHaveLength(0);
      await h.settle(f, a, {
        appCapturedAt: new Date(f.start.getTime() - 900000).toISOString(),
      });
      await drain();
      expect(await flags(f.stationId)).toHaveLength(1);
      vi.stubEnv(
        "DUPLICATE_WINDOW_POLICY",
        JSON.stringify({ version: 1, windowSeconds: 600 }),
      );
    },
  );
  it("three concurrent matching settlements create exactly three pairs and retries add no audit or credit", async () => {
    const a = await h.image(),
      f = await h.context(a);
    vi.stubEnv("DUPLICATE_WINDOW_STATION_ID", f.stationId);
    await Promise.all([h.settle(f, a), h.settle(f, a), h.settle(f, a)]);
    await Promise.all([drain(), drain()]);
    expect(await flags(f.stationId)).toHaveLength(3);
    const before = (
      await pool.query(
        "SELECT count(*)::int AS n FROM audit_event WHERE action='duplicate_flagged'",
      )
    ).rows;
    await drain();
    expect(await flags(f.stationId)).toHaveLength(3);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM audit_event WHERE action='duplicate_flagged'",
        )
      ).rows,
    ).toEqual(before);
  });
  it("more than 100 comparisons persist bounded continuation and resume without lost pairs", async () => {
    const a = await h.image(),
      f = await h.context(a);
    vi.stubEnv("DUPLICATE_WINDOW_STATION_ID", f.stationId);
    for (let i = 0; i < 102; i++) await h.settle(f, a);
    await pool.query(
      "CREATE FUNCTION fail_duplicate_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='duplicate_flagged' THEN RAISE EXCEPTION 'simulated worker interruption'; END IF; RETURN NEW; END $$",
    );
    await pool.query(
      "CREATE TRIGGER fail_duplicate_audit BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION fail_duplicate_audit()",
    );
    await expect(runDuplicateBatch(pool)).rejects.toThrow(
      "simulated worker interruption",
    );
    expect(await flags(f.stationId)).toHaveLength(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM duplicate_detection_intent WHERE cursor_id IS NOT NULL AND purchase_id IN (SELECT id FROM purchase WHERE station_id=$1)",
          [f.stationId],
        )
      ).rows[0].n,
    ).toBe(0);
    await pool.query("DROP TRIGGER fail_duplicate_audit ON audit_event");
    await pool.query("DROP FUNCTION fail_duplicate_audit()");
    expect(await runDuplicateBatch(pool)).toBe(true);
    const progress = (
      await pool.query(
        "SELECT cursor_id,done FROM duplicate_detection_intent WHERE purchase_id IN (SELECT id FROM purchase WHERE station_id=$1) ORDER BY created_at,id LIMIT 1",
        [f.stationId],
      )
    ).rows[0];
    expect(progress.cursor_id).not.toBeNull();
    expect(progress.done).toBe(false);
    expect((await flags(f.stationId)).length).toBeLessThanOrEqual(100);
    // A new worker invocation resumes only from durable database state.
    await drain();
    expect(await flags(f.stationId)).toHaveLength((102 * 101) / 2);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM duplicate_detection_intent WHERE NOT done AND purchase_id IN (SELECT id FROM purchase WHERE station_id=$1)",
          [f.stationId],
        )
      ).rows[0].n,
    ).toBe(0);
  }, 60000);
  it("same effective value in a different entered basis is not a time duplicate", async () => {
    const a = await h.image(),
      b = await h.image("#010203"),
      f = await h.context(a);
    vi.stubEnv("DUPLICATE_WINDOW_STATION_ID", f.stationId);
    await h.settle(f, a);
    await h.settle(f, b, {
      entry: {
        basis: "quantity",
        enteredQuantity: "20",
        amountKobo: "2000000",
        quantity: "20",
      },
      photo: { ...f.original.photo, sha256: sha256(b), bytes: b.length },
    });
    await drain();
    expect(await flags(f.stationId)).toHaveLength(0);
  });
  it("equivalent offsets and exact decimal quantity equality match", async () => {
    const a = await h.image(),
      b = await h.image("#030201"),
      f = await h.context(a);
    vi.stubEnv("DUPLICATE_WINDOW_STATION_ID", f.stationId);
    const entry = {
      basis: "quantity" as const,
      enteredQuantity: "20.0",
      amountKobo: "2000000",
      quantity: "20",
    };
    await h.settle(f, a, { entry });
    const offset = new Date(f.start.getTime() + 3600000)
      .toISOString()
      .replace("Z", "+01:00");
    await h.settle(f, b, {
      entry: { ...entry, enteredQuantity: "20.00" },
      appCapturedAt: offset,
      photo: { ...f.original.photo, sha256: sha256(b), bytes: b.length },
    });
    await drain();
    expect(await flags(f.stationId)).toHaveLength(1);
  });
  it("pending photo submission never schedules detection or matches validated bytes", async () => {
    const a = await h.image(),
      f = await h.context(a);
    vi.stubEnv("DUPLICATE_WINDOW_STATION_ID", f.stationId);
    await h.settle(f, a);
    const pending = await h.sync.submit(f.token, f.original);
    await drain();
    expect(await flags(f.stationId)).toHaveLength(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM duplicate_detection_intent WHERE purchase_id=$1",
          [pending.status.purchaseId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("different customers sharing validated bytes match independently of time policy", async () => {
    const a = await h.image(),
      f = await h.context(a),
      card = newId();
    vi.stubEnv("DUPLICATE_WINDOW_POLICY", "null");
    await pool.query(
      "INSERT INTO card(id,batch_id,code,qr_payload,state,version) VALUES($1,$2,'B7K3M9Q','B7K3M9Q','unassigned',1)",
      [card, fixtureId(28)],
    );
    await pool.query(
      "INSERT INTO card_customer_link(id,card_id,customer_id,linked_at,actor_user_id,reason) VALUES($1,$2,$3,'2026-11-04T09:00:00Z',$4,'Fictional registration')",
      [newId(), card, fixtureId(27), fixtureId(2)],
    );
    await pool.query(
      "UPDATE card SET state='linked',version=version+1 WHERE id=$1",
      [card],
    );
    await h.settle(f, a);
    await h.settle(f, a, { cardCode: "B7K3M9Q" });
    await drain();
    expect(await flags(f.stationId)).toHaveLength(1);
    vi.stubEnv(
      "DUPLICATE_WINDOW_POLICY",
      JSON.stringify({ version: 1, windowSeconds: 600 }),
    );
  });
});

import pg from "pg";
import { expect, it } from "vitest";
import {
  evidenceDatabase,
  resetReviewFixture,
} from "../helpers/review-evidence-fixture";

it("P-28 disposable reset locks station before binding guards and completes beside a station-then-policy health read", async () => {
  const fixture = await evidenceDatabase(),
    reader = await fixture.pool.connect();
  const schema = (await reader.query("SELECT current_schema() AS schema"))
    .rows[0].schema;
  const name = `p28_reset_${schema}`,
    url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  url.searchParams.set("application_name", name);
  const resetPool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  let reset: Promise<{ ok: true } | { ok: false; error: unknown }> | undefined;
  try {
    await reader.query("BEGIN");
    await reader.query("SET LOCAL statement_timeout='5000ms'");
    await reader.query("SELECT id FROM station");
    reset = resetReviewFixture(resetPool).then(
      () => ({ ok: true as const }),
      (error) => ({ ok: false as const, error }),
    );
    let waiting = false;
    for (let attempts = 0; attempts < 100; attempts++) {
      waiting = (
        await fixture.pool.query(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock') AS waiting",
          [name],
        )
      ).rows[0].waiting;
      if (waiting) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    const waiter = (
      await fixture.pool.query(
        "SELECT query FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
        [name],
      )
    ).rows[0];
    expect(waiter.query).toContain(
      "LOCK TABLE station IN ACCESS EXCLUSIVE MODE",
    );
    // The station-first wait must leave the policy read free to complete
    // before reset suspends any binding guards or requests cascade locks.
    await reader.query("SELECT policy_version FROM station_timing_policy");
    await reader.query("COMMIT");
    expect(await reset).toEqual({ ok: true });
    expect(
      (await fixture.pool.query("SELECT count(*)::int AS n FROM station"))
        .rows[0].n,
    ).toBe(0);
    const guards = (
      await fixture.pool.query(
        "SELECT tgenabled FROM pg_trigger WHERE tgrelid='station_timing_policy'::regclass AND tgname IN ('station_timing_policy_immutable','station_timing_policy_no_truncate')",
      )
    ).rows;
    expect(guards).toHaveLength(2);
    expect(guards.every((row) => row.tgenabled === "O")).toBe(true);
  } finally {
    await reader.query("ROLLBACK");
    reader.release();
    await reset;
    await resetPool.end();
    await fixture.close();
  }
}, 30000);

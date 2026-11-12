import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

import {
  operate,
  parseArguments,
  releaseDigest,
  formatResult,
  checkDatabaseEnvironment,
} from "../../scripts/ops/review-evidence.mjs";
import { randomUUID } from "node:crypto";

const databaseName = `operator_${randomUUID().replaceAll("-", "")}`;
const databaseIdentifier = pg.escapeIdentifier(databaseName);
let root: pg.Pool;
let databaseUrl: string;
let db: { pool: pg.Pool };
beforeAll(async () => {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL required for integration tests");
  root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await root.query(`CREATE DATABASE ${databaseIdentifier}`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${databaseName}`;
  databaseUrl = url.toString();
  db = { pool: new pg.Pool({ connectionString: databaseUrl, max: 10 }) };
  const migrations = new URL("../../prisma/migrations/", import.meta.url);
  for (const directory of (await readdir(migrations, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    await db.pool.query(
      await readFile(
        new URL(`${directory.name}/migration.sql`, migrations),
        "utf8",
      ),
    );
  }
}, 30000);
beforeEach(async () => {
  await root.query(`ALTER DATABASE ${databaseIdentifier} RESET ALL`);
  await root.query(
    `ALTER DATABASE ${databaseIdentifier} SET whr.environment = 'test'`,
  );
});
afterAll(async () => {
  await db?.pool.end();
  if (root) {
    // Wait until PostgreSQL observes pool socket closure; never terminate sessions.
    for (let attempt = 0; attempt < 100; attempt++) {
      const live = await root.query(
        "SELECT count(*)::int AS count FROM pg_catalog.pg_stat_activity WHERE datname=$1",
        [databaseName],
      );
      if (live.rows[0].count === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await root.query(`DROP DATABASE IF EXISTS ${databaseIdentifier}`);
    await root.end();
  }
});
async function input(action = "activate", apply = false) {
  const station = randomUUID();
  await db.pool.query(
    "INSERT INTO station(id,code,name,timezone,version) VALUES($1,$2,'Operator fixture','Africa/Lagos',1)",
    [station, station],
  );
  return parseArguments([
    action,
    "--station",
    station,
    "--environment",
    "test",
    "--digest",
    releaseDigest,
    "--authorization",
    "WHR-114",
    ...(action === "activate"
      ? ["--activated-at", "2026-11-11T12:00:00Z"]
      : []),
    ...(apply ? ["--apply", "--expected-revision", "1"] : []),
  ]);
}
async function counts(station: string) {
  return Promise.all(
    ["review_evidence_approval", "review_evidence_configuration"].map(
      async (table) =>
        Number(
          (
            await db.pool.query(
              `SELECT count(*) FROM ${table} WHERE station_id=$1`,
              [station],
            )
          ).rows[0].count,
        ),
    ),
  );
}
it("dry run previews exact immutable rows and policy without writes", async () => {
  const request = await input();
  const result = await operate(db.pool, request);
  expect(result.policy.revision).toBe(1);
  expect(result.configuration.configuration).toEqual(result.policy);
  expect(result.approval?.id).toBe(result.policy.activation.approvalReference);
  expect(formatResult(result)).toContain(
    `WHR_REVIEW_EVIDENCE_POLICY=${JSON.stringify(result.policy)}`,
  );
  expect(await counts(request.stationId)).toEqual([0, 0]);
});
it("applies activation atomically and appends higher inactive and reactivation revisions", async () => {
  const request = await input("activate", true);
  const active = await operate(db.pool, request);
  const inactive = await operate(db.pool, {
    ...request,
    action: "deactivate",
    activatedAt: null,
    expectedRevision: 2,
  });
  const reactivated = await operate(db.pool, {
    ...request,
    expectedRevision: 3,
  });
  expect([
    active.policy.revision,
    inactive.policy.revision,
    reactivated.policy.revision,
  ]).toEqual([1, 2, 3]);
  expect(inactive.policy.activation).toEqual({
    state: "inactive",
    approvalReference: null,
    activatedAt: null,
  });
  expect(await counts(request.stationId)).toEqual([2, 3]);
  const stored = await db.pool.query(
    "SELECT configuration FROM review_evidence_configuration WHERE id=$1",
    [active.configuration.id],
  );
  expect(stored.rows[0].configuration).toEqual(active.policy);
  await expect(
    db.pool.query(
      "UPDATE review_evidence_configuration SET authorization_reference='changed' WHERE id=$1",
      [active.configuration.id],
    ),
  ).rejects.toThrow();
  await expect(
    db.pool.query("DELETE FROM review_evidence_approval WHERE id=$1", [
      active.approval!.id,
    ]),
  ).rejects.toThrow();
});
it("serializes concurrent activation and deactivation and refuses the stale authorized revision", async () => {
  const request = await input("activate", true);
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      operate(
        db.pool,
        i % 2
          ? { ...request, action: "deactivate", activatedAt: null }
          : request,
      ),
    ),
  );
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((x) => x.status === "rejected")).toHaveLength(7);
  const count = await counts(request.stationId);
  expect(count[1]).toBe(1);
  expect(count[0]).toBeLessThanOrEqual(1);
});
it("rolls approval back when the configuration insert fails", async () => {
  const request = await input("activate", true);
  await db.pool.query(
    "CREATE FUNCTION reject_operator_config() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rejection'; END $$",
  );
  await db.pool.query(
    "CREATE TRIGGER reject_operator_config BEFORE INSERT ON review_evidence_configuration FOR EACH ROW EXECUTE FUNCTION reject_operator_config()",
  );
  try {
    await expect(operate(db.pool, request)).rejects.toThrow();
    expect(await counts(request.stationId)).toEqual([0, 0]);
  } finally {
    await db.pool.query(
      "DROP TRIGGER reject_operator_config ON review_evidence_configuration",
    );
  }
});
it("includes orphan approval revisions and refuses safe-integer exhaustion", async () => {
  const request = await input("activate", true);
  await db.pool.query(
    "INSERT INTO review_evidence_approval(id,release,digest,revision,station_id,environment,activated_at,authorization_reference) VALUES($1,'review-evidence-v1',$2,12,$3,'test',$4,'fixture')",
    [randomUUID(), releaseDigest, request.stationId, request.activatedAt],
  );
  expect(
    (await operate(db.pool, { ...request, expectedRevision: 13 })).policy
      .revision,
  ).toBe(13);
  await db.pool.query(
    "INSERT INTO review_evidence_approval(id,release,digest,revision,station_id,environment,activated_at,authorization_reference) VALUES($1,'review-evidence-v1',$2,9007199254740991,$3,'test',$4,'fixture')",
    [randomUUID(), releaseDigest, request.stationId, request.activatedAt],
  );
  await expect(operate(db.pool, request)).rejects.toThrow("exhausted");
  expect(await counts(request.stationId)).toEqual([3, 1]);
});
it("refuses digest and environment mismatches with no rows", async () => {
  const request = await input("activate", true);
  await expect(
    operate(db.pool, { ...request, digest: "a".repeat(64) }),
  ).rejects.toThrow();
  await expect(
    operate(db.pool, { ...request, environment: "production" }),
  ).rejects.toThrow();
  expect(await counts(request.stationId)).toEqual([0, 0]);
});
it("does not reserve preview revisions or IDs", async () => {
  const request = await input();
  const preview = await operate(db.pool, request);
  await operate(db.pool, { ...request, apply: true, expectedRevision: 1 });
  await expect(
    operate(db.pool, { ...request, apply: true, expectedRevision: 1 }),
  ).rejects.toThrow("Revision changed");
  const applied = await operate(db.pool, {
    ...request,
    apply: true,
    expectedRevision: 2,
  });
  expect(preview.policy.revision).toBe(1);
  expect(applied.policy.revision).toBe(2);
  expect(applied.configuration.id).not.toBe(preview.configuration.id);
});

it("refuses absent, malformed and duplicated persisted environment identities", async () => {
  const request = await input("activate", true);
  await root.query(
    `ALTER DATABASE ${databaseIdentifier} RESET whr.environment`,
  );
  await expect(operate(db.pool, request)).rejects.toThrow("environment");
  for (const value of ["", "TEST", "invalid", "test=production"]) {
    await root.query(
      `ALTER DATABASE ${databaseIdentifier} SET whr.environment = ${pg.escapeLiteral(value)}`,
    );
    await expect(operate(db.pool, request)).rejects.toThrow("environment");
  }
  await root.query(
    "UPDATE pg_catalog.pg_db_role_setting SET setconfig=$1::text[] WHERE setdatabase=(SELECT oid FROM pg_catalog.pg_database WHERE datname=$2) AND setrole=0",
    [["whr.environment=test", "whr.environment=production"], databaseName],
  );
  await expect(operate(db.pool, request)).rejects.toThrow("environment");
  expect(await counts(request.stationId)).toEqual([0, 0]);
});
it("ignores session SET and connection options when checking database identity", async () => {
  const client = await db.pool.connect();
  try {
    await client.query("SET whr.environment = 'production'");
    await expect(
      checkDatabaseEnvironment(client, "test"),
    ).resolves.toBeUndefined();
    await expect(
      checkDatabaseEnvironment(client, "production"),
    ).rejects.toThrow("environment");
  } finally {
    client.release();
  }
  const url = new URL(databaseUrl);
  url.searchParams.set("options", "-c whr.environment=production");
  const spoof = new pg.Client({ connectionString: url.toString() });
  await spoof.connect();
  try {
    expect(
      (await spoof.query("SELECT current_setting('whr.environment') AS value"))
        .rows[0].value,
    ).toBe("production");
    await expect(
      checkDatabaseEnvironment(spoof, "test"),
    ).resolves.toBeUndefined();
    await expect(checkDatabaseEnvironment(spoof, "production")).rejects.toThrow(
      "environment",
    );
    await root.query(
      `ALTER DATABASE ${databaseIdentifier} RESET whr.environment`,
    );
    await expect(checkDatabaseEnvironment(spoof, "production")).rejects.toThrow(
      "environment",
    );
  } finally {
    await spoof.end();
  }
});
it("ignores role-in-database override and refuses role-only identity", async () => {
  const role = (await root.query("SELECT current_user AS name")).rows[0]
    .name as string;
  const roleIdentifier = pg.escapeIdentifier(role);
  await root.query(
    `ALTER ROLE ${roleIdentifier} IN DATABASE ${databaseIdentifier} SET whr.environment = 'production'`,
  );
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    expect(
      (await client.query("SELECT current_setting('whr.environment') AS value"))
        .rows[0].value,
    ).toBe("production");
    await expect(
      checkDatabaseEnvironment(client, "test"),
    ).resolves.toBeUndefined();
    await expect(
      checkDatabaseEnvironment(client, "production"),
    ).rejects.toThrow("environment");
    await root.query(
      `ALTER DATABASE ${databaseIdentifier} RESET whr.environment`,
    );
    await expect(
      checkDatabaseEnvironment(client, "production"),
    ).rejects.toThrow("environment");
  } finally {
    await client.end();
    await root.query(
      `ALTER ROLE ${roleIdentifier} IN DATABASE ${databaseIdentifier} RESET ALL`,
    );
  }
});
it("runs real CLI dry run and guarded production apply against persisted identity", async () => {
  const request = await input();
  await root.query(
    `ALTER DATABASE ${databaseIdentifier} SET whr.environment = 'production'`,
  );
  const args = [
    "activate",
    "--station",
    request.stationId,
    "--environment",
    "production",
    "--digest",
    releaseDigest,
    "--authorization",
    "APPROVAL-114",
    "--activated-at",
    "2026-11-11T12:00:00.123456Z",
  ];
  const run = (argv: string[]) =>
    spawnSync(process.execPath, ["scripts/ops/review-evidence.mjs", ...argv], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        WHR_ENV: "test",
        DATABASE_URL: databaseUrl,
      },
    });
  const missing = run(
    args.filter((x) => x !== "--environment" && x !== "production"),
  );
  expect(missing.status).toBe(1);
  const wrong = run(args.map((x) => (x === "production" ? "test" : x)));
  expect(wrong.status).toBe(1);
  const preview = run(args);
  expect(preview.status).toBe(0);
  expect(await counts(request.stationId)).toEqual([0, 0]);
  const applied = run([...args, "--apply", "--expected-revision", "1"]);
  expect(applied.status).toBe(0);
  expect(applied.stderr).toBe("");
  const line = applied.stdout
    .split("\n")
    .find((x) => x.startsWith("WHR_REVIEW_EVIDENCE_POLICY="))!;
  const policy = JSON.parse(line.slice("WHR_REVIEW_EVIDENCE_POLICY=".length));
  expect(policy.scope.environment).toBe("production");
  expect(policy.activation.activatedAt).toBe("2026-11-11T12:00:00.123456Z");
  const stored = await db.pool.query(
    "SELECT configuration FROM review_evidence_configuration WHERE station_id=$1",
    [request.stationId],
  );
  expect(stored.rows[0].configuration).toEqual(policy);
  expect(await counts(request.stationId)).toEqual([1, 1]);
  const stale = run([...args, "--apply", "--expected-revision", "1"]);
  expect(stale.status).toBe(1);
  expect(stale.stdout).toBe("");
  expect(await counts(request.stationId)).toEqual([1, 1]);
  const deactivation = run([
    "deactivate",
    ...args
      .slice(1)
      .filter(
        (x) => x !== "--activated-at" && x !== "2026-11-11T12:00:00.123456Z",
      ),
    "--apply",
    "--expected-revision",
    "2",
  ]);
  expect(deactivation.status).toBe(0);
  const latest = await db.pool.query(
    "SELECT configuration FROM review_evidence_configuration WHERE station_id=$1 ORDER BY revision DESC LIMIT 1",
    [request.stationId],
  );
  expect(latest.rows[0].configuration.activation).toEqual({
    state: "inactive",
    approvalReference: null,
    activatedAt: null,
  });
  expect(await counts(request.stationId)).toEqual([1, 2]);
});

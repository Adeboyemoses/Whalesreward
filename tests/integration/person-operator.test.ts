import { afterAll, beforeAll, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { v7 } from "uuid";
import { operate, parseArguments } from "../../scripts/ops/person.mjs";

const databaseName = `person_operator_${v7().replaceAll("-", "")}`;
const ownerName = `person_owner_${v7().replaceAll("-", "")}`;
const databaseIdentifier = pg.escapeIdentifier(databaseName);
const ownerIdentifier = pg.escapeIdentifier(ownerName);
const stationId = "019a5000-0000-7000-8000-000000000008";
const scope = ["--station", stationId, "--environment", "test"];
let root: pg.Pool;
let pool: pg.Pool;
let databaseUrl: string;
beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await root.query(
    `CREATE ROLE ${ownerIdentifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'person-fixture'`,
  );
  await root.query(
    `CREATE DATABASE ${databaseIdentifier} OWNER ${ownerIdentifier}`,
  );
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${databaseName}`;
  url.username = ownerName;
  url.password = "person-fixture";
  databaseUrl = url.toString();
  pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
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
  await pool.query(
    "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional operator campaign',1,true)",
    [v7(), stationId],
  );
  await comment("whr.environment=test");
}, 30000);
afterAll(async () => {
  await pool?.end();
  if (root) {
    for (let n = 0; n < 100; n++) {
      if (
        (
          await root.query(
            "SELECT count(*)::int count FROM pg_stat_activity WHERE datname=$1",
            [databaseName],
          )
        ).rows[0].count === 0
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await root.query(`DROP DATABASE IF EXISTS ${databaseIdentifier}`);
    await root.query(`DROP ROLE IF EXISTS ${ownerIdentifier}`);
    await root.end();
  }
});
async function comment(value: string | null) {
  await pool.query(
    `COMMENT ON DATABASE ${databaseIdentifier} IS ${value === null ? "NULL" : pg.escapeLiteral(value)}`,
  );
}
function input(action: string, flags: string[] = []) {
  return parseArguments([action, ...scope, ...flags]);
}
function writeArgs(action: string, flags: string[] = []) {
  const reason =
    action === "verify"
      ? "verification_completed"
      : action === "rebind"
        ? "identity_correction"
        : ["unbind", "disable"].includes(action)
          ? "offboarding"
          : "initial_provisioning";
  return [...flags, "--authorization", "FIXTURE-AUTH", "--reason-code", reason];
}
async function mutate(action: string, flags: string[] = []) {
  const args = writeArgs(action, flags);
  const preview = await operate(pool, input(action, args));
  return operate(
    pool,
    input(action, [
      ...args,
      "--apply",
      "--expected-revision",
      String(preview.revision),
    ]),
  );
}
async function person() {
  const id = v7();
  await mutate("create", ["--person", id]);
  return id;
}
async function account() {
  const id = v7();
  await pool.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'attendant',$2,$2,'Fictional operator account',true,1,false,clock_timestamp())",
    [id, `fixture-${id}`],
  );
  await pool.query(
    "INSERT INTO attendant(id,user_id,staff_code,version) VALUES($1,$2,$3,1)",
    [v7(), id, `FIXTURE-${id}`],
  );
  return id;
}
async function bound(verified = false) {
  const p = await person(),
    u = await account();
  await mutate("bind", [
    "--person",
    p,
    "--user",
    u,
    "--expected-binding-version",
    "0",
  ]);
  if (verified)
    await mutate("verify", [
      "--person",
      p,
      "--user",
      u,
      "--expected-binding-version",
      "1",
      "--verification-reference",
      "FIXTURE-VERIFY",
    ]);
  return { p, u, version: verified ? 2 : 1 };
}
async function totals() {
  return (
    await pool.query(
      "SELECT (SELECT count(*) FROM person_provisioning_event)::int events,(SELECT count(*) FROM audit_event)::int audit,(SELECT data_version::text FROM station_reporting_state WHERE station_id=$1) generation,(SELECT count(*) FROM held_release_person_binding)::int bindings",
      [stationId],
    )
  ).rows[0];
}
it("WHR-227 real PostgreSQL operator runs as a non-superuser", async () => {
  expect(
    (
      await pool.query(
        "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0].rolsuper,
  ).toBe(false);
});
it("WHR-227 default preview and inventory are read-only and person creation reserves no identity", async () => {
  const id = v7();
  const before = await totals();
  const preview = await operate(
    pool,
    input("create", writeArgs("create", ["--person", id])),
  );
  expect(preview).toMatchObject({
    result: "preview",
    personId: id,
    invalidationCount: 0,
  });
  expect(preview.applyCommand).toContain("--apply --expected-revision");
  await operate(pool, input("list"));
  expect(await totals()).toEqual(before);
  expect(
    (await pool.query("SELECT 1 FROM held_release_person WHERE id=$1", [id]))
      .rowCount,
  ).toBe(0);
});
it.each([
  null,
  "whr.environment=staging",
  "whr.environment=test extra",
  "test",
])(
  "WHR-227 list preview and apply reject database-comment mismatch despite spoofed settings (%s)",
  async (value) => {
    const before = await totals();
    await comment(value);
    const db = await pool.connect();
    await db.query("SET whr.environment='test'");
    db.release();
    try {
      for (const action of [
        input("list"),
        input("create", writeArgs("create", ["--person", v7()])),
        input("create", [
          ...writeArgs("create", ["--person", v7()]),
          "--apply",
          "--expected-revision",
          "1",
        ]),
      ])
        await expect(operate(pool, action)).rejects.toThrow(
          "database_identity_mismatch",
        );
      expect(await totals()).toEqual(before);
    } finally {
      await comment("whr.environment=test");
    }
  },
);
it("WHR-227 bind is unverified; verify appends an exact accountable version; no-change writes nothing", async () => {
  const { p, u } = await bound();
  expect(
    (
      await pool.query(
        "SELECT version,verified FROM held_release_person_binding WHERE user_id=$1 ORDER BY version DESC",
        [u],
      )
    ).rows,
  ).toEqual([{ version: 1, verified: false }]);
  const verified = await mutate("verify", [
    "--person",
    p,
    "--user",
    u,
    "--expected-binding-version",
    "1",
    "--verification-reference",
    "._FIXTURE",
  ]);
  expect(verified.result).toBe("applied");
  const before = await totals();
  expect(
    (
      await mutate("verify", [
        "--person",
        p,
        "--user",
        u,
        "--expected-binding-version",
        "2",
        "--verification-reference",
        "FRESH-FIXTURE",
      ])
    ).result,
  ).toBe("no_change");
  expect(await totals()).toEqual(before);
  const list = await operate(pool, input("list", ["--user", u, "--history"]));
  expect(list.rows.map((r: { version: number }) => r.version)).toEqual([1, 2]);
  expect(JSON.stringify(list)).not.toContain("FIXTURE-VERIFY");
  const recorded = await operate(
    pool,
    input("list", ["--revision", String(verified.revision)]),
  );
  expect(recorded.event.verification_reference).toBe("._FIXTURE");
  expect(recorded.bindings[0]).toMatchObject({
    old_version: 1,
    old_verified: false,
    version: 2,
    verified: true,
  });
  const audit = (
    await pool.query(
      "SELECT actor_snapshot,after,changes FROM audit_event WHERE target_id=$1",
      [verified.eventId],
    )
  ).rows[0];
  expect(audit.actor_snapshot.service).toBe("person-provisioning");
  expect(JSON.stringify(audit)).not.toContain("._FIXTURE");
});
it("WHR-227 exact revision reconciliation finds no event when an apply was never recorded", async () => {
  expect(
    await operate(pool, input("list", ["--revision", "9007199254740991"])),
  ).toEqual({ result: "not_recorded", revision: 9007199254740991 });
});
it("WHR-227 stale revision and binding guards never append duplicate history", async () => {
  const { p, u } = await bound();
  const flags = writeArgs("verify", [
    "--person",
    p,
    "--user",
    u,
    "--expected-binding-version",
    "1",
    "--verification-reference",
    "FIXTURE",
  ]);
  const preview = await operate(pool, input("verify", flags));
  await person();
  const before = await totals();
  await expect(
    operate(
      pool,
      input("verify", [
        ...flags,
        "--apply",
        "--expected-revision",
        String(preview.revision),
      ]),
    ),
  ).rejects.toThrow("revision_conflict");
  await expect(
    mutate("verify", [
      "--person",
      p,
      "--user",
      u,
      "--expected-binding-version",
      "2",
      "--verification-reference",
      "FIXTURE",
    ]),
  ).rejects.toThrow("binding_version_conflict");
  expect(await totals()).toEqual(before);
});
it("WHR-227 concurrent first binds serialize and consume exactly one reviewed revision", async () => {
  const p = await person(),
    u = await account();
  const flags = writeArgs("bind", [
    "--person",
    p,
    "--user",
    u,
    "--expected-binding-version",
    "0",
  ]);
  const preview = await operate(pool, input("bind", flags));
  const before = await totals();
  const request = input("bind", [
    ...flags,
    "--apply",
    "--expected-revision",
    String(preview.revision),
  ]);
  const results = await Promise.allSettled([
    operate(pool, request),
    operate(pool, request),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const after = await totals();
  expect(after.events - before.events).toBe(1);
  expect(after.bindings - before.bindings).toBe(1);
  expect(after.audit - before.audit).toBe(1);
});
it("WHR-227 concurrent verify and rebind cannot silently rebase a reviewed binding", async () => {
  const { p, u } = await bound();
  const dest = await person();
  const verifyFlags = writeArgs("verify", [
    "--person",
    p,
    "--user",
    u,
    "--expected-binding-version",
    "1",
    "--verification-reference",
    "FIXTURE",
  ]);
  const rebindFlags = writeArgs("rebind", [
    "--person",
    dest,
    "--user",
    u,
    "--expected-binding-version",
    "1",
  ]);
  const preview = await operate(pool, input("verify", verifyFlags));
  const before = await totals();
  const results = await Promise.allSettled([
    operate(
      pool,
      input("verify", [
        ...verifyFlags,
        "--apply",
        "--expected-revision",
        String(preview.revision),
      ]),
    ),
    operate(
      pool,
      input("rebind", [
        ...rebindFlags,
        "--apply",
        "--expected-revision",
        String(preview.revision),
      ]),
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await totals()).bindings - before.bindings).toBe(1);
});
it("WHR-227 disable revokes every verified alias atomically including disabled accounts and increments generation once", async () => {
  const { p, u } = await bound(true),
    alias = await account();
  await mutate("bind", [
    "--person",
    p,
    "--user",
    alias,
    "--expected-binding-version",
    "0",
  ]);
  await mutate("verify", [
    "--person",
    p,
    "--user",
    alias,
    "--expected-binding-version",
    "1",
    "--verification-reference",
    "ALIAS-FIXTURE",
  ]);
  await pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [alias]);
  const before = await totals();
  const result = await mutate("disable", ["--person", p]);
  expect(result.bindings).toHaveLength(2);
  expect(result.bindings.every((b: { verified: boolean }) => !b.verified)).toBe(
    true,
  );
  const after = await totals();
  expect(after.events - before.events).toBe(1);
  expect(after.audit - before.audit).toBe(1);
  expect(BigInt(after.generation) - BigInt(before.generation)).toBe(1n);
  expect(
    (
      await pool.query(
        "SELECT count(*)::int count FROM held_release_person_binding WHERE user_id=ANY($1::uuid[]) AND version=3 AND NOT verified",
        [[u, alias]],
      )
    ).rows[0].count,
  ).toBe(2);
  const same = await totals();
  expect((await mutate("disable", ["--person", p])).result).toBe("no_change");
  expect(await totals()).toEqual(same);
});
it("WHR-227 inventory keysets are bounded revision/scope/filter/account-state bound and include people without accounts", async () => {
  const p = await person();
  const first = await operate(pool, input("list", ["--limit", "1"]));
  expect(first.rows).toHaveLength(1);
  expect(first.nextCursor).toBeTruthy();
  const second = await operate(
    pool,
    input("list", ["--limit", "1", "--cursor", first.nextCursor]),
  );
  expect(second.rows[0]).not.toEqual(first.rows[0]);
  await expect(
    operate(pool, input("list", ["--person", p, "--cursor", first.nextCursor])),
  ).rejects.toThrow("cursor_stale");
  await account();
  await expect(
    operate(pool, input("list", ["--cursor", first.nextCursor])),
  ).rejects.toThrow("cursor_stale");
  expect(
    (await operate(pool, input("list", ["--person", p]))).rows[0],
  ).toMatchObject({ personId: p, userId: null });
});
it("WHR-227 immutable ledger/binding/campaign marker rows reject non-superuser UPDATE DELETE and TRUNCATE", async () => {
  const { u } = await bound();
  for (const table of [
    "person_provisioning_event",
    "person_provisioning_binding",
    "person_provisioning_campaign",
    "person_identity_invalidation",
    "held_release_person_binding",
  ]) {
    for (const sql of [
      `UPDATE ${table} SET ${table === "person_provisioning_event" ? "reason_code=reason_code" : table === "held_release_person_binding" ? "verified=verified" : table === "person_identity_invalidation" ? "old_version=old_version" : "event_id=event_id"}`,
      `DELETE FROM ${table}`,
      `TRUNCATE ${table} CASCADE`,
    ]) {
      await expect(pool.query(sql)).rejects.toThrow();
    }
  }
  expect(
    (
      await pool.query(
        "SELECT count(*)::int count FROM held_release_person_binding WHERE user_id=$1",
        [u],
      )
    ).rows[0].count,
  ).toBe(1);
});
it("WHR-227 audit failure rolls back binding event and generation together", async () => {
  const { p, u } = await bound();
  const before = await totals();
  const client = await pool.connect();
  const injected = {
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        if (sql.startsWith("INSERT INTO audit_event"))
          throw new Error("fixture audit failure");
        return client.query(sql, values);
      },
      release: () => client.release(),
    }),
  };
  const flags = writeArgs("verify", [
    "--person",
    p,
    "--user",
    u,
    "--expected-binding-version",
    "1",
    "--verification-reference",
    "FIXTURE",
  ]);
  const preview = await operate(pool, input("verify", flags));
  await expect(
    operate(
      injected,
      input("verify", [
        ...flags,
        "--apply",
        "--expected-revision",
        String(preview.revision),
      ]),
    ),
  ).rejects.toThrow("operation_failed");
  expect(await totals()).toEqual(before);
});
it("WHR-227 uncertain commit returns commit_unknown and exact revision reconciles without duplicate revision", async () => {
  const p = v7();
  const flags = writeArgs("create", ["--person", p]);
  const preview = await operate(pool, input("create", flags));
  const client = await pool.connect();
  const injected = {
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        const result = await client.query(sql, values);
        if (sql === "COMMIT") throw new Error("fixture acknowledgement lost");
        return result;
      },
      release: () => client.release(),
    }),
  };
  const request = input("create", [
    ...flags,
    "--apply",
    "--expected-revision",
    String(preview.revision),
  ]);
  await expect(operate(injected, request)).rejects.toThrow("commit_unknown");
  expect(
    (
      await operate(
        pool,
        input("list", ["--revision", String(preview.revision)]),
      )
    ).event.person_id,
  ).toBe(p);
  const before = await totals();
  await expect(operate(pool, request)).rejects.toThrow("revision_conflict");
  expect(await totals()).toEqual(before);
});
it("WHR-227 malformed arguments and connection errors never echo values or load dotenv", () => {
  const run = spawnSync(
    process.execPath,
    ["scripts/ops/person.mjs", "create", "--database-url", "fixture-private"],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        DATABASE_URL: "fixture-private",
      },
      encoding: "utf8",
      timeout: 10000,
    },
  );
  expect(run.status).toBe(1);
  expect(run.stderr.trim()).toBe("invalid_arguments");
  expect(run.stdout + run.stderr).not.toContain("fixture-private");
});

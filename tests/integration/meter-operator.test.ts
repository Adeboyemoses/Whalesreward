import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import pg from "pg";
import { readFile, readdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  operate,
  parseArguments,
  releaseDigest,
  formatResult,
  validateBundle,
} from "../../scripts/ops/meter.mjs";
import {
  operate as configureResolver,
  releaseDigest as resolverDigest,
} from "../../scripts/ops/review-evidence.mjs";
import {
  profileContent,
  profileDigest,
  type MeterProfile,
} from "../../src/server/modules/reviews/meter-policy";

const name = `meter_operator_${randomUUID().replaceAll("-", "")}`;
const identifier = pg.escapeIdentifier(name);
const ownerName = `meter_owner_${randomUUID().replaceAll("-", "")}`;
const ownerIdentifier = pg.escapeIdentifier(ownerName);
let root: pg.Pool, pool: pg.Pool, databaseUrl: string, directory: string;
beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await root.query(
    `CREATE ROLE ${ownerIdentifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'meter-operator-fixture'`,
  );
  await root.query(`CREATE DATABASE ${identifier} OWNER ${ownerIdentifier}`);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
  url.username = ownerName;
  url.password = "meter-operator-fixture";
  databaseUrl = url.toString();
  pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const migrations = new URL("../../prisma/migrations/", import.meta.url);
  for (const d of (await readdir(migrations, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name)))
    await pool.query(
      await readFile(new URL(`${d.name}/migration.sql`, migrations), "utf8"),
    );
  directory = await mkdtemp(join(tmpdir(), "meter-operator-"));
}, 30000);
beforeEach(async () => {
  await pool.query(
    `COMMENT ON DATABASE ${identifier} IS 'whr.environment=test'`,
  );
});
afterAll(async () => {
  await pool?.end();
  if (root) {
    for (let i = 0; i < 100; i++) {
      if (
        (
          await root.query(
            "SELECT count(*)::int n FROM pg_stat_activity WHERE datname=$1",
            [name],
          )
        ).rows[0].n === 0
      )
        break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await root.query(`DROP DATABASE IF EXISTS ${identifier}`);
    await root.query(`DROP ROLE IF EXISTS ${ownerIdentifier}`);
    await root.end();
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const station = randomUUID(),
    product = "019a5000-0000-7000-8000-000000000001",
    pump = randomUUID();
  await pool.query(
    "INSERT INTO station(id,code,name,timezone,version) VALUES($1::uuid,$1::text,'Operator fixture','Africa/Lagos',1)",
    [station],
  );
  await pool.query(
    "INSERT INTO product(id,code,unit) VALUES($1,'pms','litre') ON CONFLICT (id) DO NOTHING",
    [product],
  );
  await pool.query(
    "INSERT INTO pump(id,station_id,code,name,product_id,enabled,version) VALUES($1::uuid,$2,$1::text,'Test meter',$3,true,1)",
    [pump, station, product],
  );
  await configureResolver(pool, {
    action: "activate",
    stationId: station,
    environment: "test",
    digest: resolverDigest,
    authorizationReference: "TEST-P25",
    activatedAt: "2026-11-01T00:00:00Z",
    apply: true,
    expectedRevision: 1,
  });
  const profile: MeterProfile = {
    id: randomUUID(),
    version: 1,
    digest: "0".repeat(64),
    stationId: station,
    pumpId: pump,
    productId: product,
    currency: "NGN",
    unit: "litre",
    quantityPrecision: 3,
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: null,
    amountStepKobo: "1",
    quantityStep: "0.001",
    displayModel: "common_sale_nearest_steps",
    verificationReference: randomUUID(),
    approvalReference: randomUUID(),
  };
  profile.digest = profileDigest(profile);
  const content = profileContent(profile);
  const bundle = {
    profiles: [profile],
    verifications: [
      {
        id: profile.verificationReference,
        stationId: station,
        content: {
          profileContent: content,
          measuredMeterIdentity: "Fictional laboratory meter",
          measurementReference: randomUUID(),
          verificationNotes: "Test-only nearest-common-sale measurements.",
        },
        authorizationReference: "TEST-MEASUREMENT",
      },
    ],
    approvals: [
      {
        id: profile.approvalReference,
        stationId: station,
        profileId: profile.id,
        profileVersion: 1,
        digest: profile.digest,
        profileContent: content,
        authorizationReference: "TEST-PROFILE-APPROVAL",
      },
    ],
  };
  const path = join(directory, `${station}.json`);
  await writeFile(path, JSON.stringify(bundle));
  const input = parseArguments([
    "activate",
    "--station",
    station,
    "--environment",
    "test",
    "--digest",
    releaseDigest,
    "--authorization",
    "TEST-POLICY-APPROVAL",
    "--activated-at",
    "2026-11-01T00:00:00Z",
    "--bundle",
    path,
  ]);
  return { input, bundle };
}
async function counts(station: string) {
  return Promise.all(
    [
      "meter_verification",
      "meter_profile_approval",
      "meter_policy_approval",
      "meter_configuration",
    ].map(
      async (table) =>
        (
          await pool.query(
            `SELECT count(*)::int n FROM ${table} WHERE station_id=$1`,
            [station],
          )
        ).rows[0].n,
    ),
  );
}
it("runs meter operations as a non-superuser database owner", async () => {
  const identity = await pool.query(
    `SELECT role.rolsuper, database.datdba = role.oid AS owns_database
     FROM pg_catalog.pg_roles AS role
     JOIN pg_catalog.pg_database AS database ON database.datname = pg_catalog.current_database()
     WHERE role.rolname = CURRENT_USER`,
  );
  expect(identity.rows).toEqual([{ rolsuper: false, owns_database: true }]);
  const { input } = await fixture();
  await expect(operate(pool, input)).resolves.toMatchObject({ applied: false });
});
it("previews exact approved rows in a read-only transaction without writes", async () => {
  const { input, bundle } = await fixture();
  const result = await operate(pool, input);
  expect(await counts(input.stationId)).toEqual([0, 0, 0, 0]);
  expect(result.verifications[0]?.content).toEqual(
    bundle.verifications[0]?.content,
  );
  expect(result.policy.profiles).toEqual(bundle.profiles);
  expect(formatResult(result)).toContain(
    `WHR_METER_POLICY=${JSON.stringify(result.policy)}`,
  );
  expect(formatResult(result)).toContain("--expected-revision 1");
});
it("applies atomically, deactivates, and rolls back by higher revision with immutable profiles", async () => {
  const { input, bundle } = await fixture();
  const active = await operate(pool, {
    ...input,
    apply: true,
    expectedRevision: 1,
  });
  const inactive = await operate(pool, {
    ...input,
    action: "deactivate",
    bundlePath: null,
    activatedAt: null,
    apply: true,
    expectedRevision: 2,
  });
  const rollback = await operate(pool, {
    ...input,
    apply: true,
    expectedRevision: 3,
  });
  expect([
    active.policy.revision,
    inactive.policy.revision,
    rollback.policy.revision,
  ]).toEqual([1, 2, 3]);
  expect(inactive.policy.activation.state).toBe("inactive");
  expect(inactive.policy.profiles).toEqual(bundle.profiles);
  expect(rollback.approval?.id).not.toBe(active.approval?.id);
  expect(await counts(input.stationId)).toEqual([1, 1, 2, 3]);
  await expect(
    pool.query(
      "UPDATE meter_verification SET content='{}' WHERE station_id=$1",
      [input.stationId],
    ),
  ).rejects.toThrow();
  await expect(
    pool.query("DELETE FROM meter_configuration WHERE station_id=$1", [
      input.stationId,
    ]),
  ).rejects.toThrow();
});
it("refuses stale expected revisions and permits only one concurrent activation", async () => {
  const { input } = await fixture();
  const outcomes = await Promise.allSettled([
    operate(pool, { ...input, apply: true, expectedRevision: 1 }),
    operate(pool, { ...input, apply: true, expectedRevision: 1 }),
  ]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  expect(await counts(input.stationId)).toEqual([1, 1, 1, 1]);
});
it("serializes activation and deactivation against the same authorized next revision", async () => {
  const { input } = await fixture();
  await operate(pool, { ...input, apply: true, expectedRevision: 1 });
  const outcomes = await Promise.allSettled([
    operate(pool, { ...input, apply: true, expectedRevision: 2 }),
    operate(pool, {
      ...input,
      action: "deactivate",
      bundlePath: null,
      activatedAt: null,
      apply: true,
      expectedRevision: 2,
    }),
  ]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  expect((await counts(input.stationId))[3]).toBe(2);
});
it("rejects future activation without loading any profile rows", async () => {
  const { input } = await fixture();
  await expect(
    operate(pool, {
      ...input,
      activatedAt: "2099-01-01T00:00:00Z",
      apply: true,
      expectedRevision: 1,
    }),
  ).rejects.toThrow("Future");
  expect(await counts(input.stationId)).toEqual([0, 0, 0, 0]);
});
it("requires recorded matching database identity even for preview and production", async () => {
  const { input } = await fixture();
  await expect(
    operate(pool, { ...input, environment: "production" }),
  ).rejects.toThrow("environment");
  await pool.query(`COMMENT ON DATABASE ${identifier} IS NULL`);
  await expect(operate(pool, input)).rejects.toThrow("environment");
  expect(await counts(input.stationId)).toEqual([0, 0, 0, 0]);
});
it("requires active matching resolver before activation but allows emergency deactivation", async () => {
  const { input } = await fixture();
  await operate(pool, { ...input, apply: true, expectedRevision: 1 });
  await configureResolver(pool, {
    action: "deactivate",
    stationId: input.stationId,
    environment: "test",
    digest: resolverDigest,
    authorizationReference: "TEST-DISABLE",
    activatedAt: null,
    apply: true,
    expectedRevision: 2,
  });
  await expect(
    operate(pool, { ...input, apply: true, expectedRevision: 2 }),
  ).rejects.toThrow();
  const disabled = await operate(pool, {
    ...input,
    action: "deactivate",
    bundlePath: null,
    activatedAt: null,
    apply: true,
    expectedRevision: 2,
  });
  expect(disabled.policy.activation.state).toBe("inactive");
});
it("rejects digest, scope, measured evidence and approval mismatch before writing", async () => {
  const { input, bundle } = await fixture();
  for (const mutate of [
    (b: typeof bundle) => {
      b.profiles[0]!.digest = "0".repeat(64);
    },
    (b: typeof bundle) => {
      b.verifications[0]!.stationId = randomUUID();
    },
    (b: typeof bundle) => {
      b.verifications[0]!.content.measuredMeterIdentity = "";
    },
    (b: typeof bundle) => {
      b.approvals[0]!.profileVersion = 2;
    },
  ]) {
    const b = structuredClone(bundle);
    mutate(b);
    await expect(
      operate(pool, { ...input, apply: true, expectedRevision: 1 }, b),
    ).rejects.toThrow();
  }
  expect(await counts(input.stationId)).toEqual([0, 0, 0, 0]);
});
it("rejects overlapping profile coverage and unknown bundle fields", async () => {
  const { input, bundle } = await fixture();
  expect(() =>
    validateBundle({ ...bundle, extra: true }, input.stationId),
  ).toThrow();
  const b = structuredClone(bundle),
    p = {
      ...b.profiles[0]!,
      id: randomUUID(),
      verificationReference: randomUUID(),
      approvalReference: randomUUID(),
    };
  p.digest = profileDigest(p);
  b.profiles.push(p);
  b.verifications.push({
    ...b.verifications[0]!,
    id: p.verificationReference,
    content: {
      ...b.verifications[0]!.content,
      profileContent: profileContent(p),
    },
  });
  b.approvals.push({
    ...b.approvals[0]!,
    id: p.approvalReference,
    profileId: p.id,
    digest: p.digest,
    profileContent: profileContent(p),
  });
  await expect(operate(pool, input, b)).rejects.toThrow("overlapping");
});
it("rejects reused profile identity with changed bytes and retains existing rows", async () => {
  const { input, bundle } = await fixture();
  await operate(pool, { ...input, apply: true, expectedRevision: 1 });
  const b = structuredClone(bundle),
    p = b.profiles[0]!;
  p.amountStepKobo = "5";
  p.verificationReference = randomUUID();
  p.approvalReference = randomUUID();
  p.digest = profileDigest(p);
  b.verifications[0] = {
    ...b.verifications[0]!,
    id: p.verificationReference,
    content: {
      ...b.verifications[0]!.content,
      profileContent: profileContent(p),
    },
  };
  b.approvals[0] = {
    ...b.approvals[0]!,
    id: p.approvalReference,
    digest: p.digest,
    profileContent: profileContent(p),
  };
  await expect(
    operate(pool, { ...input, apply: true, expectedRevision: 2 }, b),
  ).rejects.toThrow("identity conflicts");
  expect(await counts(input.stationId)).toEqual([1, 1, 1, 1]);
});
it("rolls back profile rows when a later configuration insertion fails", async () => {
  const { input } = await fixture();
  await pool.query(
    "CREATE FUNCTION fail_meter_operator_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$",
  );
  await pool.query(
    "CREATE TRIGGER fail_meter_operator_test BEFORE INSERT ON meter_configuration FOR EACH ROW EXECUTE FUNCTION fail_meter_operator_test()",
  );
  try {
    await expect(
      operate(pool, { ...input, apply: true, expectedRevision: 1 }),
    ).rejects.toThrow();
    expect(await counts(input.stationId)).toEqual([0, 0, 0, 0]);
  } finally {
    await pool.query(
      "DROP TRIGGER fail_meter_operator_test ON meter_configuration",
    );
    await pool.query("DROP FUNCTION fail_meter_operator_test()");
  }
});
it("rejects invalid arguments without leaking raw input", async () => {
  const { input } = await fixture();
  expect(() =>
    parseArguments(["activate", "--authorization", "private-secret"]),
  ).toThrow("Invalid");
  expect(() => parseArguments(["activate", "--apply", "--dry-run"])).toThrow();
  await expect(
    operate(pool, { ...input, digest: "0".repeat(64) }),
  ).rejects.toThrow("digest");
  const child = spawnSync(
    process.execPath,
    ["scripts/ops/meter.mjs", "--help"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: undefined },
    },
  );
  expect(child.status).toBe(0);
  expect(child.stdout).toContain("Default: dry run");
  const failed = spawnSync(
    process.execPath,
    ["scripts/ops/meter.mjs", "activate", "--authorization", "private-secret"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: undefined },
    },
  );
  expect(failed.status).toBe(1);
  expect(failed.stderr).not.toContain("private-secret");
});

it("rejects an approved bundle whose pump belongs to a different product", async () => {
  const { input, bundle } = await fixture();
  const p = bundle.profiles[0]!;
  p.productId = randomUUID();
  p.digest = profileDigest(p);
  bundle.verifications[0]!.content.profileContent = profileContent(p);
  Object.assign(bundle.approvals[0]!, {
    digest: p.digest,
    profileContent: profileContent(p),
  });
  await expect(
    operate(pool, { ...input, apply: true, expectedRevision: 1 }, bundle),
  ).rejects.toThrow("scope");
  expect(await counts(input.stationId)).toEqual([0, 0, 0, 0]);
});
it("persists measured verification notes through bound parameters and refuses changed verification bytes", async () => {
  const { input, bundle } = await fixture();
  bundle.verifications[0]!.content.verificationNotes =
    "Test measurement's nearest-step model; literal text remains data.";
  await operate(pool, { ...input, apply: true, expectedRevision: 1 }, bundle);
  const stored = await pool.query(
    "SELECT content FROM meter_verification WHERE id=$1",
    [bundle.verifications[0]!.id],
  );
  expect(stored.rows[0].content).toEqual(bundle.verifications[0]!.content);
  bundle.verifications[0]!.content.verificationNotes = "Changed test evidence";
  await expect(
    operate(pool, { ...input, apply: true, expectedRevision: 2 }, bundle),
  ).rejects.toThrow("verification identity");
  expect(await counts(input.stationId)).toEqual([1, 1, 1, 1]);
});

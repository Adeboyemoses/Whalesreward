import { afterEach, beforeEach, expect, it } from "vitest";
import {
  AbortMultipartUploadCommand,
  DeleteBucketLifecycleCommand,
  DeleteObjectCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { runMaintenance } from "../../src/server/modules/maintenance/service";
import {
  claimRun,
  commitPage,
} from "../../src/server/modules/maintenance/repo";
import { maintenanceLimits } from "../../src/server/modules/maintenance/types";
import {
  createMaintenanceStorage,
  type MaintenanceStorage,
} from "../../src/server/adapters/maintenance-storage";
import { maintenanceFixture } from "../helpers/maintenance-fixture";
import { reviewFixtureHarness } from "../helpers/review-fixture";
import { evidenceFixture } from "../helpers/review-evidence-fixture";
import { fixtureId, sha256 } from "../helpers/sync-fixture";
import { newId } from "../../src/server/lib/ids";

let f: Awaited<ReturnType<typeof maintenanceFixture>>;
beforeEach(async () => {
  f = undefined!;
  f = await maintenanceFixture();
}, 90_000);
afterEach(async () => {
  await f?.close();
}, 90_000);
const limits = { pageSize: 1, maxPages: 1, agedMs: 1 };
const v7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function complete(
  job: "orphans" | "reconcile-uploads",
  storage = createMaintenanceStorage(f.storageConfig),
) {
  const results = [];
  for (let n = 0; n < 30; n++) {
    const result = await runMaintenance({
      pool: f.runtime,
      storage,
      job,
      limits,
    });
    results.push(result);
    if (result.status === "succeeded") return results;
    expect(result.status).toBe("continued");
  }
  throw new Error("Bounded maintenance fixture did not complete");
}

it("I-51 report-only runtime has no domain delete, evidence write or lifecycle authority on real PostgreSQL and MinIO", async () => {
  const role = (
    await f.runtime.query(
      "SELECT current_user AS name,rolsuper,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  expect(role.name).toBe(f.role);
  expect([role.rolsuper, role.rolcreaterole, role.rolcreatedb]).toEqual([
    false,
    false,
    false,
  ]);
  for (const sql of [
    "DELETE FROM photo_asset WHERE false",
    "UPDATE photo_asset SET state=state WHERE false",
    "UPDATE purchase_revision SET state=state WHERE false",
    "INSERT INTO photo_receipt_observation DEFAULT VALUES",
    "TRUNCATE purchase CASCADE",
  ])
    await expect(f.runtime.query(sql)).rejects.toMatchObject({ code: "42501" });
  const key = `staging/${newId()}`;
  const object = await f.put(key, Buffer.from("fictional retained bytes"));
  const before = await f.versions();
  await expect(
    f.reader.send(
      new PutObjectCommand({
        Bucket: f.bucket,
        Key: key,
        Body: Buffer.from("forbidden evidence overwrite"),
      }),
    ),
  ).rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
  await expect(
    f.reader.send(new DeleteObjectCommand({ Bucket: f.bucket, Key: key })),
  ).rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
  await expect(
    f.reader.send(new DeleteBucketLifecycleCommand({ Bucket: f.bucket })),
  ).rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
  await expect(
    f.reader.send(
      new DeleteObjectCommand({
        Bucket: f.bucket,
        Key: key,
        VersionId: object.VersionId,
      }),
    ),
  ).rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
  await expect(
    f.reader.send(
      new AbortMultipartUploadCommand({
        Bucket: f.bucket,
        Key: key,
        UploadId: newId(),
      }),
    ),
  ).rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
  await expect(
    f.reader.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: f.bucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: "forbidden-removal",
              Status: "Enabled",
              Filter: { Prefix: "" },
              Expiration: { Days: 1 },
            },
          ],
        },
      }),
    ),
  ).rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
  expect(await f.versions()).toEqual(before);
  expect(await f.bytes(key, object.VersionId)).toEqual(
    Buffer.from("fictional retained bytes"),
  );
});

it("I-52 simultaneous real-PostgreSQL runners have one active per-job lease", async () => {
  const actual = createMaintenanceStorage(f.storageConfig);
  const entered = deferred(),
    release = deferred();
  let first = true;
  const storage: MaintenanceStorage = {
    ...actual,
    async listVersions(...args) {
      if (first) {
        first = false;
        entered.resolve();
        await release.promise;
      }
      return actual.listVersions(...args);
    },
  };
  const running = runMaintenance({
    pool: f.runtime,
    storage,
    job: "orphans",
    limits,
  });
  try {
    await Promise.race([
      entered.promise,
      running.then(() => {
        throw new Error("First runner exited before the provider barrier");
      }),
    ]);
    const competing = await runMaintenance({
      pool: f.runtime,
      storage: actual,
      job: "orphans",
      limits,
    });
    expect(competing.status).toBe("busy");
  } finally {
    release.resolve();
  }
  expect((await running).status).toBe("continued");
  const rows = await f.pool.query(
    "SELECT count(*)::int AS n FROM maintenance_run WHERE job='orphans'",
  );
  expect(rows.rows[0].n).toBe(1);
});

it("I-52 bounded version pages resume after restart without replacing committed reports or exposing object names", async () => {
  const canary = "Grace-08000000000-private-photo";
  await f.put(`staging/${canary}`, Buffer.from("first version"));
  await f.put(`staging/${canary}`, Buffer.from("second version"));
  await f.put(`final/${newId()}`, Buffer.from("unreferenced final"));
  const beforeVersions = await f.versions();
  const beforeDomain = await f.domainDigest();
  const results = await complete("orphans");
  expect(results.length).toBeGreaterThan(1);
  expect(new Set(results.map((r) => r.runId)).size).toBe(1);
  const runId = results[0]!.runId;
  expect(runId).toMatch(v7);
  const findings = (
    await f.pool.query(
      "SELECT * FROM maintenance_finding WHERE run_id=$1 ORDER BY page_no,ordinal",
      [runId],
    )
  ).rows;
  expect(findings.filter((r) => r.code === "aged_staged")).toHaveLength(2);
  expect(findings.filter((r) => r.code === "unreferenced_final")).toHaveLength(
    1,
  );
  expect(new Set(findings.map((r) => r.id)).size).toBe(findings.length);
  for (const finding of findings) expect(finding.id).toMatch(v7);
  expect(JSON.stringify(findings)).not.toContain(canary);
  expect(JSON.stringify(findings)).not.toContain("staging/");
  const objects = (await f.pool.query("SELECT id FROM maintenance_object"))
    .rows;
  expect(objects).toHaveLength(3);
  for (const object of objects) expect(object.id).toMatch(v7);
  const pages = (
    await f.pool.query("SELECT * FROM maintenance_page WHERE run_id=$1", [
      runId,
    ])
  ).rows;
  expect(pages.length).toBeLessThanOrEqual(results.length);
  for (const page of pages) expect(page.id).toMatch(v7);
  const health = (
    await f.pool.query(
      "SELECT heartbeat_at,last_complete_watermark,next_due_at,completion_deadline,last_outcome,error_code FROM maintenance_job WHERE job='orphans'",
    )
  ).rows[0];
  expect(health.heartbeat_at).toBeInstanceOf(Date);
  expect(health.last_complete_watermark).toBeInstanceOf(Date);
  expect(health.next_due_at.getTime()).toBeGreaterThan(
    health.last_complete_watermark.getTime(),
  );
  expect(health.last_outcome).toBe("succeeded");
  expect(health.error_code).toBeNull();
  expect(await f.versions()).toEqual(beforeVersions);
  expect(await f.domainDigest()).toBe(beforeDomain);
}, 30_000);

it.each(["UPDATE", "INSERT"] as const)(
  "I-51 column-only %s privilege is refused before any storage inventory",
  async (privilege) => {
    await f.pool.query(
      "CREATE TABLE domain_privilege_probe(id uuid,payload text)",
    );
    const grantee = privilege === "INSERT" ? "PUBLIC" : f.role;
    await f.pool.query(
      `GRANT ${privilege}(payload) ON domain_privilege_probe TO ${grantee}`,
    );
    const privileges = (
      await f.runtime.query(
        "SELECT has_table_privilege(current_user,'domain_privilege_probe',$1) AS whole,has_column_privilege(current_user,'domain_privilege_probe','payload',$1) AS column",
        [privilege],
      )
    ).rows[0];
    expect(privileges).toEqual({ whole: false, column: true });
    let touched = false;
    const actual = createMaintenanceStorage(f.storageConfig);
    const storage: MaintenanceStorage = {
      ...actual,
      async listVersions(...args) {
        touched = true;
        return actual.listVersions(...args);
      },
    };
    try {
      await expect(
        runMaintenance({ pool: f.runtime, storage, job: "orphans", limits }),
      ).rejects.toMatchObject({ code: "unsafe_database_role" });
      expect(touched).toBe(false);
      expect(
        (await f.pool.query("SELECT count(*)::int n FROM maintenance_run"))
          .rows[0].n,
      ).toBe(0);
    } finally {
      await f.pool.query(
        `REVOKE ${privilege}(payload) ON domain_privilege_probe FROM ${grantee}`,
      );
    }
  },
);

it("I-25/I-28 every retained receipt seal is reconciled even before fact attachment or asset validation", async () => {
  const h = reviewFixtureHarness(f.pool),
    bytes = await h.image(),
    context = await h.context(bytes);
  const observations: {
    id: string;
    assetId: string;
    purchaseId: string;
    key: string;
    state: "missing" | "corrupt" | "valid";
  }[] = [];
  for (const state of ["missing", "corrupt", "valid"] as const) {
    const submitted = await h.sync.submit(context.token, {
      ...context.original,
      operationId: newId(),
    });
    const upload = await h.sync.uploadPermission(
      context.token,
      submitted.status.purchaseId,
      { operationId: newId(), ...context.original.photo },
    );
    const asset = (
      await f.pool.query(
        "SELECT staging_key,final_key,state FROM photo_asset WHERE id=$1",
        [upload.uploadId],
      )
    ).rows[0];
    expect(asset.final_key).toBeNull();
    await f.put(asset.staging_key, bytes);
    const id = newId(),
      key = `final/seals/${id}`;
    await f.pool.query(
      "INSERT INTO photo_receipt_observation(id,station_id,purchase_id,asset_id,declared_digest,observed_digest,observed_bytes,sealed_key,receipt_at) VALUES($1,$2,$3,$4,$5,$5,$6,$7,clock_timestamp())",
      [
        id,
        context.stationId,
        submitted.status.purchaseId,
        upload.uploadId,
        sha256(bytes),
        bytes.length,
        key,
      ],
    );
    if (state !== "missing")
      await f.put(
        key,
        state === "valid" ? bytes : Buffer.alloc(bytes.length, 0x61),
      );
    observations.push({
      id,
      assetId: upload.uploadId,
      purchaseId: submitted.status.purchaseId,
      key,
      state,
    });
  }
  const first = observations[0]!,
    another = newId(),
    otherBytes = Buffer.from("another retained interrupted seal");
  await f.pool.query(
    "INSERT INTO photo_receipt_observation(id,station_id,purchase_id,asset_id,declared_digest,observed_digest,observed_bytes,sealed_key,receipt_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp())",
    [
      another,
      context.stationId,
      first.purchaseId,
      first.assetId,
      sha256(bytes),
      sha256(otherBytes),
      otherBytes.length,
      `final/seals/${another}`,
    ],
  );
  expect(
    (await f.pool.query("SELECT count(*)::int n FROM photo_receipt_fact"))
      .rows[0].n,
  ).toBe(0);
  const before = await f.domainDigest(),
    versions = await f.versions();
  await complete("reconcile-uploads");
  const findings = (
    await f.pool.query(
      "SELECT code,asset_id,purchase_id,reference_ids FROM maintenance_finding",
    )
  ).rows;
  for (const observation of observations.filter((o) => o.state !== "valid")) {
    expect(findings).toContainEqual({
      code:
        observation.state === "missing" ? "missing_object" : "digest_mismatch",
      asset_id: observation.assetId,
      purchase_id: observation.purchaseId,
      reference_ids: expect.arrayContaining([observation.id]),
    });
  }
  expect(findings).toContainEqual({
    code: "missing_object",
    asset_id: first.assetId,
    purchase_id: first.purchaseId,
    reference_ids: expect.arrayContaining([another]),
  });
  expect(
    findings.some(
      (row) =>
        row.reference_ids.includes(observations[2]!.id) &&
        ["missing_object", "digest_mismatch"].includes(row.code),
    ),
  ).toBe(false);
  expect(await f.domainDigest()).toBe(before);
  expect(await f.versions()).toEqual(versions);
}, 60_000);

async function delayedStagedAssets(count: number) {
  const h = reviewFixtureHarness(f.pool),
    bytes = await h.image(),
    context = await h.context(bytes);
  for (let n = 0; n < count; n++) {
    const submitted = await h.sync.submit(context.token, {
      ...context.original,
      operationId: newId(),
    });
    const upload = await h.sync.uploadPermission(
      context.token,
      submitted.status.purchaseId,
      { operationId: newId(), ...context.original.photo },
    );
    const asset = (
      await f.pool.query("SELECT staging_key FROM photo_asset WHERE id=$1", [
        upload.uploadId,
      ])
    ).rows[0];
    await f.put(asset.staging_key, bytes);
  }
  const actual = createMaintenanceStorage(f.storageConfig);
  let completedReads = 0;
  const storage: MaintenanceStorage = {
    ...actual,
    async observe(key, versionId, maximumBytes, signal) {
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new Error("fixture read aborted"));
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort);
          resolve();
        }, 450);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
      const observed = await actual.observe(
        key,
        versionId,
        maximumBytes,
        signal,
      );
      completedReads++;
      return observed;
    },
  };
  return { storage, reads: () => completedReads };
}

it("I-52 default 25-object pages checkpoint healthy 450ms reads beyond ten seconds and resume without replay", async () => {
  const delayed = await delayedStagedAssets(25),
    before = await f.domainDigest();
  const bounded = { maxPages: 1, agedMs: 1 };
  const start = Date.now();
  const first = await runMaintenance({
    pool: f.runtime,
    storage: delayed.storage,
    job: "reconcile-uploads",
    limits: bounded,
  });
  expect(["continued", "succeeded"]).toContain(first.status);
  const committed = (
    await f.pool.query(
      "SELECT id,page_no,counts FROM maintenance_page WHERE run_id=$1 ORDER BY page_no",
      [first.runId],
    )
  ).rows;
  expect(committed.length).toBeGreaterThan(0);
  expect(
    committed.reduce((total, row) => total + row.counts.scanned, 0),
  ).toBeGreaterThan(0);
  let last = first;
  for (let n = 0; last.status !== "succeeded" && n < 4; n++) {
    last = await runMaintenance({
      pool: f.runtime,
      storage: delayed.storage,
      job: "reconcile-uploads",
      limits: bounded,
    });
    expect(["continued", "succeeded"]).toContain(last.status);
    expect(last.runId).toBe(first.runId);
  }
  expect(last.status).toBe("succeeded");
  expect(last.counts.scanned).toBe(25);
  expect(delayed.reads()).toBe(25);
  expect(Date.now() - start).toBeGreaterThan(10_000);
  expect(
    (
      await f.pool.query(
        "SELECT id,page_no,counts FROM maintenance_page WHERE run_id=$1 ORDER BY page_no",
        [first.runId],
      )
    ).rows.slice(0, committed.length),
  ).toEqual(committed);
  expect(await f.domainDigest()).toBe(before);
}, 60_000);

it("I-52 short leases checkpoint completed healthy reads before expiry and restart at the next asset", async () => {
  const delayed = await delayedStagedAssets(6),
    before = await f.domainDigest();
  const bounded = {
    pageSize: 3,
    maxPages: 1,
    agedMs: 1,
    leaseMs: 2000,
    objectDeadlineMs: 1000,
  };
  let last = await runMaintenance({
    pool: f.runtime,
    storage: delayed.storage,
    job: "reconcile-uploads",
    limits: bounded,
  });
  const runId = last.runId;
  expect(last.status).toBe("continued");
  expect(last.counts.scanned).toBeGreaterThan(0);
  expect(last.counts.scanned).toBeLessThan(6);
  for (let n = 0; last.status !== "succeeded" && n < 8; n++) {
    last = await runMaintenance({
      pool: f.runtime,
      storage: delayed.storage,
      job: "reconcile-uploads",
      limits: bounded,
    });
    expect(["continued", "succeeded"]).toContain(last.status);
    expect(last.runId).toBe(runId);
  }
  expect(last.status).toBe("succeeded");
  expect(last.counts.scanned).toBe(6);
  expect(delayed.reads()).toBe(6);
  expect(await f.domainDigest()).toBe(before);
}, 60_000);

it("I-52 partial provider failure preserves a committed cursor and cannot advance complete watermark", async () => {
  await complete("orphans");
  const previousWatermark = (
    await f.pool.query(
      "SELECT last_complete_watermark FROM maintenance_job WHERE job='orphans'",
    )
  ).rows[0].last_complete_watermark;
  await f.pool.query(
    "UPDATE maintenance_job SET next_due_at=clock_timestamp() WHERE job='orphans'",
  );
  await f.put(`staging/${newId()}`, Buffer.from("first"));
  await f.put(`staging/${newId()}`, Buffer.from("second"));
  const actual = createMaintenanceStorage(f.storageConfig);
  let calls = 0;
  const storage: MaintenanceStorage = {
    ...actual,
    async listVersions(...args) {
      calls++;
      if (calls === 2)
        throw new Error(
          "private-canary https://example.invalid/signed?secret=do-not-report",
        );
      return actual.listVersions(...args);
    },
  };
  const failed = await runMaintenance({
    pool: f.runtime,
    storage,
    job: "orphans",
    limits: { ...limits, maxPages: 5 },
  });
  expect(failed.status).toBe("failed");
  const before = (
    await f.pool.query(
      "SELECT page_no,id FROM maintenance_page WHERE run_id=$1 ORDER BY page_no",
      [failed.runId],
    )
  ).rows;
  expect(before).toHaveLength(1);
  const health = (
    await f.pool.query(
      "SELECT last_complete_watermark,last_outcome,error_code FROM maintenance_job WHERE job='orphans'",
    )
  ).rows[0];
  expect(health.last_complete_watermark).toEqual(previousWatermark);
  expect(health.last_outcome).toBe("failed");
  expect(health.error_code).toMatch(/^[a-z_]+$/);
  expect(JSON.stringify(health)).not.toContain("private-canary");
  await f.pool.query(
    "UPDATE maintenance_job SET next_due_at=clock_timestamp() WHERE job='orphans'",
  );
  const resumed = await complete("orphans", actual);
  expect(resumed[0]!.runId).toBe(failed.runId);
  const after = (
    await f.pool.query(
      "SELECT page_no,id FROM maintenance_page WHERE run_id=$1 ORDER BY page_no",
      [failed.runId],
    )
  ).rows;
  expect(after.slice(0, before.length)).toEqual(before);
  const findings = (
    await f.pool.query("SELECT * FROM maintenance_finding WHERE run_id=$1", [
      failed.runId,
    ])
  ).rows;
  expect(findings.filter((r) => r.code === "aged_staged")).toHaveLength(2);
  expect(JSON.stringify(findings)).not.toContain("private-canary");
}, 30_000);

it("I-52 lease expiry fences the old runner after takeover on real PostgreSQL", async () => {
  const bounded = maintenanceLimits(limits);
  const old = await claimRun(f.runtime, "orphans", bounded);
  expect(old).toBeDefined();
  await f.pool.query(
    "UPDATE maintenance_job SET lease_until=clock_timestamp()-interval '1 second' WHERE job='orphans'",
  );
  await f.pool.query(
    "UPDATE maintenance_run SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
    [old!.runId],
  );
  const replacement = await claimRun(f.runtime, "orphans", bounded);
  expect(replacement).toBeDefined();
  expect(replacement!.runId).toBe(old!.runId);
  expect(BigInt(replacement!.fence)).toBeGreaterThan(BigInt(old!.fence));
  const page = {
    cursor: { phase: "done" as const, provider: null, after: null },
    counts: { scanned: 0 },
    findings: [],
    complete: true,
  };
  await expect(
    commitPage(f.runtime, old!, page, bounded),
  ).rejects.toMatchObject({ code: "lease_lost" });
  expect(
    (
      await f.pool.query(
        "SELECT count(*)::int AS n FROM maintenance_page WHERE run_id=$1",
        [old!.runId],
      )
    ).rows[0].n,
  ).toBe(0);
  await commitPage(f.runtime, replacement!, page, bounded);
  expect(
    (
      await f.pool.query(
        "SELECT count(*)::int AS n FROM maintenance_page WHERE run_id=$1",
        [old!.runId],
      )
    ).rows[0].n,
  ).toBe(1);
  await expect(
    f.pool.query("UPDATE maintenance_page SET counts='{}' WHERE run_id=$1", [
      old!.runId,
    ]),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    f.pool.query("DELETE FROM maintenance_page WHERE run_id=$1", [old!.runId]),
  ).rejects.toMatchObject({ code: "23514" });
});

it("I-25/I-26/I-28 reconciliation observes missing and mismatched bytes without repairing evidence or changing credit", async () => {
  const h = reviewFixtureHarness(f.pool);
  const bytes = await h.image();
  const context = await h.context(bytes);
  const settled = await h.settle(context, bytes);
  const asset = (
    await f.pool.query("SELECT * FROM photo_asset WHERE id=$1", [
      settled.assetId,
    ])
  ).rows[0];
  for (const [key, value] of h.objects) await f.put(key, value);
  await f.put(asset.final_key, Buffer.alloc(bytes.length, 0x61));
  const submitted = await h.sync.submit(context.token, {
    ...context.original,
    operationId: newId(),
  });
  await h.sync.uploadPermission(context.token, submitted.status.purchaseId, {
    operationId: newId(),
    ...context.original.photo,
  });
  const before = await f.domainDigest();
  const versions = await f.versions();
  await complete("reconcile-uploads");
  const findings = (
    await f.pool.query(
      "SELECT code,asset_id,purchase_id FROM maintenance_finding ORDER BY code",
    )
  ).rows;
  expect(findings).toContainEqual({
    code: "digest_mismatch",
    asset_id: settled.assetId,
    purchase_id: settled.purchaseId,
  });
  expect(
    findings.some(
      (r) =>
        r.code === "missing_object" &&
        r.purchase_id === submitted.status.purchaseId,
    ),
  ).toBe(true);
  expect(
    findings.some(
      (r) =>
        r.code === "stalled_upload" &&
        r.purchase_id === submitted.status.purchaseId,
    ),
  ).toBe(true);
  expect(await f.domainDigest()).toBe(before);
  expect(await f.versions()).toEqual(versions);
}, 30_000);

it("I-51 unsafe database owners are refused before any inventory read", async () => {
  let touched = false;
  const actual = createMaintenanceStorage(f.storageConfig);
  const storage: MaintenanceStorage = {
    ...actual,
    async listVersions(...args) {
      touched = true;
      return actual.listVersions(...args);
    },
  };
  await expect(
    runMaintenance({ pool: f.pool, storage, job: "orphans", limits }),
  ).rejects.toMatchObject({ code: "unsafe_database_role" });
  expect(touched).toBe(false);
});

it("I-52 an incomplete inventory cannot resume its cursor against a different bucket identity", async () => {
  const actual = createMaintenanceStorage(f.storageConfig);
  expect(
    (
      await runMaintenance({
        pool: f.runtime,
        storage: actual,
        job: "orphans",
        limits,
      })
    ).status,
  ).toBe("continued");
  const before = (
    await f.pool.query("SELECT id,cursor,page_no FROM maintenance_run")
  ).rows;
  let touched = false;
  const changed: MaintenanceStorage = {
    ...actual,
    identity: "b".repeat(64),
    async listVersions(...args) {
      touched = true;
      return actual.listVersions(...args);
    },
  };
  await expect(
    runMaintenance({
      pool: f.runtime,
      storage: changed,
      job: "orphans",
      limits,
    }),
  ).rejects.toMatchObject({ code: "invalid_configuration" });
  expect(touched).toBe(false);
  expect(
    (await f.pool.query("SELECT id,cursor,page_no FROM maintenance_run")).rows,
  ).toEqual(before);
});

it("I-52 a page that outlives its lease rolls back every finding and checkpoint", async () => {
  const bounded = maintenanceLimits({ ...limits, leaseMs: 1000 });
  await f.pool.query(
    "CREATE FUNCTION delay_maintenance_page() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(1.2); RETURN NEW; END $$",
  );
  await f.pool.query(
    "CREATE TRIGGER delay_maintenance_page BEFORE INSERT ON maintenance_page FOR EACH ROW EXECUTE FUNCTION delay_maintenance_page()",
  );
  const lease = await claimRun(f.runtime, "orphans", bounded);
  await expect(
    commitPage(
      f.runtime,
      lease!,
      {
        cursor: { phase: "done", provider: null, after: null },
        counts: { scanned: 1, findings: 1 },
        findings: [
          {
            code: "aged_staged",
            object: { key: `staging/${newId()}`, versionId: null },
          },
        ],
        complete: true,
      },
      bounded,
    ),
  ).rejects.toMatchObject({ code: "lease_lost" });
  for (const table of [
    "maintenance_page",
    "maintenance_finding",
    "maintenance_object",
  ]) {
    expect(
      (await f.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,
    ).toBe(0);
  }
  const run = (
    await f.pool.query(
      "SELECT page_no,watermark FROM maintenance_run WHERE id=$1",
      [lease!.runId],
    )
  ).rows[0];
  expect(run).toEqual({ page_no: 0, watermark: null });
}, 30_000);

it("I-25/I-35/I-51 retained sheet sources, holds and revision references survive orphan and receipt inventory", async () => {
  const x = await evidenceFixture(f, "price");
  const person = newId(),
    sheet = newId(),
    proposal = newId();
  await f.pool.query(
    "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
    [person, x.f.stationId],
  );
  const staging = `staging/${sheet}`,
    final = `final/sheets/${sheet}`,
    display = `final/sheet-display/${sheet}`;
  await f.pool.query(
    "INSERT INTO held_release_sheet(id,purchase_id,station_id,uploader_id,uploader_person_id,target,sha256,bytes,staging_key,expires_at) VALUES($1,$2,$3,$4,$5,'{}',$6,$7,$8,clock_timestamp()+interval '15 minutes')",
    [
      sheet,
      x.sale.purchaseId,
      x.f.stationId,
      fixtureId(2),
      person,
      sha256(x.bytes),
      x.bytes.length,
      staging,
    ],
  );
  await f.pool.query(
    "INSERT INTO held_release_sheet_validation(asset_id,final_key,display_key) VALUES($1,$2,$3)",
    [sheet, final, display],
  );
  await f.pool.query(
    "INSERT INTO held_release_proposal(id,purchase_id,station_id,target_kind,outcome,sheet_asset_id,proposer_id,proposer_person_id,content,provenance) VALUES($1,$2,$3,'price','confirm',$4,$5,$6,'{}','{}')",
    [proposal, x.sale.purchaseId, x.f.stationId, sheet, fixtureId(2), person],
  );
  const history = await f.pool.connect();
  try {
    await history.query("BEGIN");
    await history.query(
      "INSERT INTO held_release_state(proposal_id,purchase_id,state,version) VALUES($1,$2,'pending',1)",
      [proposal, x.sale.purchaseId],
    );
    await history.query(
      "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) VALUES($1,$2,1,'pending',$3,'{}')",
      [newId(), proposal, fixtureId(2)],
    );
    await history.query(
      "UPDATE held_release_state SET state='rejected',version=version+1 WHERE proposal_id=$1",
      [proposal],
    );
    await history.query(
      "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) VALUES($1,$2,2,'rejected',$3,'{}')",
      [newId(), proposal, fixtureId(2)],
    );
    await history.query("COMMIT");
  } catch (error) {
    await history.query("ROLLBACK");
    throw error;
  } finally {
    history.release();
  }
  for (const [key, value] of x.h.objects) await f.put(key, value);
  for (const key of [staging, final, display]) await f.put(key, x.bytes);
  const before = await f.domainDigest(),
    versions = await f.versions();
  await complete("orphans");
  const candidate = (
    await f.pool.query(
      "SELECT reference_ids FROM maintenance_finding WHERE asset_id=$1 AND code='aged_staged'",
      [sheet],
    )
  ).rows;
  expect(candidate).toHaveLength(1);
  expect(candidate[0].reference_ids).toEqual(
    expect.arrayContaining([sheet, x.holdId, proposal]),
  );
  const revisions = (
    await f.pool.query(
      "SELECT id FROM purchase_revision WHERE purchase_id=$1",
      [x.sale.purchaseId],
    )
  ).rows.map((r) => r.id);
  expect(candidate[0].reference_ids).toEqual(expect.arrayContaining(revisions));
  const misclassified = (
    await f.pool.query(
      "SELECT f.id FROM maintenance_finding f JOIN maintenance_object o ON o.id=f.object_id WHERE code='unreferenced_final' AND o.object_key=ANY($1::text[])",
      [[final, display]],
    )
  ).rows;
  expect(misclassified).toEqual([]);
  await complete("reconcile-uploads");
  expect(
    (
      await f.pool.query(
        "SELECT asset_id FROM maintenance_finding WHERE code='missing_digest' AND asset_id=$1",
        [sheet],
      )
    ).rows,
  ).toEqual([{ asset_id: sheet }]);
  expect(await f.domainDigest()).toBe(before);
  expect(await f.versions()).toEqual(versions);
}, 30_000);

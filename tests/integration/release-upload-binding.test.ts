import { randomBytes, createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { newId } from "../../src/server/lib/ids";
import { assertReleaseV2Installation } from "../../src/server/modules/reviews/release-v2";
import { createReleaseUploadsService } from "../../src/server/modules/reviews/release-uploads";
import { operate, parseArguments } from "../../scripts/ops/person.mjs";
import {
  evidenceDatabase,
  seedHistorical,
} from "../helpers/review-evidence-fixture";
import { heldReleaseRuntimeFixture } from "../helpers/giveaway-release-fixture";

const suffix = randomBytes(8).toString("hex");
const databaseName = `upload_binding_${suffix}`,
  ownerName = `upload_binding_owner_${suffix}`;
const dbIdentifier = pg.escapeIdentifier(databaseName),
  roleIdentifier = pg.escapeIdentifier(ownerName);
let root: pg.Pool, db: Awaited<ReturnType<typeof evidenceDatabase>>;
beforeAll(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await root.query(
    `CREATE ROLE ${roleIdentifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'fictional-upload-binding'`,
  );
  await root.query(`CREATE DATABASE ${dbIdentifier} OWNER ${roleIdentifier}`);
  const original = process.env.DATABASE_URL,
    url = new URL(original);
  url.pathname = `/${databaseName}`;
  url.username = ownerName;
  url.password = "fictional-upload-binding";
  url.search = "";
  const owner = new pg.Pool({ connectionString: url.toString() });
  try {
    await owner.query(
      `COMMENT ON DATABASE ${dbIdentifier} IS 'whr.environment=test'`,
    );
  } finally {
    await owner.end();
  }
  process.env.DATABASE_URL = url.toString();
  try {
    db = await evidenceDatabase();
  } finally {
    process.env.DATABASE_URL = original;
  }
}, 30000);
afterAll(async () => {
  await db?.close();
  if (root) {
    await root.query(`DROP DATABASE IF EXISTS ${dbIdentifier}`);
    await root.query(`DROP ROLE IF EXISTS ${roleIdentifier}`);
    await root.end();
  }
});
async function fixture() {
  const x = await heldReleaseRuntimeFixture(db);
  const service = createReleaseUploadsService({
    pool: db.pool,
    storage: x.h.storage,
    env: {
      WHR_ENV: "test",
      WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(x.policy),
    },
  });
  const input = {
    operationId: newId(),
    target: x.target,
    sha256: createHash("sha256").update(x.bytes).digest("hex"),
    bytes: x.bytes.length,
    contentType: "image/jpeg",
  };
  async function reserve() {
    const request = { ...input, operationId: newId() };
    const result = await service.reserve(x.token, x.sale.purchaseId, request);
    const url = await service.uploadUrl(
      x.token,
      x.sale.purchaseId,
      result.data.uploadId,
      {},
    );
    x.h.objects.set(url.url, x.bytes);
    return { request, result, id: result.data.uploadId };
  }
  async function op(action: string, flags: string[], reason: string) {
    const args = [
      action,
      "--station",
      x.f.stationId,
      "--environment",
      "test",
      ...flags,
      "--authorization",
      "FICTIONAL-UPLOAD-AUTH",
      "--reason-code",
      reason,
    ];
    const preview = await operate(db.pool, parseArguments(args));
    return operate(
      db.pool,
      parseArguments([
        ...args,
        "--apply",
        "--expected-revision",
        String(preview.revision),
      ]),
    );
  }
  async function reverify() {
    const binding = (
      await db.pool.query(
        "SELECT * FROM held_release_person_binding WHERE station_id=$1 AND user_id=$2 ORDER BY version DESC LIMIT 1",
        [x.f.stationId, x.actors[0]],
      )
    ).rows[0];
    await op(
      "unbind",
      [
        "--user",
        x.actors[0]!,
        "--expected-binding-version",
        String(binding.version),
      ],
      "identity_uncertain",
    );
    await op(
      "verify",
      [
        "--user",
        x.actors[0]!,
        "--person",
        binding.person_id,
        "--expected-binding-version",
        String(binding.version + 1),
        "--verification-reference",
        "FICTIONAL-UPLOAD-RECHECK",
      ],
      "verification_completed",
    );
  }
  return { x, service, reserve, reverify };
}
it("WHR-227 same-person operator re-verification invalidates an old sheet reservation but new reservation succeeds", async () => {
  const { x, service, reserve, reverify } = await fixture();
  expect(
    (
      await db.pool.query(
        "SELECT rolsuper FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0].rolsuper,
  ).toBe(false);
  const old = await reserve();
  await reverify();
  await expect(
    service.finalize(x.token, x.sale.purchaseId, old.id, {
      operationId: newId(),
    }),
  ).rejects.toMatchObject({ code: "proposal_stale" });
  await expect(
    service.uploadUrl(x.token, x.sale.purchaseId, old.id, {}),
  ).rejects.toMatchObject({ code: "proposal_stale" });
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM held_release_sheet_validation WHERE asset_id=$1",
        [old.id],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    await service.reserve(x.token, x.sale.purchaseId, old.request),
  ).toEqual({ ...old.result, replayed: true });
  const fresh = await reserve(),
    operation = { operationId: newId() };
  const result = await service.finalize(
    x.token,
    x.sale.purchaseId,
    fresh.id,
    operation,
  );
  expect(result).toEqual({ assetId: fresh.id, state: "validated" });
  await reverify();
  expect(
    await service.finalize(x.token, x.sale.purchaseId, fresh.id, operation),
  ).toEqual(result);
}, 30000);
it("WHR-227 already validated sheet cannot enter a new proposal after same-person operator re-verification", async () => {
  const { x, service, reserve, reverify } = await fixture();
  const old = await reserve();
  await service.finalize(x.token, x.sale.purchaseId, old.id, {
    operationId: newId(),
  });
  const before = (
    await db.pool.query(
      "SELECT to_jsonb(v) value FROM held_release_sheet_validation v WHERE asset_id=$1",
      [old.id],
    )
  ).rows[0];
  await reverify();
  await expect(
    x.svc.propose(x.token, x.sale.purchaseId, {
      ...x.body,
      sheetAssetId: old.id,
    }),
  ).rejects.toMatchObject({ code: "evidence_unavailable" });
  expect(
    (await db.pool.query("SELECT count(*)::int n FROM held_release_proposal"))
      .rows[0].n,
  ).toBe(0);
  expect(
    (
      await db.pool.query(
        "SELECT to_jsonb(v) value FROM held_release_sheet_validation v WHERE asset_id=$1",
        [old.id],
      )
    ).rows[0],
  ).toEqual(before);
  const fresh = await reserve();
  await service.finalize(x.token, x.sale.purchaseId, fresh.id, {
    operationId: newId(),
  });
  expect(
    (
      await x.svc.propose(x.token, x.sale.purchaseId, {
        ...x.body,
        sheetAssetId: fresh.id,
        operationId: newId(),
      })
    ).proposal.state,
  ).toBe("pending");
}, 30000);

it("WHR-227 unpinned legacy sheets fail closed for fresh use while attached history and receipts stay readable", async () => {
  const { x, service } = await fixture();
  const oldId = x.body.sheetAssetId;
  // Emulate an asset that predates this additive migration: its pin stays unknown.
  await seedHistorical(
    db.pool,
    "held_release_sheet",
    "UPDATE held_release_sheet SET uploader_binding_id=NULL,uploader_binding_version=NULL WHERE id=$1",
    [oldId],
  );
  await expect(
    x.svc.propose(x.token, x.sale.purchaseId, x.body),
  ).rejects.toMatchObject({ code: "evidence_unavailable" });
  await expect(
    service.uploadUrl(x.token, x.sale.purchaseId, oldId, {}),
  ).rejects.toMatchObject({ code: "proposal_stale" });
  await expect(
    service.finalize(x.token, x.sale.purchaseId, oldId, {
      operationId: newId(),
    }),
  ).rejects.toMatchObject({ code: "proposal_stale" });
  const fresh = await fixture(),
    first = await fresh.x.svc.propose(
      fresh.x.token,
      fresh.x.sale.purchaseId,
      fresh.x.body,
    );
  await seedHistorical(
    db.pool,
    "held_release_sheet",
    "UPDATE held_release_sheet SET uploader_binding_id=NULL,uploader_binding_version=NULL WHERE id=$1",
    [fresh.x.body.sheetAssetId],
  );
  const retained = (
    await db.pool.query(
      "SELECT to_jsonb(s) value FROM held_release_sheet s WHERE id=$1",
      [fresh.x.body.sheetAssetId],
    )
  ).rows[0];
  await fresh.reverify();
  expect(
    (
      await fresh.x.svc.get(
        fresh.x.token,
        fresh.x.sale.purchaseId,
        first.proposal.id,
      )
    ).id,
  ).toBe(first.proposal.id);
  expect(
    await fresh.x.svc.propose(
      fresh.x.token,
      fresh.x.sale.purchaseId,
      fresh.x.body,
    ),
  ).toEqual({ ...first, replayed: true });
  expect(
    (
      await db.pool.query(
        "SELECT to_jsonb(s) value FROM held_release_sheet s WHERE id=$1",
        [fresh.x.body.sheetAssetId],
      )
    ).rows[0],
  ).toEqual(retained);
}, 30000);
it("WHR-227 same-person binding successor during storage cannot commit validation or a new attachment", async () => {
  const first = await fixture(),
    old = await first.reserve();
  let changed = false;
  const slow = createReleaseUploadsService({
    pool: db.pool,
    env: {
      WHR_ENV: "test",
      WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(first.x.policy),
    },
    storage: {
      ...first.x.h.storage,
      async writeFinal(key, bytes) {
        await first.x.h.storage.writeFinal(key, bytes);
        if (!changed) {
          changed = true;
          await first.reverify();
        }
      },
    },
  });
  await expect(
    slow.finalize(first.x.token, first.x.sale.purchaseId, old.id, {
      operationId: newId(),
    }),
  ).rejects.toMatchObject({ code: "proposal_stale" });
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM held_release_sheet_validation WHERE asset_id=$1",
        [old.id],
      )
    ).rows[0].n,
  ).toBe(0);
  const second = await fixture(),
    asset = await second.reserve();
  await second.service.finalize(
    second.x.token,
    second.x.sale.purchaseId,
    asset.id,
    { operationId: newId() },
  );
  const finalKey = (
    await db.pool.query(
      "SELECT final_key FROM held_release_sheet_validation WHERE asset_id=$1",
      [asset.id],
    )
  ).rows[0].final_key;
  const read = second.x.h.storage.read;
  let rebound = false;
  second.x.h.storage.read = async (key, max) => {
    const bytes = await read(key, max);
    if (key === finalKey && !rebound) {
      rebound = true;
      await second.reverify();
    }
    return bytes;
  };
  await expect(
    second.x.svc.propose(second.x.token, second.x.sale.purchaseId, {
      ...second.x.body,
      sheetAssetId: asset.id,
    }),
  ).rejects.toMatchObject({ code: "evidence_unavailable" });
  expect(
    (await db.pool.query("SELECT count(*)::int n FROM held_release_proposal"))
      .rows[0].n,
  ).toBe(0);
}, 30000);
it("WHR-227 non-superuser cannot mutate or forge a sheet reservation binding pin", async () => {
  const { x, reserve } = await fixture(),
    reserved = await reserve();
  const row = (
    await db.pool.query("SELECT * FROM held_release_sheet WHERE id=$1", [
      reserved.id,
    ])
  ).rows[0];
  const current = (
    await db.pool.query(
      "SELECT * FROM held_release_person_binding WHERE user_id=$1 ORDER BY version DESC LIMIT 1",
      [x.actors[0]],
    )
  ).rows[0];
  expect(row.uploader_binding_id).toBe(current.id);
  expect(row.uploader_binding_version).toBe(current.version);
  await expect(
    db.pool.query(
      "UPDATE held_release_sheet SET uploader_binding_version=uploader_binding_version+1 WHERE id=$1",
      [reserved.id],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    db.pool.query(
      "INSERT INTO held_release_sheet SELECT (jsonb_populate_record(NULL::held_release_sheet,to_jsonb(s)||jsonb_build_object('id',$2::text,'staging_key',$3::text,'uploader_binding_version',99))).* FROM held_release_sheet s WHERE id=$1",
      [reserved.id, newId(), `staging/fictional/${newId()}`],
    ),
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    db.pool.query(
      "INSERT INTO held_release_sheet SELECT (jsonb_populate_record(NULL::held_release_sheet,to_jsonb(s)||jsonb_build_object('id',$2::text,'staging_key',$3::text,'uploader_binding_id',null))).* FROM held_release_sheet s WHERE id=$1",
      [reserved.id, newId(), `staging/fictional/${newId()}`],
    ),
  ).rejects.toMatchObject({ code: "23514" });
}, 30000);

it("WHR-227 v2 installation refuses absent sheet binding pins or a disabled reservation guard", async () => {
  const { x } = await fixture();
  await expect(
    assertReleaseV2Installation(db.pool, x.f.stationId),
  ).resolves.toBeUndefined();
  await db.pool.query(
    "ALTER TABLE held_release_sheet RENAME COLUMN uploader_binding_version TO missing_binding_version",
  );
  try {
    await expect(
      assertReleaseV2Installation(db.pool, x.f.stationId),
    ).rejects.toThrow("release_policy_unconfigured");
  } finally {
    await db.pool.query(
      "ALTER TABLE held_release_sheet RENAME COLUMN missing_binding_version TO uploader_binding_version",
    );
  }
  await db.pool.query(
    "ALTER TABLE held_release_sheet DISABLE TRIGGER held_release_sheet_binding_guard",
  );
  try {
    await expect(
      assertReleaseV2Installation(db.pool, x.f.stationId),
    ).rejects.toThrow("release_policy_unconfigured");
  } finally {
    await db.pool.query(
      "ALTER TABLE held_release_sheet ENABLE TRIGGER held_release_sheet_binding_guard",
    );
  }
  await expect(
    assertReleaseV2Installation(db.pool, x.f.stationId),
  ).resolves.toBeUndefined();
}, 30000);

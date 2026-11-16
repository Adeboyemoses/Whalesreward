import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { newId } from "../../src/server/lib/ids";
import {
  evidenceDatabase,
  evidenceFixture,
} from "../helpers/review-evidence-fixture";
import { createReleaseUploadsService } from "../../src/server/modules/reviews/release-uploads";
// Isolate upload protocol from the deliberately absent giveaway installation.
// This does not establish that v2 is activatable; operator tests exercise the real gate.
vi.mock("../../src/server/modules/reviews/config", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("../../src/server/modules/reviews/config")
    >();
  return {
    ...real,
    pinReleaseV2Policy: vi.fn(async (_db, stationId) => ({
      release: "review-evidence-v2",
      revision: 1,
      scope: { stationId, environment: "test" },
      digest: "a".repeat(64),
    })),
  };
});
let db: Awaited<ReturnType<typeof evidenceDatabase>>;
beforeAll(async () => {
  db = await evidenceDatabase();
}, 30000);
afterAll(async () => {
  await db.close();
});
async function fixture() {
  const x = await evidenceFixture(db, "price");
  const users = (await db.pool.query("SELECT id FROM auth_user")).rows;
  for (const u of users) {
    const person = newId();
    await db.pool.query(
      "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
      [person, x.f.stationId],
    );
    await db.pool.query(
      "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,1,true)",
      [newId(), x.f.stationId, u.id, person],
    );
  }
  const svc = createReleaseUploadsService({
    pool: db.pool,
    storage: x.h.storage,
    env: { WHR_ENV: "test" },
  });
  const input = {
    operationId: newId(),
    target: { kind: "price", holdId: x.holdId, expectedHoldVersion: 1 },
    sha256: createHash("sha256").update(x.bytes).digest("hex"),
    bytes: x.bytes.length,
    contentType: "image/jpeg",
  };
  return { x, svc, input };
}
it("SR-04/SR-05 sheet reserve/finalize replay retains immutable bytes and leaves purchase guard unchanged", async () => {
  const { x, svc, input } = await fixture();
  const before = await x.h.guard(x.sale.purchaseId);
  const reserved = await svc.reserve(x.token, x.sale.purchaseId, input);
  expect(reserved.replayed).toBe(false);
  expect(await svc.reserve(x.token, x.sale.purchaseId, input)).toEqual({
    ...reserved,
    replayed: true,
  });
  await expect(
    svc.reserve(x.token, x.sale.purchaseId, {
      ...input,
      sha256: "b".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "operation_conflict" });
  const url = await svc.uploadUrl(
    x.token,
    x.sale.purchaseId,
    reserved.data.uploadId,
    {},
  );
  x.h.objects.set(url.url, x.bytes);
  const op = { operationId: newId() };
  const finalized = await svc.finalize(
    x.token,
    x.sale.purchaseId,
    reserved.data.uploadId,
    op,
  );
  expect(finalized).toEqual({
    assetId: reserved.data.assetId,
    state: "validated",
  });
  x.h.objects.set(url.url, Buffer.from("overwritten"));
  expect(
    await svc.finalize(x.token, x.sale.purchaseId, reserved.data.uploadId, op),
  ).toEqual(finalized);
  const validation = (
    await db.pool.query(
      "SELECT * FROM held_release_sheet_validation WHERE asset_id=$1",
      [reserved.data.assetId],
    )
  ).rows[0];
  expect(x.h.objects.get(validation.final_key)).toEqual(x.bytes);
  expect(await x.h.guard(x.sale.purchaseId)).toMatchObject({
    expectedVersion: before.expectedVersion,
    expectedRevisionId: before.expectedRevisionId,
  });
  await expect(
    svc.uploadUrl(x.token, x.sale.purchaseId, reserved.data.uploadId, {}),
  ).rejects.toMatchObject({ code: "evidence_already_validated" });
});
it("SR-03 unknown binding and original attendant alias deny before sheet reservation", async () => {
  const { x, svc, input } = await fixture();
  const actor = (
    await db.pool.query("SELECT user_id FROM admin ORDER BY id LIMIT 1")
  ).rows[0].user_id;
  await db.pool.query(
    "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) SELECT $1,station_id,user_id,person_id,2,false FROM held_release_person_binding WHERE user_id=$2",
    [newId(), actor],
  );
  await expect(
    svc.reserve(x.token, x.sale.purchaseId, input),
  ).rejects.toMatchObject({ code: "independence_unverifiable" });
  expect(
    (await db.pool.query("SELECT count(*)::int n FROM held_release_sheet"))
      .rows[0].n,
  ).toBe(0);
});

it("SR-03/SR-04 revocation during private storage prevents validated evidence commit", async () => {
  const { x, svc, input } = await fixture();
  const reserved = await svc.reserve(x.token, x.sale.purchaseId, input);
  const url = await svc.uploadUrl(
    x.token,
    x.sale.purchaseId,
    reserved.data.uploadId,
    {},
  );
  x.h.objects.set(url.url, x.bytes);
  let revoked = false;
  const slow = {
    ...x.h.storage,
    async writeFinal(key: string, bytes: Buffer) {
      await x.h.storage.writeFinal(key, bytes);
      if (!revoked) {
        revoked = true;
        await db.pool.query(
          "UPDATE auth_user SET enabled=false WHERE id IN (SELECT user_id FROM admin)",
        );
      }
    },
  };
  const second = createReleaseUploadsService({
    pool: db.pool,
    storage: slow,
    env: { WHR_ENV: "test" },
  });
  await expect(
    second.finalize(x.token, x.sale.purchaseId, reserved.data.uploadId, {
      operationId: newId(),
    }),
  ).rejects.toBeDefined();
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM held_release_sheet_validation",
      )
    ).rows[0].n,
  ).toBe(0);
});
it("SR-04/SR-05 invalid JPEG and simultaneous finalize never create competing validations", async () => {
  const { x, svc, input } = await fixture();
  const reserved = await svc.reserve(x.token, x.sale.purchaseId, input);
  const url = await svc.uploadUrl(
    x.token,
    x.sale.purchaseId,
    reserved.data.uploadId,
    {},
  );
  x.h.objects.set(url.url, Buffer.from("not jpeg"));
  await expect(
    svc.finalize(x.token, x.sale.purchaseId, reserved.data.uploadId, {
      operationId: newId(),
    }),
  ).rejects.toMatchObject({ code: "photo_invalid" });
  x.h.objects.set(url.url, x.bytes);
  const operation = { operationId: newId() };
  const results = await Promise.all([
    svc.finalize(x.token, x.sale.purchaseId, reserved.data.uploadId, operation),
    svc.finalize(x.token, x.sale.purchaseId, reserved.data.uploadId, operation),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM held_release_sheet_validation",
      )
    ).rows[0].n,
  ).toBe(1);
});

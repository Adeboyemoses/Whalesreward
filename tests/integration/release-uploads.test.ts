import { beforeAll, afterAll, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  StorageNotFoundError,
  StorageSizeError,
} from "../../src/server/adapters/storage";
import { fixtureId } from "../helpers/sync-fixture";
import { digest as tokenDigest } from "../../src/server/modules/auth/crypto";
import { seedHistorical } from "../helpers/review-evidence-fixture";
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
  await db.pool.query(
    "INSERT INTO role_permission(role_id,permission_code) SELECT role_id,unnest(ARRAY['sales','priceReview']) FROM admin WHERE user_id=$1 ON CONFLICT DO NOTHING",
    [fixtureId(2)],
  );
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
it("SR-03 unknown binding denies before sheet reservation", async () => {
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

async function reservation(
  f: Awaited<ReturnType<typeof fixture>>,
  input = f.input,
) {
  const r = await f.svc.reserve(f.x.token, f.x.sale.purchaseId, input);
  const u = await f.svc.uploadUrl(
    f.x.token,
    f.x.sale.purchaseId,
    r.data.uploadId,
    {},
  );
  return { id: r.data.uploadId, url: u };
}
async function unchanged(
  f: Awaited<ReturnType<typeof fixture>>,
  run: () => Promise<unknown>,
  code: string,
) {
  const before = (
    await db.pool.query(
      "SELECT to_jsonb(p) value FROM purchase p WHERE id=$1",
      [f.x.sale.purchaseId],
    )
  ).rows;
  await expect(run()).rejects.toMatchObject({ code });
  expect(
    (
      await db.pool.query(
        "SELECT to_jsonb(p) value FROM purchase p WHERE id=$1",
        [f.x.sale.purchaseId],
      )
    ).rows,
  ).toEqual(before);
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM held_release_sheet_validation",
      )
    ).rows[0].n,
  ).toBe(0);
}
it.each(["digest", "byte-count", "png", "axis", "pixels", "truncated-decode"])(
  "SR-04 actual %s violation refuses final evidence and leaves sale unchanged",
  async (kind) => {
    const f = await fixture();
    let bytes = f.x.bytes;
    if (kind === "png") bytes = await sharp(bytes).png().toBuffer();
    if (kind === "axis")
      bytes = await sharp({
        create: { width: 6001, height: 1, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer();
    if (kind === "pixels")
      bytes = await sharp({
        create: { width: 4001, height: 4000, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer();
    if (kind === "truncated-decode")
      bytes = bytes.subarray(0, bytes.length - 20);
    const input = {
      ...f.input,
      sha256:
        kind === "digest"
          ? "a".repeat(64)
          : createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length + (kind === "byte-count" ? 1 : 0),
    };
    const r = await reservation(f, input);
    f.x.h.objects.set(r.url.url, bytes);
    await unchanged(
      f,
      () =>
        f.svc.finalize(f.x.token, f.x.sale.purchaseId, r.id, {
          operationId: newId(),
        }),
      "photo_invalid",
    );
  },
);
it.each([
  "missing",
  "oversize",
  "read-transient",
  "write-transient",
  "sign-transient",
])(
  "SR-04 %s storage condition leaves validation absent and retry safe",
  async (kind) => {
    const f = await fixture(),
      r = await reservation(f);
    f.x.h.objects.set(r.url.url, f.x.bytes);
    const storage = { ...f.x.h.storage };
    if (kind === "missing")
      storage.read = async () => {
        throw new StorageNotFoundError();
      };
    if (kind === "oversize")
      storage.read = async () => {
        throw new StorageSizeError();
      };
    if (kind === "read-transient")
      storage.read = async () => {
        throw new Error("fictional provider outage");
      };
    if (kind === "write-transient")
      storage.writeFinal = async () => {
        throw new Error("fictional provider outage");
      };
    if (kind === "sign-transient")
      storage.signPut = async () => {
        throw new Error("fictional provider outage");
      };
    const svc = createReleaseUploadsService({
        pool: db.pool,
        storage,
        env: { WHR_ENV: "test" },
      }),
      op = { operationId: newId() };
    await unchanged(
      f,
      () =>
        kind === "sign-transient"
          ? svc.uploadUrl(f.x.token, f.x.sale.purchaseId, r.id, {})
          : svc.finalize(f.x.token, f.x.sale.purchaseId, r.id, op),
      kind === "missing"
        ? "evidence_pending"
        : kind === "oversize"
          ? "photo_invalid"
          : "storage_unavailable",
    );
    expect(
      await f.svc.finalize(f.x.token, f.x.sale.purchaseId, r.id, op),
    ).toMatchObject({ state: "validated" });
  },
);
it("SR-04 sheet purpose and purchase scope reject original meter asset and foreign purchase IDs", async () => {
  const f = await fixture(),
    r = await reservation(f);
  for (const [sale, id] of [
    [f.x.sale.purchaseId, f.x.sale.assetId],
    [newId(), r.id],
  ]) {
    await unchanged(
      f,
      () => f.svc.uploadUrl(f.x.token, sale, id, {}),
      "not_found",
    );
    await unchanged(
      f,
      () => f.svc.finalize(f.x.token, sale, id, { operationId: newId() }),
      "not_found",
    );
  }
});
it.each([
  "disabled",
  "first-password",
  "revoked",
  "recovery",
  "no-sales",
  "no-kind",
])(
  "SR-03 %s authority denies reserve replay and upload/finalize",
  async (kind) => {
    const f = await fixture(),
      r = await reservation(f);
    f.x.h.objects.set(r.url.url, f.x.bytes);
    let token = f.x.token,
      code = "unauthenticated";
    if (kind === "disabled")
      await db.pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
        fixtureId(2),
      ]);
    if (kind === "first-password") {
      await db.pool.query(
        "UPDATE auth_user SET must_change_password=true WHERE id=$1",
        [fixtureId(2)],
      );
      code = "password_change_required";
    }
    if (kind === "revoked")
      await db.pool.query(
        "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE secret_verifier=$1",
        [tokenDigest(token)],
      );
    if (kind === "recovery")
      token = "restricted-recovery-fixture-no-admin-session";
    if (kind.startsWith("no-")) {
      await db.pool.query(
        "DELETE FROM role_permission WHERE role_id=(SELECT role_id FROM admin WHERE user_id=$1) AND permission_code=$2",
        [fixtureId(2), kind === "no-sales" ? "sales" : "priceReview"],
      );
      code = "permission_denied";
    }
    await unchanged(
      f,
      () => f.svc.reserve(token, f.x.sale.purchaseId, f.input),
      code,
    );
    await unchanged(
      f,
      () => f.svc.uploadUrl(token, f.x.sale.purchaseId, r.id, {}),
      code,
    );
    await unchanged(
      f,
      () =>
        f.svc.finalize(token, f.x.sale.purchaseId, r.id, {
          operationId: newId(),
        }),
      code,
    );
  },
);
it("SR-03 original attendant alias and rebound uploader cannot reserve or replay", async () => {
  const f = await fixture(),
    r = await reservation(f);
  await db.pool.query(
    "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) SELECT $1,station_id,$2,person_id,2,true FROM held_release_person_binding WHERE user_id=(SELECT user_id FROM attendant WHERE id=(SELECT originating_attendant_id FROM purchase WHERE id=$3))",
    [newId(), fixtureId(2), f.x.sale.purchaseId],
  );
  await unchanged(
    f,
    () => f.svc.reserve(f.x.token, f.x.sale.purchaseId, f.input),
    "independent_reviewer_required",
  );
  await unchanged(
    f,
    () => f.svc.uploadUrl(f.x.token, f.x.sale.purchaseId, r.id, {}),
    "independent_reviewer_required",
  );
});
it("SR-04 reservation expiry and signed PUT expiry never exceed their ceilings", async () => {
  const f = await fixture(),
    start = Date.now(),
    r = await reservation(f);
  expect(Date.parse(r.url.expiresAt) - start).toBeLessThanOrEqual(300500);
  const row = (
    await db.pool.query(
      "SELECT created_at,expires_at FROM held_release_sheet WHERE id=$1",
      [r.id],
    )
  ).rows[0];
  expect(
    row.expires_at.getTime() - row.created_at.getTime(),
  ).toBeLessThanOrEqual(900001);
  await seedHistorical(
    db.pool,
    "held_release_sheet",
    "UPDATE held_release_sheet SET expires_at=clock_timestamp()+interval '20 seconds' WHERE id=$1",
    [r.id],
  );
  const short = await f.svc.uploadUrl(f.x.token, f.x.sale.purchaseId, r.id, {});
  expect(Date.parse(short.expiresAt) - Date.now()).toBeLessThanOrEqual(20000);
  await seedHistorical(
    db.pool,
    "held_release_sheet",
    "UPDATE held_release_sheet SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [r.id],
  );
  await unchanged(
    f,
    () => f.svc.uploadUrl(f.x.token, f.x.sale.purchaseId, r.id, {}),
    "upload_expired",
  );
  await unchanged(
    f,
    () =>
      f.svc.finalize(f.x.token, f.x.sale.purchaseId, r.id, {
        operationId: newId(),
      }),
    "upload_expired",
  );
});
it("SR-05 changed reserve target or bytes and cross-upload finalize key conflict durably", async () => {
  const f = await fixture(),
    r = await reservation(f);
  for (const change of [
    { bytes: f.input.bytes + 1 },
    { target: { ...f.input.target, expectedHoldVersion: 2 } },
  ])
    await unchanged(
      f,
      () =>
        f.svc.reserve(f.x.token, f.x.sale.purchaseId, {
          ...f.input,
          ...change,
        }),
      "operation_conflict",
    );
  f.x.h.objects.set(r.url.url, f.x.bytes);
  const op = { operationId: newId() };
  await f.svc.finalize(f.x.token, f.x.sale.purchaseId, r.id, op);
  const second = await reservation(f, { ...f.input, operationId: newId() });
  await expect(
    f.svc.finalize(f.x.token, f.x.sale.purchaseId, second.id, op),
  ).rejects.toMatchObject({ code: "operation_conflict" });
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM held_release_sheet_validation",
      )
    ).rows[0].n,
  ).toBe(1);
});
it("SR-03 cross-station scope cannot replay a retained reservation", async () => {
  const f = await fixture(),
    r = await reservation(f);
  await db.pool.query(
    "INSERT INTO station(id,code,name,timezone,version) VALUES($1,$2,'Fictional other station','Africa/Lagos',1)",
    [newId(), newId()],
  );
  await unchanged(
    f,
    () => f.svc.reserve(f.x.token, f.x.sale.purchaseId, f.input),
    "permission_denied",
  );
  await unchanged(
    f,
    () => f.svc.uploadUrl(f.x.token, f.x.sale.purchaseId, r.id, {}),
    "permission_denied",
  );
});

it("SR-04 different authorized uploader cannot sign or finalize another person's reservation", async () => {
  const f = await fixture(),
    r = await reservation(f),
    user = newId(),
    person = newId(),
    token = newId();
  await db.pool.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1::uuid,'admin',$1::text,$1::text,'Fictional Reviewer',true,1,false,clock_timestamp())",
    [user],
  );
  await db.pool.query(
    "INSERT INTO admin(id,user_id,admin_code,role_id,version) SELECT $1::uuid,$2::uuid,$1::text,role_id,1 FROM admin WHERE user_id=$3",
    [newId(), user, fixtureId(2)],
  );
  await db.pool.query(
    "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',1,clock_timestamp())",
    [newId(), user, tokenDigest(token)],
  );
  await db.pool.query(
    "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
    [person, f.x.f.stationId],
  );
  await db.pool.query(
    "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,1,true)",
    [newId(), f.x.f.stationId, user, person],
  );
  await unchanged(
    f,
    () => f.svc.uploadUrl(token, f.x.sale.purchaseId, r.id, {}),
    "not_found",
  );
  await unchanged(
    f,
    () =>
      f.svc.finalize(token, f.x.sale.purchaseId, r.id, {
        operationId: newId(),
      }),
    "not_found",
  );
});
it.each([0, 8388609])(
  "SR-04 reservation byte declaration %s fails strict bounds before storage",
  async (bytes) => {
    const f = await fixture();
    await expect(
      f.svc.reserve(f.x.token, f.x.sale.purchaseId, { ...f.input, bytes }),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(
      (await db.pool.query("SELECT count(*)::int n FROM held_release_sheet"))
        .rows[0].n,
    ).toBe(0);
  },
);

it("SR-05 simultaneous lost-response reservation retries return one immutable asset and receipt", async () => {
  const f = await fixture();
  const replies = await Promise.all([
    f.svc.reserve(f.x.token, f.x.sale.purchaseId, f.input),
    f.svc.reserve(f.x.token, f.x.sale.purchaseId, f.input),
  ]);
  expect(replies[0].data).toEqual(replies[1].data);
  expect(replies.map((r) => r.replayed).sort()).toEqual([false, true]);
  expect(
    (await db.pool.query("SELECT count(*)::int n FROM held_release_sheet"))
      .rows[0].n,
  ).toBe(1);
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM held_release_receipt WHERE operation_kind='sheet-reserve' AND operation_id=$1",
        [f.input.operationId],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("SR-03/SR-05 successful finalize replay still checks current authority", async () => {
  const f = await fixture(),
    r = await reservation(f),
    op = { operationId: newId() };
  f.x.h.objects.set(r.url.url, f.x.bytes);
  await f.svc.finalize(f.x.token, f.x.sale.purchaseId, r.id, op);
  await db.pool.query("UPDATE auth_user SET enabled=false WHERE id=$1", [
    fixtureId(2),
  ]);
  await expect(
    f.svc.finalize(f.x.token, f.x.sale.purchaseId, r.id, op),
  ).rejects.toMatchObject({ code: "unauthenticated" });
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM held_release_sheet_validation",
      )
    ).rows[0].n,
  ).toBe(1);
});

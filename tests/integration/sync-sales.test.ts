import { readFile } from "node:fs/promises";
import pg from "pg";
import sharp from "sharp";
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../../src/server/lib/ids";
import {
  createStorage,
  type EvidenceStorage,
} from "../../src/server/adapters/storage";
import { createSyncService } from "../../src/server/modules/sync/service";
import {
  syncFixture,
  newSession,
  changePrice,
  campaign,
  fixtureId,
  sha256,
} from "../helpers/sync-fixture";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 15,
});
const endpoint =
  process.env.WHR_TEST_STORAGE_ENDPOINT ?? "http://127.0.0.1:9000";
const bucket = `sync-${newId()}`;
const storageConfig = {
  endpoint,
  region: "us-east-1",
  bucket,
  accessKeyId: "whr-local",
  secretAccessKey: "local-development-only",
  forcePathStyle: true,
};
const s3 = new S3Client({
  endpoint,
  region: storageConfig.region,
  credentials: {
    accessKeyId: storageConfig.accessKeyId,
    secretAccessKey: storageConfig.secretAccessKey,
  },
  forcePathStyle: true,
});
const storage = createStorage(storageConfig);
const service = createSyncService({ pool, storage });
let jpeg: Buffer;
async function put(
  url: string,
  headers: Record<string, string>,
  bytes: Buffer,
) {
  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: new Uint8Array(bytes),
  });
  expect(response.status).toBe(200);
}
async function prepared(
  f: Awaited<ReturnType<typeof syncFixture>>,
  svc = service,
) {
  const submitted = await svc.submit(f.token, f.original);
  const request = { operationId: newId(), ...f.original.photo };
  const upload = await svc.uploadPermission(
    f.token,
    submitted.status.purchaseId,
    request,
  );
  await put(upload.url, upload.headers, jpeg);
  return {
    submitted,
    upload,
    request,
    finalize: {
      operationId: newId(),
      uploadId: upload.uploadId,
      expectedVersion: submitted.status.version,
    },
  };
}
async function creditCount(purchaseId: string) {
  const result = await pool.query(
    "SELECT count(*)::int AS count FROM purchase_revision WHERE purchase_id=$1 AND state='accepted'",
    [purchaseId],
  );
  return result.rows[0].count;
}
describe("M1 real PostgreSQL and MinIO sync", () => {
  beforeAll(async () => {
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#ffffff" },
    })
      .jpeg()
      .toBuffer();
  }, 30000);
  afterAll(async () => {
    s3.destroy();
    await pool.end();
  });
  it("I-17/I-50 code and QR lookup return the same minimal customer without phone data", async () => {
    const f = await syncFixture(pool, jpeg);
    const code = await service.lookup(f.token, {
      source: "code",
      code: " a7k3m9q ",
    });
    const qr = await service.lookup(f.token, { source: "qr", qr: "A7K3M9Q" });
    expect(code.customer).toEqual(qr.customer);
    expect(code.cardCode).toBe("A7K3M9Q");
    expect(Object.keys(code.customer).sort()).toEqual([
      "category",
      "id",
      "name",
    ]);
    await expect(
      service.lookup(f.token, {
        source: "qr",
        qr: "https://example.com/A7K3M9Q",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("I-22/I-28 lost-response retry preserves first receipt and credits exactly once", async () => {
    const f = await syncFixture(pool, jpeg);
    const p = await prepared(f);
    const replay = await service.submit(f.token, {
      ...f.original,
      entry: { ...f.original.entry, quantity: "20.00" },
    });
    expect(replay.created).toBe(false);
    expect(replay.status.purchaseId).toBe(p.submitted.status.purchaseId);
    expect(replay.status.serverReceivedAt).toBe(
      p.submitted.status.serverReceivedAt,
    );
    const first = await service.finalize(
      f.token,
      replay.status.purchaseId,
      p.finalize,
    );
    const afterLostResponse = await service.status(
      f.token,
      f.original.operationId,
    );
    const retry = await service.finalize(
      f.token,
      replay.status.purchaseId,
      p.finalize,
    );
    expect(first.state).toBe("credited");
    expect(retry).toEqual(afterLostResponse);
    expect(retry.currentRevisionId).toBe(first.currentRevisionId);
    expect(await creditCount(first.purchaseId)).toBe(1);
    const audits = await pool.query(
      "SELECT count(*)::int AS count FROM audit_event WHERE target_id=$1 AND action LIKE '%credit%'",
      [first.purchaseId],
    );
    expect(audits.rows[0].count).toBe(1);
  });
  it("I-22 changed original content under one operation conflicts without replacing history", async () => {
    const f = await syncFixture(pool, jpeg);
    await service.submit(f.token, f.original);
    await expect(
      service.submit(f.token, { ...f.original, medium: "keg" }),
    ).rejects.toMatchObject({ code: "operation_conflict", status: 409 });
    const row = (
      await pool.query("SELECT medium FROM purchase WHERE operation_id=$1", [
        f.original.operationId,
      ])
    ).rows[0];
    expect(row.medium).toBe("vehicle");
  });
  it("I-22/I-26 concurrent finalize produces one accepted revision and one credit", async () => {
    const f = await syncFixture(pool, jpeg);
    const p = await prepared(f);
    const outcomes = await Promise.all([
      service.finalize(f.token, p.submitted.status.purchaseId, p.finalize),
      service.finalize(f.token, p.submitted.status.purchaseId, p.finalize),
    ]);
    expect(
      outcomes.every((x) => ["credited", "finalizing"].includes(x.state)),
    ).toBe(true);
    const final = await service.finalize(
      f.token,
      p.submitted.status.purchaseId,
      p.finalize,
    );
    expect(final.state).toBe("credited");
    expect(await creditCount(final.purchaseId)).toBe(1);
  });
  it("I-25 adversarial evidence: reusing presigned staging PUT cannot rewrite accepted bytes, digest or revision", async () => {
    const f = await syncFixture(pool, jpeg);
    const p = await prepared(f);
    const accepted = await service.finalize(
      f.token,
      p.submitted.status.purchaseId,
      p.finalize,
    );
    const asset = (
      await pool.query(
        "SELECT final_key,validated_digest FROM photo_asset WHERE id=$1",
        [p.upload.uploadId],
      )
    ).rows[0];
    const before = await storage.read(asset.final_key, 8 * 1024 * 1024);
    const replacement = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#000000" },
    })
      .jpeg()
      .toBuffer();
    await put(p.upload.url, p.upload.headers, replacement);
    expect(await storage.read(asset.final_key, 8 * 1024 * 1024)).toEqual(
      before,
    );
    expect(sha256(before)).toBe(f.original.photo.sha256);
    const replay = await service.finalize(
      f.token,
      accepted.purchaseId,
      p.finalize,
    );
    expect(replay.currentRevisionId).toBe(accepted.currentRevisionId);
    expect(await creditCount(accepted.purchaseId)).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT validated_digest FROM photo_asset WHERE id=$1",
          [p.upload.uploadId],
        )
      ).rows[0].validated_digest,
    ).toBe(asset.validated_digest);
  });
  it("I-06 foreign accounts cannot read, upload or finalize another account operation", async () => {
    const f = await syncFixture(pool, jpeg),
      other = await syncFixture(pool, jpeg);
    const p = await prepared(f);
    await expect(
      service.status(other.token, f.original.operationId),
    ).rejects.toMatchObject({ code: "sale_not_found", status: 404 });
    await expect(
      service.uploadPermission(
        other.token,
        p.submitted.status.purchaseId,
        p.request,
      ),
    ).rejects.toMatchObject({ code: "sale_not_found", status: 404 });
    await expect(
      service.finalize(other.token, p.submitted.status.purchaseId, p.finalize),
    ).rejects.toMatchObject({ code: "sale_not_found", status: 404 });
  });
  it("I-09 revocation during slow storage prevents credit at commit boundary", async () => {
    const f = await syncFixture(pool, jpeg);
    const p = await prepared(f);
    const delayed: EvidenceStorage = {
      ...storage,
      signPut: storage.signPut.bind(storage),
      read: storage.read.bind(storage),
      writeFinal: async (key, bytes) => {
        await storage.writeFinal(key, bytes);
        await pool.query(
          "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1",
          [f.sessionId],
        );
      },
    };
    const svc = createSyncService({ pool, storage: delayed });
    await expect(
      svc.finalize(f.token, p.submitted.status.purchaseId, p.finalize),
    ).rejects.toMatchObject({ code: "unauthenticated", status: 401 });
    expect(await creditCount(p.submitted.status.purchaseId)).toBe(0);
  });
  it("I-03 at 24 hours uploads pause while a live session can read status", async () => {
    const f = await syncFixture(pool, jpeg);
    const p = await prepared(f);
    const expired = await newSession(pool, f, new Date(Date.now() - 86400000));
    expect(
      (await service.status(expired.token, f.original.operationId)).purchaseId,
    ).toBe(p.submitted.status.purchaseId);
    await expect(
      service.submit(expired.token, { ...f.original, operationId: newId() }),
    ).rejects.toMatchObject({ code: "online_sign_in_required", status: 403 });
    await expect(
      service.uploadPermission(
        expired.token,
        p.submitted.status.purchaseId,
        p.request,
      ),
    ).rejects.toMatchObject({ code: "online_sign_in_required", status: 403 });
    await expect(
      service.finalize(
        expired.token,
        p.submitted.status.purchaseId,
        p.finalize,
      ),
    ).rejects.toMatchObject({ code: "online_sign_in_required", status: 403 });
  });
  it("P-18/I-31 uniform history credits with a wrong phone clock and precision-only changes", async () => {
    const f = await syncFixture(pool, jpeg);
    await changePrice(pool, f, "100000", 3);
    f.original.appCapturedAt = "2001-01-01T00:00:00.000Z";
    const p = await prepared(f);
    expect(
      (
        await service.finalize(
          f.token,
          p.submitted.status.purchaseId,
          p.finalize,
        )
      ).state,
    ).toBe("credited");
  });
  it("P-18/I-31 a price boundary holds zero credit and retry cannot clear it", async () => {
    const f = await syncFixture(pool, jpeg);
    await changePrice(pool, f);
    const p = await prepared(f);
    const held = await service.finalize(
      f.token,
      p.submitted.status.purchaseId,
      p.finalize,
    );
    expect(held.state).toBe("held");
    expect(held.holds).toContainEqual({
      kind: "price",
      reasonCode: "price_uncertain",
    });
    expect(
      (await service.finalize(f.token, held.purchaseId, p.finalize)).credited,
    ).toBe(false);
    expect(await creditCount(held.purchaseId)).toBe(0);
  });
  it("P-18 reauthentication does not replace capturing lower bound or first receipt", async () => {
    const f = await syncFixture(pool, jpeg);
    await changePrice(pool, f);
    const fresh = await newSession(pool, f);
    const old = f.token;
    f.token = fresh.token;
    const p = await prepared(f);
    const held = await service.finalize(
      f.token,
      p.submitted.status.purchaseId,
      p.finalize,
    );
    expect(held.holds).toContainEqual({
      kind: "price",
      reasonCode: "price_uncertain",
    });
    expect(
      (await service.status(old, f.original.operationId)).serverReceivedAt,
    ).toBe(p.submitted.status.serverReceivedAt);
  });
  it("P-18 returns simultaneous price, assignment and campaign conditions at zero credit", async () => {
    const f = await syncFixture(pool, jpeg);
    await changePrice(pool, f);
    await campaign(pool, f, true);
    await pool.query("UPDATE assignment SET effective_until=$2 WHERE id=$1", [
      f.assignmentId,
      new Date(f.start.getTime() + 2000),
    ]);
    const p = await prepared(f);
    const held = await service.finalize(
      f.token,
      p.submitted.status.purchaseId,
      p.finalize,
    );
    expect(held.state).toBe("held");
    expect(held.credited).toBe(false);
    expect(held.holds.map((h) => h.reasonCode)).toEqual(
      expect.arrayContaining([
        "price_uncertain",
        "capture_authorization_unresolved",
        "capture_time_unresolved",
      ]),
    );
    expect(await creditCount(held.purchaseId)).toBe(0);
  });
  it("I-25 missing upload or digest mismatch cannot credit", async () => {
    const f = await syncFixture(pool, jpeg);
    const submitted = await service.submit(f.token, f.original);
    const upload = await service.uploadPermission(
      f.token,
      submitted.status.purchaseId,
      { operationId: newId(), ...f.original.photo },
    );
    const request = {
      operationId: newId(),
      uploadId: upload.uploadId,
      expectedVersion: submitted.status.version,
    };
    await expect(
      service.finalize(f.token, submitted.status.purchaseId, request),
    ).rejects.toMatchObject({ code: "storage_unavailable", status: 503 });
    await put(upload.url, upload.headers, Buffer.from("wrong"));
    await expect(
      service.finalize(f.token, submitted.status.purchaseId, request),
    ).rejects.toMatchObject({ code: "photo_invalid", status: 422 });
    expect(await creditCount(submitted.status.purchaseId)).toBe(0);
  });
  it("I-25 undecodable immutable JPEG is rejected without acceptance", async () => {
    const bytes = Buffer.from("not a JPEG");
    const f = await syncFixture(pool, bytes);
    const submitted = await service.submit(f.token, f.original);
    const upload = await service.uploadPermission(
      f.token,
      submitted.status.purchaseId,
      { operationId: newId(), ...f.original.photo },
    );
    await put(upload.url, upload.headers, bytes);
    await expect(
      service.finalize(f.token, submitted.status.purchaseId, {
        operationId: newId(),
        uploadId: upload.uploadId,
        expectedVersion: submitted.status.version,
      }),
    ).rejects.toMatchObject({ code: "photo_invalid", status: 422 });
    expect(await creditCount(submitted.status.purchaseId)).toBe(0);
  });
  it("I-27 definitive unknown card cancellation remains durable and noncrediting", async () => {
    const f = await syncFixture(pool, jpeg);
    f.original.cardCode = "ZZZZZZZ";
    const first = await service.submit(f.token, f.original);
    expect(first.status.state).toBe("cancelled");
    expect(first.status.cancellationReason).toBe("customer_not_found");
    expect((await service.submit(f.token, f.original)).status).toEqual(
      first.status,
    );
  });
  it("I-25 same upload key replays permission and changed metadata conflicts", async () => {
    const f = await syncFixture(pool, jpeg);
    const p = await prepared(f);
    expect(
      await service.uploadPermission(
        f.token,
        p.submitted.status.purchaseId,
        p.request,
      ),
    ).toEqual(p.upload);
    await expect(
      service.uploadPermission(f.token, p.submitted.status.purchaseId, {
        ...p.request,
        sha256: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "operation_conflict", status: 409 });
  });
  it("I-26 failed final-object storage is safely retryable without an accepted revision", async () => {
    const f = await syncFixture(pool, jpeg);
    const p = await prepared(f);
    const broken: EvidenceStorage = {
      signPut: storage.signPut.bind(storage),
      read: storage.read.bind(storage),
      writeFinal: async () => {
        throw new Error("fixture transport outage");
      },
    };
    await expect(
      createSyncService({ pool, storage: broken }).finalize(
        f.token,
        p.submitted.status.purchaseId,
        p.finalize,
      ),
    ).rejects.toMatchObject({ code: "storage_unavailable", status: 503 });
    expect(await creditCount(p.submitted.status.purchaseId)).toBe(0);
    expect(
      (
        await service.finalize(
          f.token,
          p.submitted.status.purchaseId,
          p.finalize,
        )
      ).state,
    ).toBe("credited");
  });
  it("I-25 decoded dimensions over 6000 pixels are rejected even for a small JPEG", async () => {
    const bytes = await sharp({
      create: { width: 6001, height: 1, channels: 3, background: "#ffffff" },
    })
      .jpeg()
      .toBuffer();
    const f = await syncFixture(pool, bytes);
    const submitted = await service.submit(f.token, f.original);
    const upload = await service.uploadPermission(
      f.token,
      submitted.status.purchaseId,
      { operationId: newId(), ...f.original.photo },
    );
    await put(upload.url, upload.headers, bytes);
    await expect(
      service.finalize(f.token, submitted.status.purchaseId, {
        operationId: newId(),
        uploadId: upload.uploadId,
        expectedVersion: submitted.status.version,
      }),
    ).rejects.toMatchObject({ code: "photo_invalid", status: 422 });
    expect(await creditCount(submitted.status.purchaseId)).toBe(0);
  });
  it("I-22 changed finalize body conflicts even after the first request credited", async () => {
    const f = await syncFixture(pool, jpeg),
      p = await prepared(f);
    const accepted = await service.finalize(
      f.token,
      p.submitted.status.purchaseId,
      p.finalize,
    );
    await expect(
      service.finalize(f.token, accepted.purchaseId, {
        ...p.finalize,
        expectedVersion: p.finalize.expectedVersion + 1,
      }),
    ).rejects.toMatchObject({ code: "operation_conflict", status: 409 });
    expect(await creditCount(accepted.purchaseId)).toBe(1);
  });
  it("I-26 a stale finalize version does not validate evidence or credit", async () => {
    const f = await syncFixture(pool, jpeg),
      p = await prepared(f);
    await expect(
      service.finalize(f.token, p.submitted.status.purchaseId, {
        ...p.finalize,
        expectedVersion: p.finalize.expectedVersion + 1,
      }),
    ).rejects.toMatchObject({ code: "stale_version", status: 409 });
    expect(await creditCount(p.submitted.status.purchaseId)).toBe(0);
    expect(
      (await service.status(f.token, f.original.operationId)).photoValidated,
    ).toBe(false);
  });
});

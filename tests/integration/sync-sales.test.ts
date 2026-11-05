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
import { handleSync } from "../../src/server/modules/sync/http";
import { COOKIE } from "../../src/server/modules/auth/http";
import {
  syncFixture,
  newSession,
  changePrice,
  campaign,
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
async function exactReceipt<T>(
  stationId: string,
  receivedAt: string,
  run: () => Promise<T>,
): Promise<T> {
  const name = `sync_test_receipt_${newId().replaceAll("-", "")}`;
  await pool.query(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.station_id::text=TG_ARGV[0] THEN NEW.server_received_at=TG_ARGV[1]::timestamptz; END IF; RETURN NEW; END $$`,
  );
  try {
    await pool.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON purchase FOR EACH ROW EXECUTE FUNCTION ${name}('${stationId}','${receivedAt}')`,
    );
    return await run();
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS ${name} ON purchase`);
    await pool.query(`DROP FUNCTION ${name}()`);
  }
}
async function exactCaptureContext(
  f: Awaited<ReturnType<typeof syncFixture>>,
  signedInAt: string,
  assignmentId = f.assignmentId,
) {
  const contextId = newId();
  await pool.query(
    "INSERT INTO capture_context(id,attendant_id,assignment_id,signed_in_at,offline_expires_at,seller_name,seller_username,device_binding_digest) SELECT $1,attendant_id,$4,$2::timestamptz,$2::timestamptz+interval '24 hours',seller_name,seller_username,device_binding_digest FROM capture_context WHERE id=$3",
    [contextId, signedInAt, f.contextId, assignmentId],
  );
  f.original.captureContextId = contextId;
  f.original.assignmentId = assignmentId;
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
    const replacement = Buffer.from(jpeg);
    replacement[replacement.length - 1] =
      replacement[replacement.length - 1]! ^ 1;
    expect(replacement.length).toBe(jpeg.length);
    expect(sha256(replacement)).not.toBe(sha256(jpeg));
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
    expect(held.holds).toContainEqual({
      kind: "price",
      reasonCode: "price_uncertain",
    });
    expect(held.pendingReason).toBe("policy_review_required");
    const validation = (
      await pool.query(
        "SELECT reasons FROM sync_validation WHERE purchase_id=$1",
        [held.purchaseId],
      )
    ).rows[0];
    expect(validation.reasons).toEqual(
      expect.arrayContaining([
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
    await put(upload.url, upload.headers, Buffer.alloc(jpeg.length, 0));
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
  it("I-25 expired upload permission requires a new operation and a new staging key", async () => {
    const f = await syncFixture(pool, jpeg),
      submitted = await service.submit(f.token, f.original);
    const operationId = newId(),
      oldKey = `staging/${newId()}/${newId()}`;
    await pool.query(
      "INSERT INTO photo_asset(id,purchase_id,upload_operation_id,state,staging_key,staging_expires_at,expected_digest,expected_bytes) VALUES($1,$2,$3,'staged',$4,clock_timestamp()-interval '1 second',$5,$6)",
      [
        newId(),
        submitted.status.purchaseId,
        operationId,
        oldKey,
        f.original.photo.sha256,
        jpeg.length,
      ],
    );
    await expect(
      service.uploadPermission(f.token, submitted.status.purchaseId, {
        operationId,
        ...f.original.photo,
      }),
    ).rejects.toMatchObject({ code: "upload_permission_expired", status: 409 });
    const next = await service.uploadPermission(
      f.token,
      submitted.status.purchaseId,
      { operationId: newId(), ...f.original.photo },
    );
    expect(new URL(next.url).pathname).not.toContain(oldKey);
    await put(next.url, next.headers, jpeg);
    expect(
      (
        await service.finalize(f.token, submitted.status.purchaseId, {
          operationId: newId(),
          uploadId: next.uploadId,
          expectedVersion: submitted.status.version,
        })
      ).state,
    ).toBe("credited");
  });
  it("I-27/I-28 transient lookup failure preserves the first durable receipt for retry", async () => {
    const f = await syncFixture(pool, jpeg);
    let fail = true;
    const failingPool = new Proxy(pool, {
      get(target, key) {
        if (key === "connect")
          return async () => {
            const client = await target.connect();
            return new Proxy(client, {
              get(db, member) {
                if (member === "query")
                  return (...args: unknown[]) => {
                    if (
                      fail &&
                      typeof args[0] === "string" &&
                      args[0].includes("SELECT c.id AS card_id")
                    ) {
                      fail = false;
                      throw new Error("Fictional transient lookup outage");
                    }
                    return Reflect.apply(db.query, db, args);
                  };
                const value = Reflect.get(db, member);
                return typeof value === "function" ? value.bind(db) : value;
              },
            });
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(
      createSyncService({ pool: failingPool, storage }).submit(
        f.token,
        f.original,
      ),
    ).rejects.toThrow("Fictional transient lookup outage");
    const pending = await service.status(f.token, f.original.operationId);
    expect(pending.state).toBe("received");
    expect(pending.pendingReason).toBe("lookup_pending");
    expect(pending.credited).toBe(false);
    const retry = await service.submit(f.token, f.original);
    expect(retry.created).toBe(false);
    expect(retry.status.serverReceivedAt).toBe(pending.serverReceivedAt);
    expect(retry.status.state).toBe("photo_pending");
  });
  it("I-25 MinIO presigned PUT answers browser Content-Type CORS preflight", async () => {
    const f = await syncFixture(pool, jpeg),
      p = await prepared(f);
    const response = await fetch(p.upload.url, {
      method: "OPTIONS",
      headers: {
        Origin: "https://station.example.test",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://station.example.test",
    );
    expect(response.headers.get("access-control-allow-methods")).toContain(
      "PUT",
    );
    expect(
      response.headers.get("access-control-allow-headers")?.toLowerCase(),
    ).toContain("content-type");
  });
  it("HTTP sync validates Origin, strict body, status envelope, no-store and duplicate response status", async () => {
    process.env.BETTER_AUTH_SECRET =
      "fictional-sync-http-secret-at-least-32-characters";
    process.env.BETTER_AUTH_URL = "https://station.example.test";
    const f = await syncFixture(pool, jpeg);
    const request = (body: unknown, origin = "https://station.example.test") =>
      new Request("https://station.example.test/api/sync/sales", {
        method: "POST",
        headers: {
          Origin: origin,
          "content-type": "application/json",
          cookie: `${COOKIE}=${f.token}`,
        },
        body: JSON.stringify(body),
      });
    const rejected = await handleSync(
      request(f.original, "https://foreign.example.test"),
      "submit",
    );
    expect(rejected.status).toBe(403);
    expect((await rejected.json()).error.code).toBe("origin_rejected");
    const extra = await handleSync(
      request({ ...f.original, attendantId: f.attendantId }),
      "submit",
    );
    expect(extra.status).toBe(400);
    const response = await handleSync(request(f.original), "submit");
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(body.data.credited).toBe(false);
    expect(body.serverTime).toMatch(/Z$/);
    expect(JSON.stringify(body)).not.toContain(f.token);
    expect((await handleSync(request(f.original), "submit")).status).toBe(200);
    const status = await handleSync(
      new Request(
        `https://station.example.test/api/sync/sales/by-operation/${f.original.operationId}`,
        { headers: { cookie: `${COOKIE}=${f.token}` } },
      ),
      "status",
      f.original.operationId,
    );
    expect(status.status).toBe(200);
    expect((await status.json()).data.purchaseId).toBe(body.data.purchaseId);
    process.env.STORAGE_ENDPOINT = endpoint;
    process.env.STORAGE_REGION = storageConfig.region;
    process.env.STORAGE_BUCKET = bucket;
    process.env.STORAGE_ACCESS_KEY_ID = storageConfig.accessKeyId;
    process.env.STORAGE_SECRET_ACCESS_KEY = storageConfig.secretAccessKey;
    const permissionResponse = await handleSync(
      request({ operationId: newId(), ...f.original.photo }),
      "upload-permission",
      body.data.purchaseId,
    );
    expect(permissionResponse.status).toBe(200);
    const permission = (await permissionResponse.json()).data;
    await put(permission.url, permission.headers, jpeg);
    const finalizeBody = {
      operationId: newId(),
      uploadId: permission.uploadId,
      expectedVersion: body.data.version,
    };
    const finalizeResponse = await handleSync(
      request(finalizeBody),
      "finalize",
      body.data.purchaseId,
    );
    expect(finalizeResponse.status).toBe(200);
    expect((await finalizeResponse.json()).data.state).toBe("credited");
    expect(
      (
        await handleSync(
          request(finalizeBody),
          "finalize",
          body.data.purchaseId,
        )
      ).status,
    ).toBe(200);
    expect(await creditCount(body.data.purchaseId)).toBe(1);
  });
  it("I-22 changed arithmetic under an existing operation conflicts before new-sale calculation validation", async () => {
    const f = await syncFixture(pool, jpeg);
    await service.submit(f.token, f.original);
    await expect(
      service.submit(f.token, {
        ...f.original,
        entry: { ...f.original.entry, quantity: "21" },
      }),
    ).rejects.toMatchObject({ code: "operation_conflict", status: 409 });
    await expect(
      service.submit(f.token, {
        ...f.original,
        operationId: newId(),
        entry: { ...f.original.entry, quantity: "21" },
      }),
    ).rejects.toMatchObject({ code: "calculation_invalid", status: 422 });
  });
  it("I-29 fabricated captured precision cannot borrow a genuine price-version ID", async () => {
    const f = await syncFixture(pool, jpeg);
    await expect(
      service.submit(f.token, { ...f.original, quantityPrecision: 3 }),
    ).rejects.toMatchObject({ code: "calculation_invalid", status: 422 });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM purchase WHERE operation_id=$1",
          [f.original.operationId],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("I-25 signed PUT rejects wrong byte lengths before storage and requires no manual Content-Length header", async () => {
    const f = await syncFixture(pool, jpeg),
      p = await prepared(f);
    expect(
      Object.keys(p.upload.headers).map((x) => x.toLowerCase()),
    ).not.toContain("content-length");
    const oversized = await fetch(p.upload.url, {
      method: "PUT",
      headers: p.upload.headers,
      body: new Uint8Array(8 * 1024 * 1024 + 1),
    });
    expect(oversized.status).toBe(403);
    const wrongSize = await fetch(p.upload.url, {
      method: "PUT",
      headers: p.upload.headers,
      body: new Uint8Array(jpeg.length + 1),
    });
    expect(wrongSize.status).toBe(403);
    expect(
      new URL(p.upload.url).searchParams.get("X-Amz-SignedHeaders"),
    ).toContain("content-length");
    // Fetch computes Content-Length from the body; browsers forbid setting it manually.
    await put(p.upload.url, p.upload.headers, jpeg);
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
  it("I-22 finalize operation IDs are scoped per purchase for one originating account", async () => {
    const f = await syncFixture(pool, jpeg),
      first = await prepared(f);
    const second = await prepared({
      ...f,
      original: { ...f.original, operationId: newId() },
    });
    const operationId = newId();
    const request1 = { ...first.finalize, operationId },
      request2 = { ...second.finalize, operationId };
    const one = await service.finalize(
      f.token,
      first.submitted.status.purchaseId,
      request1,
    );
    const two = await service.finalize(
      f.token,
      second.submitted.status.purchaseId,
      request2,
    );
    expect(one.state).toBe("credited");
    expect(two.state).toBe("credited");
    expect(two.currentRevisionId).not.toBe(one.currentRevisionId);
    expect(
      (await service.finalize(f.token, one.purchaseId, request1))
        .currentRevisionId,
    ).toBe(one.currentRevisionId);
    expect(
      (await service.finalize(f.token, two.purchaseId, request2))
        .currentRevisionId,
    ).toBe(two.currentRevisionId);
    expect(await creditCount(one.purchaseId)).toBe(1);
    expect(await creditCount(two.purchaseId)).toBe(1);
  });
  it("I-29 a fabricated captured rate with valid arithmetic returns a bounded calculation error", async () => {
    const f = await syncFixture(pool, jpeg);
    await expect(
      service.submit(f.token, {
        ...f.original,
        rateKobo: "110000",
        entry: {
          basis: "amount",
          enteredAmountKobo: "2200000",
          amountKobo: "2200000",
          quantity: "20",
        },
      }),
    ).rejects.toMatchObject({ code: "calculation_invalid", status: 422 });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int AS count FROM purchase WHERE operation_id=$1",
          [f.original.operationId],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("P-18 PostgreSQL microsecond price activation before durable receipt holds zero credit", async () => {
    const f = await syncFixture(pool, jpeg);
    const second = new Date(Date.now() - 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "");
    const receipt = `${second}.123900Z`,
      activation = `${second}.123100Z`;
    await pool.query(
      "INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason) VALUES($1,$2,$3,2,110000,'NGN',2,$4,$5,'Fictional submillisecond activation')",
      [
        newId(),
        f.stationId,
        "019a5000-0000-7000-8000-000000000009",
        activation,
        "019a5000-0000-7000-8000-000000000005",
      ],
    );
    const p = await exactReceipt(f.stationId, receipt, () => prepared(f));
    const final = await service.finalize(
      f.token,
      p.submitted.status.purchaseId,
      p.finalize,
    );
    expect(final.state).toBe("held");
    expect(final.holds).toContainEqual({
      kind: "price",
      reasonCode: "price_uncertain",
    });
    expect(await creditCount(final.purchaseId)).toBe(0);
  });
  it("P-18 PostgreSQL microsecond campaign cutoff between capturing sign-in and receipt holds zero credit", async () => {
    const f = await syncFixture(pool, jpeg);
    const second = new Date(Date.now() - 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "");
    const signedIn = `${second}.123100Z`,
      receipt = `${second}.123900Z`,
      cutoff = `${second}.123500Z`;
    await exactCaptureContext(f, signedIn);
    const campaignId = newId();
    await pool.query(
      "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional precision campaign',1,false)",
      [campaignId, f.stationId],
    );
    await pool.query(
      "INSERT INTO settings_version(id,station_id,campaign_id,version,purchase_start,purchase_cutoff,upload_deadline,timezone,effective_from,actor_id,reason) VALUES($1,$2,$3,1,$4,$5,$6,'Africa/Lagos',$4,$7,'Fictional precise cutoff')",
      [
        newId(),
        f.stationId,
        campaignId,
        f.start,
        cutoff,
        new Date(Date.now() + 60000),
        "019a5000-0000-7000-8000-000000000005",
      ],
    );
    const p = await exactReceipt(f.stationId, receipt, () => prepared(f));
    const final = await service.finalize(
      f.token,
      p.submitted.status.purchaseId,
      p.finalize,
    );
    expect(final.state).toBe("held");
    expect(final.pendingReason).toBe("policy_review_required");
    expect(
      (
        await pool.query(
          "SELECT reasons FROM sync_validation WHERE purchase_id=$1",
          [final.purchaseId],
        )
      ).rows[0].reasons,
    ).toContain("capture_time_unresolved");
    expect(await creditCount(final.purchaseId)).toBe(0);
  });
  it("P-18 PostgreSQL microsecond assignment start after capturing sign-in remains unresolved", async () => {
    const f = await syncFixture(pool, jpeg);
    const second = new Date(Date.now() - 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, "");
    const signedIn = `${second}.123100Z`,
      receipt = `${second}.123900Z`,
      activation = `${second}.123500Z`;
    await pool.query("UPDATE assignment SET effective_until=$2 WHERE id=$1", [
      f.assignmentId,
      signedIn,
    ]);
    const next = newId();
    await pool.query(
      "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,2,$4,$5,'Fictional precise reassignment')",
      [
        next,
        f.attendantId,
        f.pumpId,
        activation,
        "019a5000-0000-7000-8000-000000000005",
      ],
    );
    await exactCaptureContext(f, signedIn, next);
    const p = await exactReceipt(f.stationId, receipt, () => prepared(f));
    const final = await service.finalize(
      f.token,
      p.submitted.status.purchaseId,
      p.finalize,
    );
    expect(final.state).toBe("held");
    expect(
      (
        await pool.query(
          "SELECT reasons FROM sync_validation WHERE purchase_id=$1",
          [final.purchaseId],
        )
      ).rows[0].reasons,
    ).toContain("capture_authorization_unresolved");
    expect(await creditCount(final.purchaseId)).toBe(0);
  });
});

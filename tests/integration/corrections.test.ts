import { readFile } from "node:fs/promises";
import pg from "pg";
import sharp from "sharp";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { newId } from "../../src/server/lib/ids";
import type { EvidenceStorage } from "../../src/server/adapters/storage";
import { createSyncService } from "../../src/server/modules/sync/service";
import { createCorrectionsService } from "../../src/server/modules/corrections/service";
import { syncFixture } from "../helpers/sync-fixture";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});
const objects = new Map<string, Buffer>();
const storage: EvidenceStorage = {
  async signPut(key) {
    return { url: key, headers: {} };
  },
  async read(key) {
    const b = objects.get(key);
    if (!b) throw new Error("missing");
    return b;
  },
  async writeFinal(key, bytes) {
    objects.set(key, bytes);
  },
};
const sync = createSyncService({ pool, storage }),
  svc = createCorrectionsService({ pool, storage });
let jpeg: Buffer;
async function fixture() {
  const f = await syncFixture(pool, jpeg);
  const s = await sync.submit(f.token, f.original);
  const u = await sync.uploadPermission(f.token, s.status.purchaseId, {
    operationId: newId(),
    ...f.original.photo,
  });
  const a = (
    await pool.query("SELECT staging_key FROM photo_asset WHERE id=$1", [
      u.uploadId,
    ])
  ).rows[0];
  objects.set(a.staging_key, jpeg);
  const done = await sync.finalize(f.token, s.status.purchaseId, {
    operationId: newId(),
    expectedVersion: s.status.version,
    uploadId: u.uploadId,
  });
  return {
    ...f,
    purchaseId: done.purchaseId,
    body: {
      operationId: newId(),
      expectedVersion: done.version,
      basedOnRevisionId: done.currentRevisionId!,
      edit: { basis: "amount" as const, enteredAmountKobo: "3000000" },
      evidenceAssetId: u.uploadId,
      reason: "Corrected meter amount",
    },
  };
}
async function pending(id: string) {
  return (
    await pool.query("SELECT * FROM correction_request WHERE id=$1", [id])
  ).rows[0];
}
async function drain() {
  for (let i = 0; i < 25 && (await svc.processNext()); i++);
}
describe("M3 durable own correction processing", () => {
  beforeAll(async () => {
    await pool.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#ffffff" },
    })
      .jpeg()
      .toBuffer();
  });
  afterAll(() => pool.end());
  it("reserves receipt and base, then replaces one accepted contribution without rewriting original", async () => {
    const f = await fixture();
    const result = await svc.submit(f.token, f.purchaseId, f.body);
    expect(result.data.state).toBe("pending_validation");
    await drain();
    const c = await svc.byOperation(f.token, f.purchaseId, f.body.operationId);
    expect(c.state).toBe("accepted");
    expect(c.serverReceivedAt).toBe(result.data.serverReceivedAt);
    const p = (
      await pool.query(
        "SELECT p.amount_kobo::text AS original,r.amount_kobo::text AS effective,(SELECT count(*)::int FROM purchase_revision WHERE purchase_id=p.id AND state='accepted') AS count FROM purchase p JOIN purchase_revision r ON r.id=p.current_revision_id WHERE p.id=$1",
        [f.purchaseId],
      )
    ).rows[0];
    expect(p).toEqual({ original: "2000000", effective: "3000000", count: 1 });
    expect((await svc.submit(f.token, f.purchaseId, f.body)).data).toEqual(
      result.data,
    );
  });
  it("same operation changed material content conflicts before stale version; another pending edit cannot replace it", async () => {
    const f = await fixture();
    await svc.submit(f.token, f.purchaseId, f.body);
    await expect(
      svc.submit(f.token, f.purchaseId, {
        ...f.body,
        reason: "Different reason",
      }),
    ).rejects.toMatchObject({ code: "operation_conflict" });
    await expect(
      svc.submit(f.token, f.purchaseId, {
        ...f.body,
        operationId: newId(),
        expectedVersion: f.body.expectedVersion + 1,
      }),
    ).rejects.toMatchObject({ code: "correction_pending" });
    await drain();
  });
  it("rejects unsupported basis changes, replacement evidence and fake recovery provenance", async () => {
    const f = await fixture();
    await expect(
      svc.submit(f.token, f.purchaseId, {
        ...f.body,
        edit: { basis: "quantity", enteredQuantity: "30" },
      }),
    ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    await expect(
      svc.submit(f.token, f.purchaseId, {
        ...f.body,
        evidenceAssetId: newId(),
      }),
    ).rejects.toMatchObject({ code: "evidence_unavailable" });
    await expect(
      svc.submit(f.token, f.purchaseId, {
        ...f.body,
        authorship: "authenticated_attendant",
      }),
    ).rejects.toThrow();
  });
  it("unavailable retained bytes preserve receipt and original then terminalize after bounded failures", async () => {
    const f = await fixture();
    const result = await svc.submit(f.token, f.purchaseId, f.body);
    const a = (
      await pool.query("SELECT final_key FROM photo_asset WHERE id=$1", [
        f.body.evidenceAssetId,
      ])
    ).rows[0];
    objects.delete(a.final_key);
    for (let i = 0; i < 5; i++) {
      await pool.query(
        "UPDATE correction_request SET next_attempt_at=clock_timestamp() WHERE id=$1",
        [result.data.id],
      );
      await drain();
    }
    expect(await pending(result.data.id)).toMatchObject({
      state: "rejected",
      validation_error: "evidence_unavailable",
    });
    expect(
      (await svc.byOperation(f.token, f.purchaseId, f.body.operationId))
        .serverReceivedAt,
    ).toBe(result.data.serverReceivedAt);
    expect(
      (
        await pool.query(
          "SELECT amount_kobo::text FROM purchase_revision WHERE id=(SELECT current_revision_id FROM purchase WHERE id=$1)",
          [f.purchaseId],
        )
      ).rows[0].amount_kobo,
    ).toBe("2000000");
  });
  it("rechecks live authority after slow evidence read and does not revive a revoked session", async () => {
    const f = await fixture();
    const result = await svc.submit(f.token, f.purchaseId, f.body);
    const slow = createCorrectionsService({
      pool,
      storage: {
        ...storage,
        async read(key, max) {
          const bytes = await storage.read(key, max);
          await pool.query(
            "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1",
            [f.sessionId],
          );
          return bytes;
        },
      },
    });
    expect(await slow.processNext()).toBe(true);
    expect(await pending(result.data.id)).toMatchObject({
      state: "rejected",
      validation_error: "authority_lost",
      decided_by_user_id: null,
    });
  });
  it("expired exhausted claim is rejected without inventing a reviewer, and cancellation closes pending causally", async () => {
    const f = await fixture();
    const result = await svc.submit(f.token, f.purchaseId, f.body);
    await pool.query(
      "UPDATE correction_request SET attempts=5,lease_token=$2,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [result.data.id, newId()],
    );
    await drain();
    expect(await pending(result.data.id)).toMatchObject({
      state: "rejected",
      validation_error: "validation_exhausted",
      decided_by_user_id: null,
    });
    const g = await fixture();
    const c = await svc.submit(g.token, g.purchaseId, g.body);
    await pool.query(
      "UPDATE purchase SET status='cancelled',cancellation_reason='Fictional cancellation',version=version+1 WHERE id=$1",
      [g.purchaseId],
    );
    expect(await pending(c.data.id)).toMatchObject({
      state: "rejected",
      validation_error: "sale_cancelled",
      decided_by_user_id: null,
    });
  });
});

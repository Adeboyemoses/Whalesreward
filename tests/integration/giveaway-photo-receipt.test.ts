import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { evidenceDatabase } from "../helpers/review-evidence-fixture";
import { reviewFixtureHarness } from "../helpers/review-fixture";
import { newId } from "../../src/server/lib/ids";

let db: Awaited<ReturnType<typeof evidenceDatabase>>;
beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/whr22_test")
    throw new Error("Disposable WHR-22 database required");
  db = await evidenceDatabase();
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("P-30 trusted complete-photo receipt", () => {
  async function pending() {
    const h = reviewFixtureHarness(db.pool),
      bytes = await h.image(),
      f = await h.context(bytes);
    const submitted = await h.sync.submit(f.token, f.original);
    const purchaseId = submitted.status.purchaseId;
    const upload = await h.sync.uploadPermission(f.token, purchaseId, {
      operationId: newId(),
      ...f.original.photo,
    });
    const key = (
      await db.pool.query("SELECT staging_key FROM photo_asset WHERE id=$1", [
        upload.uploadId,
      ])
    ).rows[0].staging_key;
    h.objects.set(key, bytes);
    const body = {
      operationId: newId(),
      expectedVersion: submitted.status.version,
      uploadId: upload.uploadId,
    };
    return { h, bytes, f, purchaseId, upload, key, body };
  }
  it("I-28/P-30 receipt seals exact bytes and preserves original details receipt on replay", async () => {
    const p = await pending();
    const original = (
      await db.pool.query(
        "SELECT server_received_at FROM purchase WHERE id=$1",
        [p.purchaseId],
      )
    ).rows[0];
    await p.h.sync.finalize(p.f.token, p.purchaseId, p.body);
    const before = (
      await db.pool.query(
        "SELECT to_jsonb(f) AS fact FROM photo_receipt_fact f WHERE purchase_id=$1",
        [p.purchaseId],
      )
    ).rows;
    expect(before).toHaveLength(1);
    p.h.objects.set(p.key, await p.h.image("#000000"));
    await p.h.sync.finalize(p.f.token, p.purchaseId, p.body);
    expect(
      (
        await db.pool.query(
          "SELECT to_jsonb(f) AS fact FROM photo_receipt_fact f WHERE purchase_id=$1",
          [p.purchaseId],
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await db.pool.query(
          "SELECT server_received_at FROM purchase WHERE id=$1",
          [p.purchaseId],
        )
      ).rows[0],
    ).toEqual(original);
    const asset = (
      await db.pool.query("SELECT final_key FROM photo_asset WHERE id=$1", [
        p.upload.uploadId,
      ])
    ).rows[0];
    expect(p.h.objects.get(asset.final_key)).toEqual(p.bytes);
  });
  it("P-30 failed seal verification creates neither receipt observation nor final fact", async () => {
    const p = await pending();
    p.h.storage.writeFinal = async (key) => {
      p.h.objects.set(key, Buffer.from("corrupt seal"));
    };
    await expect(
      p.h.sync.finalize(p.f.token, p.purchaseId, p.body),
    ).rejects.toMatchObject({ code: "storage_unavailable" });
    expect(
      (
        await db.pool.query(
          "SELECT * FROM photo_receipt_observation WHERE purchase_id=$1",
          [p.purchaseId],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.pool.query(
          "SELECT * FROM photo_receipt_fact WHERE purchase_id=$1",
          [p.purchaseId],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("P-30 retry after durable observation uses retained sealed bytes despite staging overwrite", async () => {
    const p = await pending();
    const read = p.h.storage.read;
    let finalReads = 0;
    p.h.storage.read = async (key, max) => {
      if (key.startsWith("final/") && ++finalReads === 2)
        throw new Error("simulated crash after durable observation");
      return read(key, max);
    };
    await expect(
      p.h.sync.finalize(p.f.token, p.purchaseId, p.body),
    ).rejects.toThrow();
    const before = (
      await db.pool.query(
        "SELECT id,receipt_at FROM photo_receipt_observation WHERE purchase_id=$1",
        [p.purchaseId],
      )
    ).rows;
    expect(before).toHaveLength(1);
    p.h.storage.read = read;
    p.h.objects.set(p.key, await p.h.image("#000000"));
    await p.h.sync.finalize(p.f.token, p.purchaseId, p.body);
    expect(
      (
        await db.pool.query(
          "SELECT observation_id,receipt_at FROM photo_receipt_fact WHERE purchase_id=$1",
          [p.purchaseId],
        )
      ).rows[0],
    ).toEqual({
      observation_id: before[0].id,
      receipt_at: before[0].receipt_at,
    });
  });
  it("P-30 non-superuser cannot rewrite or truncate trusted receipt history", async () => {
    const p = await pending();
    await p.h.sync.finalize(p.f.token, p.purchaseId, p.body);
    const role = `receipt_${newId().replaceAll("-", "")}`;
    const schema = (await db.pool.query("SELECT current_schema() AS name"))
      .rows[0].name;
    await db.pool.query(
      `CREATE ROLE ${role} NOSUPERUSER NOCREATEDB NOCREATEROLE`,
    );
    const client = await db.pool.connect();
    try {
      await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
      await client.query(
        `GRANT SELECT,UPDATE,DELETE,TRUNCATE ON photo_receipt_fact,photo_receipt_observation TO ${role}`,
      );
      await client.query(`SET ROLE ${role}`);
      for (const table of ["photo_receipt_fact", "photo_receipt_observation"]) {
        await expect(
          client.query(
            `UPDATE ${table} SET receipt_at=clock_timestamp() WHERE purchase_id=$1`,
            [p.purchaseId],
          ),
        ).rejects.toThrow("append-only");
        await expect(
          client.query(`DELETE FROM ${table} WHERE purchase_id=$1`, [
            p.purchaseId,
          ]),
        ).rejects.toThrow("append-only");
      }
      await expect(
        client.query("TRUNCATE photo_receipt_fact,photo_receipt_observation"),
      ).rejects.toThrow("append-only");
    } finally {
      await client.query("RESET ROLE");
      await client.query(`DROP OWNED BY ${role}`);
      await client.query(`DROP ROLE ${role}`);
      client.release();
    }
  });
  it("P-30 concurrent same-byte retries retain one observation and one final fact", async () => {
    const p = await pending();
    const results = await Promise.allSettled([
      p.h.sync.finalize(p.f.token, p.purchaseId, p.body),
      p.h.sync.finalize(p.f.token, p.purchaseId, p.body),
    ]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(
      (
        await db.pool.query(
          "SELECT * FROM photo_receipt_observation WHERE purchase_id=$1",
          [p.purchaseId],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await db.pool.query(
          "SELECT * FROM photo_receipt_fact WHERE purchase_id=$1",
          [p.purchaseId],
        )
      ).rows,
    ).toHaveLength(1);
  });
});

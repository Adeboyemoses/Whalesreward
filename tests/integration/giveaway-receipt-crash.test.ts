import { it, expect } from "vitest";
import { evidenceDatabase } from "../helpers/review-evidence-fixture";
import { reviewFixtureHarness } from "../helpers/review-fixture";
import { newId } from "../../src/server/lib/ids";
import { membership } from "../../src/server/modules/giveaway/membership";
it("P-30 crash before durable observation cannot backdate a retry received after the upload deadline", async () => {
  const db = await evidenceDatabase();
  try {
    const h = reviewFixtureHarness(db.pool),
      bytes = await h.image(),
      f = await h.context(bytes);
    const submitted = await h.sync.submit(f.token, f.original),
      purchaseId = submitted.status.purchaseId;
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
    const request = {
      operationId: newId(),
      expectedVersion: submitted.status.version,
      uploadId: upload.uploadId,
    };
    await db.pool
      .query(`CREATE FUNCTION fictional_receipt_crash() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional crash before durable observation'; END $$;
 CREATE TRIGGER fictional_receipt_crash BEFORE INSERT ON photo_receipt_observation FOR EACH ROW EXECUTE FUNCTION fictional_receipt_crash()`);
    await expect(
      h.sync.finalize(f.token, purchaseId, request),
    ).rejects.toThrow();
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int n FROM photo_receipt_observation WHERE purchase_id=$1",
          [purchaseId],
        )
      ).rows[0].n,
    ).toBe(0);
    const deadline = (
      await db.pool.query(
        "SELECT (extract(epoch FROM clock_timestamp())*1000000)::bigint::text t",
      )
    ).rows[0].t;
    await db.pool.query(
      "DROP TRIGGER fictional_receipt_crash ON photo_receipt_observation",
    );
    await h.sync.finalize(f.token, purchaseId, request);
    const fact = (
      await db.pool.query(
        `SELECT (extract(epoch FROM r.receipt_at)*1000000)::bigint::text photo,(extract(epoch FROM p.server_received_at)*1000000)::bigint::text details,
 (extract(epoch FROM c.signed_in_at)*1000000)::bigint::text lower,(extract(epoch FROM least(c.offline_expires_at,p.server_received_at))*1000000)::bigint::text upper
 FROM photo_receipt_fact r JOIN purchase p ON p.id=r.purchase_id JOIN capture_context c ON c.id=p.capture_context_id WHERE p.id=$1`,
        [purchaseId],
      )
    ).rows[0];
    const invalid = newId();
    await db.pool.query(
      "INSERT INTO photo_receipt_observation(id,station_id,purchase_id,asset_id,declared_digest,observed_digest,observed_bytes,sealed_key,receipt_at) SELECT $1,p.station_id,p.id,a.id,a.expected_digest,$2,a.expected_bytes,$3,clock_timestamp() FROM purchase p JOIN photo_asset a ON a.purchase_id=p.id WHERE a.id=$4",
      [
        invalid,
        "0".repeat(64),
        `fictional/invalid/${invalid}`,
        upload.uploadId,
      ],
    );
    await expect(
      db.pool.query(
        "INSERT INTO photo_receipt_fact(asset_id,observation_id,purchase_id,receipt_at) SELECT asset_id,id,purchase_id,receipt_at FROM photo_receipt_observation WHERE id=$1",
        [invalid],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      message: "receipt fact requires exact validated bytes",
    });
    expect(BigInt(fact.photo)).toBeGreaterThan(BigInt(deadline));
    expect(BigInt(fact.details)).toBeLessThanOrEqual(BigInt(deadline));
    expect(
      membership(
        { ...fact, conclusions: [] },
        {
          id: newId(),
          settingsVersionId: newId(),
          launch: fact.lower,
          start: fact.lower,
          cutoff: fact.upper,
          deadline,
        },
      ),
    ).toBe("upload_late");
  } finally {
    await db.close();
  }
}, 30000);

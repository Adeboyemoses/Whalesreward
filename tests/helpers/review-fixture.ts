import { randomBytes } from "node:crypto";
import type pg from "pg";
import sharp from "sharp";
import { newId } from "../../src/server/lib/ids";
import { digest } from "../../src/server/modules/auth/crypto";
import type { EvidenceStorage } from "../../src/server/adapters/storage";
import { createSyncService } from "../../src/server/modules/sync/service";
import { syncFixture, fixtureId, campaign } from "./sync-fixture";

export function reviewFixtureHarness(pool: pg.Pool) {
  const objects = new Map<string, Buffer>();
  const storage: EvidenceStorage = {
    async signPut(key) {
      return { url: key, headers: {} };
    },
    async read(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("missing fixture evidence");
      return bytes;
    },
    async writeFinal(key, bytes) {
      objects.set(key, bytes);
    },
  };
  const sync = createSyncService({ pool, storage });
  async function image(color = "#ffffff") {
    return sharp({
      create: { width: 40, height: 30, channels: 3, background: color },
    })
      .jpeg()
      .toBuffer();
  }
  async function context(bytes: Buffer) {
    const f = await syncFixture(pool, bytes);
    await campaign(pool, f, false);
    return f;
  }
  async function settle(
    f: Awaited<ReturnType<typeof context>>,
    bytes: Buffer,
    overrides: Partial<typeof f.original> = {},
  ) {
    const original = { ...f.original, operationId: newId(), ...overrides };
    const submitted = await sync.submit(f.token, original);
    const upload = await sync.uploadPermission(
      f.token,
      submitted.status.purchaseId,
      { operationId: newId(), ...original.photo },
    );
    const asset = (
      await pool.query("SELECT staging_key FROM photo_asset WHERE id=$1", [
        upload.uploadId,
      ])
    ).rows[0];
    objects.set(asset.staging_key, bytes);
    const result = await sync.finalize(f.token, submitted.status.purchaseId, {
      operationId: newId(),
      expectedVersion: submitted.status.version,
      uploadId: upload.uploadId,
    });
    return { ...result, assetId: upload.uploadId, original };
  }
  async function guard(purchaseId: string) {
    const p = (
      await pool.query(
        "SELECT version,current_revision_id FROM purchase WHERE id=$1",
        [purchaseId],
      )
    ).rows[0];
    return {
      operationId: newId(),
      expectedVersion: p.version as number,
      expectedRevisionId: p.current_revision_id as string | null,
      reason: "Independent evidence review",
    };
  }
  async function adminToken() {
    await pool.query(
      "UPDATE auth_user SET must_change_password=false WHERE id=$1",
      [fixtureId(2)],
    );
    const token = randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',1,clock_timestamp())",
      [newId(), fixtureId(2), digest(token)],
    );
    return token;
  }
  return {
    pool,
    storage,
    objects,
    sync,
    image,
    context,
    settle,
    guard,
    adminToken,
  };
}

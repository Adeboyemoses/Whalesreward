import type pg from "pg";
import { createHash, randomBytes } from "node:crypto";
import { transaction } from "../admin-access/repo";
import {
  securityLock,
  requireAdminSession,
  requirePermission,
} from "../../lib/authz";
import { AuthError } from "../auth/errors";
import { renderCardExport } from "./renderer";
import { CARD_POLICY, type CardOptions } from "./config";
import type { CardArtifactStorage } from "../../adapters/card-artifacts";
import { audit } from "../station/repo";
export type ExportOptions = CardOptions & {
  storage: CardArtifactStorage;
  render?: typeof renderCardExport;
};
async function creatorAllowed(db: pg.PoolClient, admin: string) {
  const row = (
    await db.query(
      `SELECT u.id FROM admin a JOIN auth_user u ON u.id=a.user_id JOIN role r ON r.id=a.role_id WHERE a.id=$1 AND u.kind='admin' AND u.enabled AND NOT u.must_change_password AND r.enabled AND EXISTS(SELECT 1 FROM role_permission WHERE role_id=r.id AND permission_code='cards') AND EXISTS(SELECT 1 FROM role_permission WHERE role_id=r.id AND permission_code='cardExport')`,
      [admin],
    )
  ).rows[0];
  return row?.id as string | undefined;
}
export async function prepareCardExport(
  pool: pg.Pool,
  options: ExportOptions,
  exportId?: string,
): Promise<{ processed: boolean; delivered?: boolean }> {
  const claim = await transaction(pool, async (db) => {
    await securityLock(db);
    const r = (
      await db.query(
        `SELECT e.* FROM card_export e WHERE($1::uuid IS NULL OR e.id=$1) AND e.status IN('pending','failed') AND e.attempts<$2 AND(e.next_attempt_at IS NULL OR e.next_attempt_at<=clock_timestamp()) AND(e.lease_until IS NULL OR e.lease_until<=clock_timestamp()) AND(e.format='xlsx' OR $3::boolean) ORDER BY e.created_at,e.id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [exportId ?? null, CARD_POLICY.maxAttempts, !!options.layout],
      )
    ).rows[0];
    if (!r) return null;
    const user = await creatorAllowed(db, r.created_by);
    if (!user) {
      await db.query(
        "UPDATE card_export SET status='failed',failure_code='preparation_failed',attempts=$2,lease_nonce=NULL,lease_until=NULL WHERE id=$1",
        [r.id, CARD_POLICY.maxAttempts],
      );
      return { denied: true };
    }
    const nonce = randomBytes(24).toString("hex");
    const updated = (
      await db.query(
        "UPDATE card_export SET lease_nonce=$2,lease_until=clock_timestamp()+($3::bigint*interval '1 millisecond'),fencing_version=fencing_version+1,attempts=attempts+1 WHERE id=$1 RETURNING fencing_version",
        [r.id, nonce, CARD_POLICY.leaseMs],
      )
    ).rows[0];
    const items = (
      await db.query(
        'SELECT ordinal,code,qr_payload AS "qrPayload",card_state AS state,assignment_eligible AS "assignmentEligible" FROM card_export_item WHERE export_id=$1 ORDER BY ordinal',
        [r.id],
      )
    ).rows;
    return {
      denied: false,
      id: r.id,
      creator: r.created_by,
      batch: r.batch_id,
      nonce,
      fence: updated.fencing_version,
      snapshot: {
        id: r.id,
        format: r.format as "pdf" | "xlsx",
        snapshotAt: r.snapshot_at.toISOString(),
        batch: {
          id: r.batch_id,
          code: r.batch_code,
          name: r.batch_name,
          status: r.batch_status as "generated" | "printed" | "active",
          version: r.batch_version,
        },
        items,
      },
    };
  });
  if (!claim) return { processed: false };
  if (claim.denied) return { processed: true, delivered: false };
  try {
    const rendered = await (options.render ?? renderCardExport)(
      claim.snapshot!,
      options.layout,
    );
    if (
      rendered.bytes.byteLength < 1 ||
      rendered.bytes.byteLength > CARD_POLICY.maxArtifactBytes
    )
      throw new Error("Artifact size invalid");
    const sha = createHash("sha256").update(rendered.bytes).digest("hex"),
      key = `final/card-exports/${randomBytes(32).toString("hex")}`;
    const delivered = await transaction(pool, async (db) => {
      await securityLock(db);
      const row = (
        await db.query(
          "SELECT * FROM card_export WHERE id=$1 AND lease_nonce=$2 AND fencing_version=$3 AND lease_until>clock_timestamp() FOR UPDATE",
          [claim.id, claim.nonce, claim.fence],
        )
      ).rows[0];
      if (!row) return false;
      if (!(await creatorAllowed(db, claim.creator!)))
        throw new Error("Creator authority revoked");
      // Random key per lease: a stale renderer can only leave an unreachable orphan.
      await options.storage.write(key, rendered.bytes, rendered.contentType);
      const lifetime =
        options.artifactLifetimeMs ?? CARD_POLICY.artifactLifetimeMs;
      if (!Number.isSafeInteger(lifetime) || lifetime <= 0)
        throw new Error("Artifact lifetime invalid");
      const updated = await db.query(
        "UPDATE card_export SET status='ready',prepared_at=clock_timestamp(),expires_at=clock_timestamp()+($4::bigint*interval '1 millisecond'),object_key=$5,sha256=$6,byte_size=$7,failure_code=NULL,lease_nonce=NULL,lease_until=NULL,next_attempt_at=NULL WHERE id=$1 AND lease_nonce=$2 AND fencing_version=$3 AND lease_until>clock_timestamp()",
        [
          claim.id,
          claim.nonce,
          claim.fence,
          lifetime,
          key,
          sha,
          rendered.bytes.byteLength,
        ],
      );
      if (updated.rowCount !== 1) return false;
      await audit(
        db,
        (await creatorAllowed(db, claim.creator!))!,
        "card_batch",
        claim.batch!,
        "batch_export_prepared",
        "Batch export prepared",
        null,
        { exportId: claim.id },
      );
      return true;
    });
    return { processed: true, delivered };
  } catch {
    await transaction(pool, async (db) => {
      await securityLock(db);
      await db.query(
        "UPDATE card_export SET status='failed',failure_code='preparation_failed',lease_nonce=NULL,lease_until=NULL,next_attempt_at=clock_timestamp()+($4::bigint*interval '1 millisecond') WHERE id=$1 AND lease_nonce=$2 AND fencing_version=$3",
        [claim.id, claim.nonce, claim.fence, CARD_POLICY.retryMs],
      );
    });
    return { processed: true, delivered: false };
  }
}
export async function downloadCardExport(
  pool: pg.Pool,
  token: string | undefined,
  batchId: string,
  exportId: string,
  storage: CardArtifactStorage,
) {
  return transaction(pool, async (db) => {
    await securityLock(db);
    const actor = await requireAdminSession(db, token);
    requirePermission(actor, "cards");
    requirePermission(actor, "cardExport");
    const r = (
      await db.query(
        "SELECT *,expires_at<=clock_timestamp() AS expired FROM card_export WHERE id=$1 AND batch_id=$2",
        [exportId, batchId],
      )
    ).rows[0];
    if (!r) throw new AuthError("not_found", 404);
    if (r.expired || r.status === "expired")
      throw new AuthError("export_expired", 410);
    if (r.status === "failed") throw new AuthError("export_failed", 503);
    if (r.status !== "ready") throw new AuthError("export_not_ready", 409);
    // The creator's current authority also gates artifacts prepared before revocation.
    if (!(await creatorAllowed(db, r.created_by)))
      throw new AuthError("permission_denied", 403);
    const bytes = await storage.read(
      r.object_key,
      CARD_POLICY.maxArtifactBytes,
    );
    if (
      BigInt(bytes.byteLength) !== BigInt(r.byte_size) ||
      createHash("sha256").update(bytes).digest("hex") !== r.sha256
    )
      throw new AuthError("export_failed", 503);
    return {
      bytes,
      contentType:
        r.format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `card-batch-${r.batch_code.replace(/[^A-Za-z0-9_-]/g, "_")}-${r.id}.${r.format}`,
    };
  });
}

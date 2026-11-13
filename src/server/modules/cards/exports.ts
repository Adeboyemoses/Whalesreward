import type pg from "pg";
import { cardStorageDeadline } from "../../adapters/card-storage-deadline";
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
import { stationId } from "../station/repo";
import { writeAudit, auditTarget, auditSystem } from "../audit/write";
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
async function exportEvent(
  db: pg.PoolClient,
  row: { id: string; batch_id: string; format: string; operation_id?: string },
  action: "export_prepared" | "export_failed",
) {
  const station = await stationId(db);
  await writeAudit(db, {
    stationId: station,
    action,
    actor: auditSystem("export"),
    target: await auditTarget(db, "card_batch", row.batch_id, station),
    operationId: row.operation_id,
    correlationId: row.id,
    reason:
      action === "export_prepared"
        ? "Batch export prepared"
        : "Batch export failed",
    before: { exportId: row.id, exportFormat: row.format },
    after: { exportId: row.id, exportFormat: row.format },
  });
}
export async function prepareCardExport(
  pool: pg.Pool,
  options: ExportOptions,
  exportId?: string,
): Promise<{ processed: boolean; delivered?: boolean }> {
  const claim = await transaction(pool, async (db) => {
    await securityLock(db);
    // Recover one unusable claim per polling step: exhausted attempts or PDFs
    // blocked by configuration loss. Closing the retry budget makes failure
    // terminal; a new export is required after configuration is restored. Live
    // leases remain owned by their renderer, regardless of local configuration.
    const unavailable = (
      await db.query(
        "SELECT id,batch_id,format,operation_id,fencing_version,lease_nonce FROM card_export WHERE($1::uuid IS NULL OR id=$1) AND status='pending' AND(attempts>=$2 OR(format='pdf' AND NOT $3::boolean)) AND(lease_until IS NULL OR lease_until<=clock_timestamp()) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
        [exportId ?? null, CARD_POLICY.maxAttempts, !!options.layout],
      )
    ).rows[0];
    if (unavailable) {
      const recovered = await db.query(
        "UPDATE card_export SET status='failed',failure_code='preparation_failed',attempts=greatest(attempts,$2),lease_nonce=NULL,lease_until=NULL,next_attempt_at=NULL,fencing_version=fencing_version+1 WHERE id=$1 AND status='pending' AND(attempts>=$2 OR(format='pdf' AND NOT $5::boolean)) AND fencing_version=$3 AND lease_nonce IS NOT DISTINCT FROM $4 AND(lease_until IS NULL OR lease_until<=clock_timestamp())",
        [
          unavailable.id,
          CARD_POLICY.maxAttempts,
          unavailable.fencing_version,
          unavailable.lease_nonce,
          !!options.layout,
        ],
      );
      if (recovered.rowCount === 1)
        await exportEvent(db, unavailable, "export_failed");
      return recovered.rowCount === 1 ? { denied: true } : null;
    }
    const r = (
      await db.query(
        `SELECT e.* FROM card_export e WHERE($1::uuid IS NULL OR e.id=$1) AND e.status='pending' AND e.attempts<$2 AND(e.next_attempt_at IS NULL OR e.next_attempt_at<=clock_timestamp()) AND(e.lease_until IS NULL OR e.lease_until<=clock_timestamp()) AND(e.format='xlsx' OR $3::boolean) ORDER BY e.created_at,e.id LIMIT 1 FOR UPDATE SKIP LOCKED`,
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
      await exportEvent(db, r, "export_failed");
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
    // Verify the claim before uploading, but never hold database authority across I/O.
    const current = await transaction(pool, async (db) => {
      await securityLock(db);
      const row = (
        await db.query(
          "SELECT id FROM card_export WHERE id=$1 AND status='pending' AND lease_nonce=$2 AND fencing_version=$3 AND lease_until>clock_timestamp() FOR UPDATE",
          [claim.id, claim.nonce, claim.fence],
        )
      ).rows[0];
      if (!row) return false;
      if (!(await creatorAllowed(db, claim.creator!)))
        throw new Error("Creator authority revoked");
      return true;
    });
    if (!current) return { processed: true, delivered: false };
    // A late ignored-abort write can only leave this random, unpublished orphan.
    await cardStorageDeadline((signal) =>
      options.storage.write(key, rendered.bytes, rendered.contentType, signal),
    );
    const delivered = await transaction(pool, async (db) => {
      await securityLock(db);
      const row = (
        await db.query(
          "SELECT * FROM card_export WHERE id=$1 AND status='pending' AND lease_nonce=$2 AND fencing_version=$3 AND lease_until>clock_timestamp() FOR UPDATE",
          [claim.id, claim.nonce, claim.fence],
        )
      ).rows[0];
      if (!row) return false;
      if (!(await creatorAllowed(db, claim.creator!)))
        throw new Error("Creator authority revoked");
      const lifetime =
        options.artifactLifetimeMs ?? CARD_POLICY.artifactLifetimeMs;
      if (!Number.isSafeInteger(lifetime) || lifetime <= 0)
        throw new Error("Artifact lifetime invalid");
      const updated = await db.query(
        "UPDATE card_export SET status='ready',prepared_at=clock_timestamp(),expires_at=clock_timestamp()+($4::bigint*interval '1 millisecond'),object_key=$5,sha256=$6,byte_size=$7,failure_code=NULL,lease_nonce=NULL,lease_until=NULL,next_attempt_at=NULL WHERE id=$1 AND status='pending' AND lease_nonce=$2 AND fencing_version=$3 AND lease_until>clock_timestamp()",
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
      await exportEvent(db, row, "export_prepared");
      return true;
    });
    return { processed: true, delivered };
  } catch {
    await transaction(pool, async (db) => {
      await securityLock(db);
      const terminal = await db.query(
        "UPDATE card_export SET status=CASE WHEN attempts>=$5 THEN 'failed' ELSE 'pending' END,failure_code=CASE WHEN attempts>=$5 THEN 'preparation_failed' ELSE NULL END,lease_nonce=NULL,lease_until=NULL,next_attempt_at=CASE WHEN attempts>=$5 THEN NULL ELSE clock_timestamp()+($4::bigint*interval '1 millisecond') END WHERE id=$1 AND status='pending' AND lease_nonce=$2 AND fencing_version=$3 RETURNING id,batch_id,format,operation_id,status",
        [
          claim.id,
          claim.nonce,
          claim.fence,
          CARD_POLICY.retryMs,
          CARD_POLICY.maxAttempts,
        ],
      );
      if (terminal.rows[0]?.status === "failed")
        await exportEvent(db, terminal.rows[0], "export_failed");
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
  const authorize = () =>
    transaction(pool, async (db) => {
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
      if (r.status === "failed") throw new AuthError("export_failed", 409);
      if (r.status !== "ready") throw new AuthError("export_not_ready", 409);
      // The creator's current authority also gates artifacts prepared before revocation.
      if (!(await creatorAllowed(db, r.created_by)))
        throw new AuthError("permission_denied", 403);
      return r;
    });
  const initial = await authorize();
  const bytes = await cardStorageDeadline((signal) =>
    storage.read(initial.object_key, CARD_POLICY.maxArtifactBytes, signal),
  );
  if (
    BigInt(bytes.byteLength) !== BigInt(initial.byte_size) ||
    createHash("sha256").update(bytes).digest("hex") !== initial.sha256
  )
    throw new AuthError("export_failed", 409);
  // Recheck live session, grants, creator, expiry and artifact after untrusted I/O.
  const current = await authorize();
  if (
    current.object_key !== initial.object_key ||
    current.sha256 !== initial.sha256 ||
    BigInt(current.byte_size) !== BigInt(initial.byte_size)
  )
    throw new AuthError("export_failed", 409);
  return {
    bytes,
    contentType:
      current.format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    filename: `card-batch-${current.batch_code.replace(/[^A-Za-z0-9_-]/g, "_")}-${current.id}.${current.format}`,
  };
}

import type pg from "pg";
import { createHash, randomBytes } from "node:crypto";
import { transaction } from "../admin-access/repo";
import { securityLock, requirePermission } from "../../lib/authz";
import { cardStorageDeadline } from "../../adapters/card-storage-deadline";
import type { CardArtifactStorage } from "../../adapters/card-artifacts";
import { AuthError } from "../auth/errors";
import { auditSystem } from "../audit/write";
import { writeReportAudit } from "../audit/write-reports";
import { newId } from "../../lib/ids";
import {
  REPORT_LIMITS,
  type ReportSnapshot,
} from "../../../shared/contracts/reports";
import { renderReportExport, PrecisionError } from "./renderer";
import { reportAuthority } from "./data";
export type ReportExportOptions = {
  storage: CardArtifactStorage;
  render?: typeof renderReportExport;
};
async function creatorAllowed(db: pg.PoolClient, admin: string) {
  return !!(
    await db.query(
      `SELECT a.id FROM admin a JOIN auth_user u ON u.id=a.user_id JOIN role r ON r.id=a.role_id WHERE a.id=$1 AND u.kind='admin' AND u.enabled AND NOT u.must_change_password AND r.enabled AND EXISTS(SELECT 1 FROM role_permission WHERE role_id=r.id AND permission_code='reports') AND EXISTS(SELECT 1 FROM role_permission WHERE role_id=r.id AND permission_code='reportExport')`,
      [admin],
    )
  ).rows[0];
}
async function event(
  db: pg.PoolClient,
  r: {
    id: string;
    station_id: string;
    created_by: string;
    failure_code?: "preparation_failed" | "precision_not_representable" | null;
  },
  failed: boolean,
) {
  const id = newId();
  const at = (await db.query("SELECT clock_timestamp() at")).rows[0]!
    .at as Date;
  await writeReportAudit(db, {
    id,
    eventCode: `AUD-${id}`,
    schemaVersion: 2,
    stationId: r.station_id,
    occurredAt: at.toISOString(),
    area: "reports",
    action: failed ? "report_export_failed" : "report_export_prepared",
    actor: auditSystem("export"),
    originatingSeller: null,
    target: {
      kind: "report_export",
      id: r.id,
      code: `REPORT-${r.id}`,
      subjectAtEvent: null,
    },
    operationId: null,
    correlationId: r.id,
    reason: failed ? "Report export failed" : "Report export prepared",
    relatedEventIds: [],
    changes: [
      { field: "creatorAdminId", before: r.created_by, after: r.created_by },
      {
        field: "exportState",
        before: "pending",
        after: failed ? "failed" : "ready",
      },
      {
        field: "failureCode",
        before: null,
        after: failed ? (r.failure_code ?? "preparation_failed") : null,
      },
    ],
  });
}
export async function prepareReportExport(
  pool: pg.Pool,
  options: ReportExportOptions,
  exportId?: string,
): Promise<{ processed: boolean; delivered?: boolean }> {
  const claim = await transaction(pool, async (db) => {
    await securityLock(db);
    const r = (
      await db.query(
        `SELECT * FROM report_export WHERE ($1::uuid IS NULL OR id=$1) AND status='pending' AND (lease_until IS NULL OR lease_until<=clock_timestamp()) AND (next_attempt_at IS NULL OR next_attempt_at<=clock_timestamp()) ORDER BY snapshot_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [exportId ?? null],
      )
    ).rows[0];
    if (!r) return null;
    if (
      r.attempts >= REPORT_LIMITS.attempts ||
      !(await creatorAllowed(db, r.created_by))
    ) {
      await db.query(
        "UPDATE report_export SET status='failed',failure_code='preparation_failed',lease_nonce=NULL,lease_until=NULL,next_attempt_at=NULL,fencing_version=fencing_version+1 WHERE id=$1",
        [r.id],
      );
      await event(db, r, true);
      return { denied: true as const };
    }
    const nonce = randomBytes(24).toString("hex"),
      updated = (
        await db.query(
          "UPDATE report_export SET lease_nonce=$2,lease_until=clock_timestamp()+($3::bigint*interval '1 millisecond'),fencing_version=fencing_version+1,attempts=attempts+1 WHERE id=$1 RETURNING fencing_version",
          [r.id, nonce, REPORT_LIMITS.leaseMs],
        )
      ).rows[0]!;
    return {
      denied: false as const,
      id: r.id as string,
      creator: r.created_by as string,
      nonce,
      fence: updated.fencing_version as string,
      snapshot: r.frozen_snapshot as ReportSnapshot,
    };
  });
  if (!claim) return { processed: false };
  if (claim.denied) return { processed: true, delivered: false };
  try {
    // Renderer and transport waits are both bounded, even when an injected adapter ignores abort.
    const rendered = await cardStorageDeadline(() =>
      (options.render ?? renderReportExport)(claim.snapshot),
    );
    if (
      rendered.bytes.byteLength < 1 ||
      rendered.bytes.byteLength > REPORT_LIMITS.artifactBytes
    )
      throw new Error("Artifact size invalid");
    const sha = createHash("sha256").update(rendered.bytes).digest("hex"),
      key = `final/report-exports/${randomBytes(32).toString("hex")}`;
    const check = async (db: pg.PoolClient) => {
      await securityLock(db);
      const r = (
        await db.query(
          "SELECT * FROM report_export WHERE id=$1 AND status='pending' AND lease_nonce=$2 AND fencing_version=$3 AND lease_until>clock_timestamp() FOR UPDATE",
          [claim.id, claim.nonce, claim.fence],
        )
      ).rows[0];
      if (!r) return null;
      if (!(await creatorAllowed(db, claim.creator)))
        throw new Error("Creator authority revoked");
      return r;
    };
    if (!(await transaction(pool, check)))
      return { processed: true, delivered: false };
    await cardStorageDeadline((signal) =>
      options.storage.write(key, rendered.bytes, rendered.contentType, signal),
    );
    // Verify persisted bytes before publication. Neither I/O operation holds DB locks.
    const bytes = await cardStorageDeadline((signal) =>
      options.storage.read(key, REPORT_LIMITS.artifactBytes, signal),
    );
    if (
      bytes.byteLength !== rendered.bytes.byteLength ||
      createHash("sha256").update(bytes).digest("hex") !== sha
    )
      throw new Error("Artifact checksum mismatch");
    const delivered = await transaction(pool, async (db) => {
      const r = await check(db);
      if (!r) return false;
      const updated = await db.query(
        "UPDATE report_export SET status='ready',prepared_at=statement_timestamp(),expires_at=statement_timestamp()+interval '24 hours',object_key=$4,sha256=$5,byte_size=$6,failure_code=NULL,lease_nonce=NULL,lease_until=NULL,next_attempt_at=NULL WHERE id=$1 AND status='pending' AND lease_nonce=$2 AND fencing_version=$3 AND lease_until>clock_timestamp()",
        [claim.id, claim.nonce, claim.fence, key, sha, bytes.byteLength],
      );
      if (updated.rowCount !== 1) return false;
      await event(db, r, false);
      return true;
    });
    return { processed: true, delivered };
  } catch (error) {
    await transaction(pool, async (db) => {
      await securityLock(db);
      const precision = error instanceof PrecisionError;
      const r = (
        await db.query(
          `UPDATE report_export SET status=CASE WHEN attempts>=$5 OR $6 THEN 'failed' ELSE 'pending' END,failure_code=CASE WHEN $6 THEN 'precision_not_representable' WHEN attempts>=$5 THEN 'preparation_failed' ELSE NULL END,lease_nonce=NULL,lease_until=NULL,next_attempt_at=CASE WHEN attempts>=$5 OR $6 THEN NULL ELSE clock_timestamp()+($4::bigint*interval '1 millisecond') END WHERE id=$1 AND status='pending' AND lease_nonce=$2 AND fencing_version=$3 AND lease_until>clock_timestamp() RETURNING *`,
          [
            claim.id,
            claim.nonce,
            claim.fence,
            REPORT_LIMITS.retryMs,
            REPORT_LIMITS.attempts,
            precision,
          ],
        )
      ).rows[0];
      if (r?.status === "failed") await event(db, r, true);
    });
    return { processed: true, delivered: false };
  }
}
export async function downloadReportExport(
  pool: pg.Pool,
  token: string | undefined,
  id: string,
  storage: CardArtifactStorage | (() => CardArtifactStorage),
) {
  const authorize = () =>
    transaction(pool, async (db) => {
      const { actor, station } = await reportAuthority(
        db,
        token,
        "reports",
        true,
      );
      requirePermission(actor, "reportExport");
      const r = (
        await db.query(
          "SELECT *,expires_at<=clock_timestamp() expired FROM report_export WHERE id=$1 AND station_id=$2 AND created_by=$3",
          [id, station.id, actor.admin_id],
        )
      ).rows[0];
      if (!r) throw new AuthError("not_found", 404);
      if (r.expired || r.status === "expired")
        throw new AuthError("export_expired", 410);
      if (r.status === "failed") throw new AuthError("export_failed", 409);
      if (r.status !== "ready") throw new AuthError("export_not_ready", 409);
      return r;
    });
  const first = await authorize();
  let bytes: Uint8Array;
  try {
    const adapter = typeof storage === "function" ? storage() : storage;
    bytes = await cardStorageDeadline((signal) =>
      adapter.read(first.object_key, REPORT_LIMITS.artifactBytes, signal),
    );
    if (
      BigInt(bytes.byteLength) !== BigInt(first.byte_size) ||
      createHash("sha256").update(bytes).digest("hex") !== first.sha256
    )
      throw new Error();
  } catch {
    throw new AuthError("export_failed", 409);
  }
  const current = await authorize();
  if (
    current.object_key !== first.object_key ||
    current.sha256 !== first.sha256 ||
    current.byte_size !== first.byte_size
  )
    throw new AuthError("export_failed", 409);
  return {
    bytes,
    contentType:
      current.format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    filename: `report-${id}.${current.format}`,
  };
}

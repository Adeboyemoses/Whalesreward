import type pg from "pg";
import type { AdminConfig } from "../admin-access/config";
import { transaction, receipt } from "../admin-access/repo";
import { requirePermission } from "../../lib/authz";
import { AuthError } from "../auth/errors";
import { newId } from "../../lib/ids";
import { auditActor } from "../audit/write";
import { writeReportAudit } from "../audit/write-reports";
import {
  reportExportInputSchema,
  reportExportSchema,
  REPORT_LIMITS,
  type ReportExport,
} from "../../../shared/contracts/reports";
import {
  reportAuthority,
  validateFilter,
  dataset,
  reportFromRows,
} from "./data";
export function exportView(r: Record<string, unknown>): ReportExport {
  const instant = (v: unknown) =>
    v instanceof Date ? v.toISOString() : (v ?? null);
  return reportExportSchema.parse({
    id: r.id,
    format: r.format,
    filters: r.filters,
    sourceDataVersion: r.source_data_version,
    snapshotAt: instant(r.snapshot_at),
    createdBy: r.creator_snapshot,
    state: r.expired ? "expired" : r.status,
    preparedAt: instant(r.prepared_at),
    expiresAt: instant(r.expires_at),
    byteSize: r.byte_size ?? null,
    sha256: r.sha256 ?? null,
    failureCode: r.failure_code ?? null,
  });
}
export async function createReportExport(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  input: unknown,
) {
  const p = reportExportInputSchema.parse(input);
  return transaction(pool, async (db) => {
    const { actor, station } = await reportAuthority(
      db,
      token,
      "reports",
      true,
    );
    requirePermission(actor, "reportExport");
    let replayed = true;
    const data = await receipt(
      db,
      config,
      actor,
      "report-export",
      p,
      async () => {
        replayed = false;
        validateFilter(p.filters);
        const d = await dataset(db, station.id, p.filters);
        if (d.dataVersion !== p.expectedDataVersion)
          throw new AuthError("read_view_stale", 409);
        if (d.sources.length > REPORT_LIMITS.sources)
          throw new AuthError("export_too_large", 422);
        const report = reportFromRows(
            p.filters,
            d.asOf,
            d.dataVersion,
            d.sources,
          ),
          id = newId(),
          actorSnapshot = await auditActor(db, actor.user_id);
        if (actorSnapshot.kind !== "admin")
          throw new AuthError("permission_denied", 403);
        const creator = {
          id: actor.admin_id,
          code: actorSnapshot.code,
          name: actorSnapshot.nameAtEvent,
        };
        const r = (
          await db.query(
            `INSERT INTO report_export(id,station_id,created_by,operation_id,format,filters,source_data_version,snapshot_at,creator_snapshot,frozen_snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,$10::jsonb) RETURNING *`,
            [
              id,
              station.id,
              actor.admin_id,
              p.operationId,
              p.format,
              JSON.stringify(p.filters),
              d.dataVersion,
              d.asOf,
              JSON.stringify(creator),
              JSON.stringify({
                id,
                format: p.format,
                report,
                sources: d.sources,
              }),
            ],
          )
        ).rows[0]!;
        const auditId = newId();
        await writeReportAudit(db, {
          id: auditId,
          eventCode: `AUD-${auditId}`,
          schemaVersion: 2,
          stationId: station.id,
          occurredAt: d.asOf,
          area: "reports",
          action: "report_export_requested",
          actor: actorSnapshot,
          originatingSeller: null,
          target: {
            kind: "report_export",
            id,
            code: `REPORT-${id}`,
            subjectAtEvent: null,
          },
          operationId: p.operationId,
          correlationId: id,
          reason: "Report export requested",
          relatedEventIds: [],
          changes: [
            { field: "creatorAdminId", before: null, after: actor.admin_id },
            { field: "sourceDataVersion", before: null, after: d.dataVersion },
            { field: "reportFrom", before: null, after: p.filters.from },
            { field: "reportTo", before: null, after: p.filters.to },
            { field: "reportProduct", before: null, after: p.filters.product },
            { field: "reportGroupBy", before: null, after: p.filters.groupBy },
            { field: "exportFormat", before: null, after: p.format },
            { field: "exportState", before: null, after: "pending" },
          ],
        });
        return exportView(r);
      },
    );
    return { data: reportExportSchema.parse(data), replayed };
  });
}
export async function readReportExport(
  pool: pg.Pool,
  token: string | undefined,
  id: string,
) {
  return transaction(pool, async (db) => {
    const { actor, station } = await reportAuthority(db, token);
    requirePermission(actor, "reportExport");
    const r = (
      await db.query(
        "SELECT *,expires_at<=clock_timestamp() expired FROM report_export WHERE id=$1 AND station_id=$2 AND created_by=$3",
        [id, station.id, actor.admin_id],
      )
    ).rows[0];
    if (!r) throw new AuthError("not_found", 404);
    return exportView(r);
  });
}

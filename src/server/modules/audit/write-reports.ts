import type pg from "pg";
import {
  m4ReportAuditSchema,
  type M4ReportAuditEvent,
} from "../../../shared/contracts/audit";
export async function writeReportAudit(
  db: pg.PoolClient,
  input: M4ReportAuditEvent,
) {
  const e = m4ReportAuditSchema.parse(input);
  await db.query(
    `INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,operation_id,actor_snapshot,originating_seller_snapshot,"before","after",reason,occurred_at,schema_version,station_id,event_code,area,target_snapshot,correlation_id,changes,related_event_ids) VALUES($1,$2,$3,$4,'report_export',$5,$6,$7::jsonb,NULL,$8::jsonb,$9::jsonb,$10,$11,2,$12,$13,'reports',$14::jsonb,$15,$16::jsonb,$17::uuid[])`,
    [
      e.id,
      e.actor.kind === "admin" ? e.actor.userId : null,
      e.actor.kind === "system" ? "system" : "user",
      e.action,
      e.target.id,
      e.operationId,
      JSON.stringify(e.actor),
      JSON.stringify(
        Object.fromEntries(e.changes.map((c) => [c.field, c.before])),
      ),
      JSON.stringify(
        Object.fromEntries(e.changes.map((c) => [c.field, c.after])),
      ),
      e.reason,
      e.occurredAt,
      e.stationId,
      e.eventCode,
      JSON.stringify(e.target),
      e.correlationId,
      JSON.stringify(e.changes),
      e.relatedEventIds,
    ],
  );
}

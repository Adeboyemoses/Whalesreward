import type pg from "pg";
import {
  m4SettingsAuditSchema,
  type M4SettingsAuditEvent,
} from "../../../shared/contracts/audit";
/** Validate before persistence, within the caller's state/receipt transaction. */
export async function writeSettingsAudit(
  db: pg.PoolClient,
  input: M4SettingsAuditEvent,
) {
  const e = m4SettingsAuditSchema.parse(input);
  await db.query(
    `INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,operation_id,actor_snapshot,originating_seller_snapshot,"before","after",reason,occurred_at,schema_version,station_id,event_code,area,target_snapshot,correlation_id,changes,related_event_ids) VALUES($1,$2,'user',$3,'settings',$4,$5,$6::jsonb,'null'::jsonb,$7::jsonb,$8::jsonb,$9,$10::timestamptz,2,$11,$12,'settings',$13::jsonb,$14,$15::jsonb,$16::uuid[])`,
    [
      e.id,
      e.actor.kind === "admin" ? e.actor.userId : null,
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

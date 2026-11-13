import { redactAuditText } from "../../../shared/contracts/audit-privacy.ts";
import type pg from "pg";
import { v7 as newId } from "uuid";
import {
  safeAuditText,
  auditActorSchema,
  auditSellerSchema,
  auditTargetSchema,
  currentAuditEventSchema,
  auditRules,
  auditChangeSchema,
  type AuditActor,
  type AuditSeller,
  type AuditAction,
  type AuditTargetKind,
  type AuditChange,
} from "../../../shared/contracts/audit.ts";

export type AuditWriteInput = {
  id?: string;
  stationId: string;
  action: AuditAction;
  actor: AuditActor;
  target: {
    kind: AuditTargetKind;
    id: string;
    code: string;
    subjectAtEvent: string | null;
  };
  originatingSeller?: AuditSeller | null;
  operationId?: string | null;
  correlationId?: string;
  reason: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  occurredAt?: string;
  relatedEventIds?: string[];
};
export function auditSystem(
  service: Extract<AuditActor, { kind: "system" }>["service"],
): AuditActor {
  return {
    kind: "system",
    service,
    nameAtEvent: `${service[0]!.toUpperCase()}${service.slice(1)} service`,
  };
}
const display = (v: string) => {
  const redacted = redactAuditText(v).slice(0, 120);
  return safeAuditText(redacted) ? redacted : "Private value omitted";
};
export async function auditActor(
  db: pg.PoolClient,
  userId: string,
): Promise<AuditActor> {
  const r = (
    await db.query(
      `SELECT u.id,u.kind,u.display_name,u.username,a.admin_code,t.staff_code,r.name AS role_name FROM auth_user u LEFT JOIN admin a ON a.user_id=u.id LEFT JOIN role r ON r.id=a.role_id LEFT JOIN attendant t ON t.user_id=u.id WHERE u.id=$1`,
      [userId],
    )
  ).rows[0];
  return auditActorSchema.parse(
    r
      ? {
          kind: r.kind,
          userId: r.id,
          code: r.kind === "admin" ? r.admin_code : r.staff_code,
          nameAtEvent: display(r.display_name),
          usernameAtEvent: display(r.username),
          roleAtEvent: r.kind === "admin" ? display(r.role_name) : null,
        }
      : null,
  );
}
export async function auditSeller(
  db: pg.PoolClient,
  purchaseId: string,
): Promise<AuditSeller> {
  const r = (
    await db.query(
      `SELECT p.originating_attendant_id AS "attendantId",a.user_id AS "accountId",a.staff_code AS "staffCode",p.seller_name AS name,p.seller_username AS username FROM purchase p JOIN attendant a ON a.id=p.originating_attendant_id WHERE p.id=$1`,
      [purchaseId],
    )
  ).rows[0];
  return auditSellerSchema.parse(
    r ? { ...r, name: display(r.name), username: display(r.username) } : r,
  );
}
export async function auditTarget(
  db: pg.PoolClient,
  kind: AuditTargetKind,
  id: string,
  stationId: string,
) {
  let r: { code: string; subject: string | null } | undefined;
  switch (kind) {
    case "purchase":
      r = (
        await db.query(
          "SELECT sale_code AS code,NULL::text AS subject FROM purchase WHERE id=$1 AND station_id=$2",
          [id, stationId],
        )
      ).rows[0];
      break;
    case "customer":
      r = (
        await db.query(
          "SELECT customer_code AS code,name AS subject FROM customer WHERE id=$1 AND (registered_station_id=$2 OR registered_station_id IS NULL AND (SELECT count(*) FROM station)=1)",
          [id, stationId],
        )
      ).rows[0];
      break;
    case "pump":
      r = (
        await db.query(
          "SELECT code,name AS subject FROM pump WHERE id=$1 AND station_id=$2",
          [id, stationId],
        )
      ).rows[0];
      break;
    case "admin":
      r = (
        await db.query(
          "SELECT a.admin_code AS code,u.display_name AS subject FROM admin a JOIN auth_user u ON u.id=a.user_id WHERE a.id=$1 OR u.id=$1",
          [id],
        )
      ).rows[0];
      break;
    case "attendant":
      r = (
        await db.query(
          "SELECT a.staff_code AS code,u.display_name AS subject FROM attendant a JOIN auth_user u ON u.id=a.user_id WHERE a.id=$1 OR u.id=$1",
          [id],
        )
      ).rows[0];
      break;
    case "card_batch":
      r = (
        await db.query(
          "SELECT batch_code AS code,name AS subject FROM card_batch WHERE id=$1",
          [id],
        )
      ).rows[0];
      break;
    case "product":
      r = (
        await db.query(
          "SELECT code,NULL::text AS subject FROM product WHERE id=$1",
          [id],
        )
      ).rows[0];
      break;
    case "role":
      r = (
        await db.query(
          "SELECT 'ROLE-'||id::text AS code,name AS subject FROM role WHERE id=$1",
          [id],
        )
      ).rows[0];
      break;
    default: {
      const prefixes: Partial<Record<AuditTargetKind, string>> = {
        card: "CARD",
        settings: "SETTINGS",
        recovery_grant: "GRANT",
        manager_case: "CASE",
        review_evidence_approval: "APPROVAL",
        review_evidence_configuration: "CONFIG",
      };
      r = { code: `${prefixes[kind]}-${id}`, subject: null };
    }
  }
  return auditTargetSchema.parse(
    r
      ? {
          kind,
          id,
          code: r.code,
          subjectAtEvent: r.subject === null ? null : display(r.subject),
        }
      : null,
  );
}
/** Call only with the domain transaction's client. No independent commit and no
 * raw payload fallback: an invalid audit aborts the business change with it. */
export async function writeAudit(
  db: pg.PoolClient,
  input: AuditWriteInput,
): Promise<string> {
  const id = input.id ?? newId();
  const keys = [
    ...new Set([
      ...Object.keys(input.before ?? {}),
      ...Object.keys(input.after ?? {}),
    ]),
  ];
  const changes: AuditChange[] = keys.map((field) =>
    auditChangeSchema.parse({
      field,
      before: input.before?.[field] ?? null,
      after: input.after?.[field] ?? null,
    }),
  );
  const rawAt =
    input.occurredAt ??
    (
      await db.query<{ at: string }>(
        "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS at",
      )
    ).rows[0]!.at;
  const occurredAt = rawAt
    .replace(" ", "T")
    .replace(/\+00$/, "Z")
    .replace(/([+-]\d{2})$/, "$1:00");
  const event = currentAuditEventSchema.parse({
    id,
    eventCode: `AUD-${id}`,
    schemaVersion: 1,
    stationId: input.stationId,
    occurredAt,
    area: auditRules[input.action]?.area,
    action: input.action,
    actor: input.actor,
    originatingSeller: input.originatingSeller ?? null,
    target: input.target,
    operationId: input.operationId ?? null,
    correlationId: input.correlationId ?? input.operationId ?? id,
    reason: input.reason,
    changes,
    relatedEventIds: input.relatedEventIds ?? [],
  });
  const before = Object.fromEntries(
    event.changes.map((c) => [c.field, c.before]),
  );
  const after = Object.fromEntries(
    event.changes.map((c) => [c.field, c.after]),
  );
  await db.query(
    `INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,operation_id,actor_snapshot,originating_seller_snapshot,"before","after",reason,occurred_at,schema_version,station_id,event_code,area,target_snapshot,correlation_id,changes,related_event_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::timestamptz,1,$14,$15,$16,$17::jsonb,$18,$19::jsonb,$20::uuid[])`,
    [
      id,
      event.actor.kind === "system" ? null : event.actor.userId,
      event.actor.kind === "system" ? "system" : "user",
      event.action,
      event.target.kind,
      event.target.id,
      event.operationId,
      JSON.stringify(event.actor),
      JSON.stringify(event.originatingSeller),
      JSON.stringify(before),
      JSON.stringify(after),
      event.reason,
      event.occurredAt,
      event.stationId,
      event.eventCode,
      event.area,
      JSON.stringify(event.target),
      event.correlationId,
      JSON.stringify(event.changes),
      event.relatedEventIds,
    ],
  );
  return id;
}

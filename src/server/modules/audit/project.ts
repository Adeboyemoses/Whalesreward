import type pg from "pg";
import {
  auditId,
  auditActorSchema,
  auditSellerSchema,
  auditTargetSchema,
  auditTargetKinds,
  auditRules,
  auditChangeSchema,
  currentAuditEventSchema,
  m4AuditSchema,
  historicalAuditEventSchema,
  type AuditAction,
  type AuditEvent,
  type AuditField,
} from "../../../shared/contracts/audit";
import { auditSystem } from "./write";
export type AuditRow = {
  id: string;
  actor_user_id: string | null;
  actor_kind: string;
  action: string;
  target_type: string;
  target_id: string;
  operation_id: string | null;
  actor_snapshot: unknown;
  originating_seller_snapshot: unknown;
  before: unknown;
  after: unknown;
  reason: string;
  occurred_at: string;
  schema_version: number | null;
  station_id: string | null;
  event_code: string | null;
  area: string | null;
  target_snapshot: unknown;
  correlation_id: string | null;
  changes: unknown;
  related_event_ids: unknown;
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const nullableId = (v: unknown) => (auditId.safeParse(v).success ? v : null);
/** Scope is proved from persisted station identity or a station-owned target.
 * Global historical access/role/batch rows without immutable station proof are
 * excluded, even when only one station currently exists. */
export async function eventStation(
  db: pg.PoolClient,
  row: AuditRow,
): Promise<string | null> {
  if (row.station_id)
    return auditId.safeParse(row.station_id).success ? row.station_id : null;
  // Historical writer references prove scope only when every supplied reference
  // belongs to this event's immutable target and all agree on one station.
  if (row.target_type === "product" && row.action === "price_activated") {
    const after = object(row.after),
      before = object(row.before);
    if (!auditId.safeParse(after.priceVersionId).success) return null;
    const stations = new Set<string>();
    for (const side of [before, after]) {
      if (side.priceVersionId === undefined || side.priceVersionId === null)
        continue;
      if (!auditId.safeParse(side.priceVersionId).success) return null;
      const ref = (
        await db.query(
          "SELECT station_id FROM product_price_version WHERE id=$1 AND product_id=$2",
          [side.priceVersionId, row.target_id],
        )
      ).rows[0];
      if (!ref) return null;
      stations.add(ref.station_id);
    }
    return stations.size === 1 ? [...stations][0]! : null;
  }
  if (
    row.target_type === "attendant" &&
    ["assignment_changed", "assignment_ended"].includes(row.action)
  ) {
    const sides = [object(row.before), object(row.after)],
      stations = new Set<string>();
    if (
      !auditId.safeParse(
        (row.action === "assignment_ended" ? sides[0] : sides[1])?.assignmentId,
      ).success
    )
      return null;
    for (const side of sides) {
      if (side.assignmentId === undefined || side.assignmentId === null)
        continue;
      if (!auditId.safeParse(side.assignmentId).success) return null;
      const ref = (
        await db.query(
          "SELECT p.station_id,a.pump_id FROM assignment a JOIN pump p ON p.id=a.pump_id WHERE a.id=$1 AND a.attendant_id=$2",
          [side.assignmentId, row.target_id],
        )
      ).rows[0];
      if (
        !ref ||
        (side.pumpId !== undefined &&
          side.pumpId !== null &&
          side.pumpId !== ref.pump_id)
      )
        return null;
      stations.add(ref.station_id);
    }
    return stations.size === 1 ? [...stations][0]! : null;
  }
  if (row.target_type === "card" && row.action === "card_replaced") {
    const refs = (
      await db.query(
        `SELECT c.registered_station_id AS station_id,x.id,x.customer_id,x.old_card_id,x.new_card_id FROM customer_identity_change x JOIN customer c ON c.id=x.customer_id WHERE x.audit_event_id=$1 AND x.kind='card_replacement' AND x.old_card_id=$2`,
        [row.id, row.target_id],
      )
    ).rows;
    if (refs.length !== 1 || !refs[0].station_id) return null;
    const ref = refs[0];
    const expected: Record<string, unknown> = {
      customerId: ref.customer_id,
      oldCardId: ref.old_card_id,
      newCardId: ref.new_card_id,
      replacementCardId: ref.new_card_id,
      identityChangeId: ref.id,
    };
    for (const side of [object(row.before), object(row.after)])
      for (const [key, value] of Object.entries(expected))
        if (
          side[key] !== undefined &&
          side[key] !== null &&
          side[key] !== value
        )
          return null;
    return ref.station_id;
  }
  const queries: Record<string, string> = {
    purchase: "SELECT station_id FROM purchase WHERE id=$1",
    customer:
      "SELECT registered_station_id AS station_id FROM customer WHERE id=$1",
    pump: "SELECT station_id FROM pump WHERE id=$1",
    manager_case:
      "SELECT c.registered_station_id AS station_id FROM customer_recovery_case r JOIN customer c ON c.id=r.customer_id WHERE r.id=$1",
    settings: "SELECT station_id FROM settings_version WHERE id=$1",
    review_evidence_approval:
      "SELECT station_id FROM review_evidence_approval WHERE id=$1",
    review_evidence_configuration:
      "SELECT station_id FROM review_evidence_configuration WHERE id=$1",
  };
  const sql = Object.hasOwn(queries, row.target_type)
    ? queries[row.target_type]
    : undefined;
  if (!sql) return null;
  const r = (await db.query(sql, [row.target_id])).rows[0];
  return r?.station_id ?? null;
}
function knownAction(row: AuditRow): AuditAction | null {
  if (Object.hasOwn(auditRules, row.action)) return row.action as AuditAction;
  if (row.target_type === "purchase") {
    if (
      row.action === "purchase.cancelled" &&
      object(row.after).reason === "customer_not_found"
    )
      return "sale_cancelled_unmatched";
    if (
      row.action === "purchase.credited" &&
      auditId.safeParse(object(row.after).revisionId).success
    )
      return "sale_credited";
    if (
      row.action === "purchase.held" &&
      auditId.safeParse(object(row.after).revisionId).success
    )
      return "sale_held";
  }
  if (row.target_type === "card_batch") {
    if (row.action === "batch_status_changed") {
      const b = object(row.before).status,
        a = object(row.after).status;
      if (b === "generated" && a === "printed") return "batch_printed";
      if (b === "printed" && a === "active") return "batch_activated";
    }
    if (row.action === "batch_export_requested") return "export_requested";
    if (row.action === "batch_export_prepared") return "export_prepared";
  }
  return null;
}
function oldValues(row: AuditRow, raw: unknown, action: AuditAction) {
  const values = { ...object(raw) };
  const rename = (a: string, b: string, version = false) => {
    if (a in values)
      values[b] =
        version &&
        typeof values[a] === "number" &&
        Number.isSafeInteger(values[a])
          ? String(values[a])
          : values[a];
    delete values[a];
  };
  switch (action) {
    case "pump_created":
      rename("version", "pumpVersion", true);
      break;
    case "attendant_created":
      rename("version", "attendantVersion", true);
      break;
    case "assignment_changed":
      rename("version", "assignmentVersion", true);
      break;
    case "price_activated":
      rename("version", "priceVersion", true);
      break;
    case "batch_generated":
    case "batch_printed":
    case "batch_activated":
      rename("status", "batchStatus");
      rename("version", "batchVersion", true);
      break;
    case "export_requested":
      rename("format", "exportFormat");
      rename("cardCount", "recordCount", true);
      break;
    case "customer_registered":
      rename("category", "customerCategory");
      break;
    case "card_replaced":
      rename("replacementCardId", "newCardId");
      break;
  }
  const policy = object(values.reviewPolicy);
  if ("release" in policy) values.reviewPolicyRelease = policy.release;
  if ("revision" in policy)
    values.reviewPolicyRevision =
      typeof policy.revision === "number"
        ? String(policy.revision)
        : policy.revision;
  if (row.action === "purchase.held") {
    rename("revisionId", "candidateRevisionId");
    delete values.revisionId;
  }
  if (row.action === "purchase.held" || row.action === "purchase.credited")
    rename("assetId", "photoAssetId");
  return values;
}
/** The only public projection. It never joins mutable profile, price or purchase
 * values to fill historical snapshot gaps, and never returns raw JSON. */
export function projectAudit(
  row: AuditRow,
  stationId: string,
): AuditEvent | null {
  if (row.schema_version === 1 || row.schema_version === 2) {
    const parsed = (
      row.schema_version === 2 ? m4AuditSchema : currentAuditEventSchema
    ).safeParse({
      id: row.id,
      eventCode: row.event_code,
      schemaVersion: row.schema_version,
      stationId,
      occurredAt: row.occurred_at,
      area: row.area,
      action: row.action,
      actor: row.actor_snapshot,
      originatingSeller: row.originating_seller_snapshot,
      target: row.target_snapshot,
      operationId: row.operation_id,
      correlationId: row.correlation_id,
      reason: row.reason,
      changes: row.changes,
      relatedEventIds: row.related_event_ids,
    });
    if (
      !parsed.success ||
      parsed.data.target.id !== row.target_id ||
      parsed.data.target.kind !== row.target_type ||
      (parsed.data.actor.kind !== "system" &&
        parsed.data.actor.userId !== row.actor_user_id) ||
      (parsed.data.actor.kind === "system" && row.actor_user_id !== null)
    ) {
      if (row.schema_version === 1) return null;
      // Unsupported M4 mappings remain visible as a minimal historical event.
      // Reuse only independently validated envelope snapshots, never raw changes.
      return projectAudit(
        {
          ...row,
          schema_version: 0,
          action: "unsupported_m4_event",
          before: null,
          after: null,
          changes: [],
          originating_seller_snapshot: null,
        },
        stationId,
      );
    }
    return parsed.data;
  }
  if (row.schema_version !== null && row.schema_version !== 0)
    return projectAudit(
      {
        ...row,
        schema_version: 0,
        action: "unsupported_m4_event",
        before: null,
        after: null,
        changes: [],
        originating_seller_snapshot: null,
      },
      stationId,
    );
  let action = knownAction(row);
  const targetKind = auditTargetKinds.includes(
    row.target_type as (typeof auditTargetKinds)[number],
  )
    ? row.target_type
    : "legacy";
  if (
    action &&
    !auditRules[action].targets.includes(targetKind as never) &&
    !(action === "card_replaced" && targetKind === "customer")
  )
    action = null;
  const targetRaw = object(row.target_snapshot);
  const targetParsed = auditTargetSchema.safeParse(targetRaw);
  const actor = auditActorSchema.safeParse(row.actor_snapshot);
  const seller = auditSellerSchema.safeParse(row.originating_seller_snapshot);
  let snapshot = actor.success ? actor.data : null;
  if (
    snapshot &&
    snapshot.kind !== "system" &&
    snapshot.userId !== row.actor_user_id
  )
    snapshot = null;
  if (
    row.action === "purchase.cancelled" &&
    action === "sale_cancelled_unmatched"
  )
    snapshot = auditSystem("sync");
  if (["purchase.held", "purchase.credited"].includes(row.action) && action)
    snapshot = auditSystem("validation");
  if (row.action === "batch_export_prepared" && action)
    snapshot = auditSystem("export");
  const changes = [];
  if (action) {
    const b = oldValues(row, row.before, action),
      a = oldValues(row, row.after, action);
    // These constants follow directly from the specified legacy writer semantics.
    if (row.action === "purchase.held") {
      a.revisionId = null;
      a.credited = false;
    }
    if (row.action === "purchase.cancelled") {
      a.state = "cancelled";
      a.credited = false;
      a.creditedSpendKobo = "0";
    }
    const r = auditRules[action];
    const fields: readonly AuditField[] = [
      ...r.fields,
      ...("optional" in r ? (r.optional ?? []) : []),
    ];
    for (const field of fields) {
      if (!(field in b) && !(field in a)) continue;
      const c = auditChangeSchema.safeParse({
        field,
        before: b[field] ?? null,
        after: a[field] ?? null,
      });
      if (c.success) changes.push(c.data);
    }
  }
  const areas: Record<string, string> = {
    purchase: "sales",
    customer: "customers",
    card: "cards",
    card_batch: "cards",
    product: "prices",
    attendant: "access",
    admin: "access",
    role: "access",
    settings: "settings",
    recovery_grant: "recovery",
    manager_case: "customers",
    pump: "assignments",
    review_evidence_approval: "settings",
    review_evidence_configuration: "settings",
  };
  const historicalArea = [
    "sales",
    "customers",
    "cards",
    "prices",
    "assignments",
    "access",
    "settings",
    "recovery",
  ].includes(row.area ?? "")
    ? row.area
    : Object.hasOwn(areas, row.target_type)
      ? areas[row.target_type]
      : undefined;
  if (!action && !historicalArea) return null;
  const result = historicalAuditEventSchema.safeParse({
    id: row.id,
    eventCode: `AUD-${row.id}`,
    schemaVersion: 0,
    stationId,
    occurredAt: row.occurred_at,
    area: action ? auditRules[action].area : historicalArea,
    action: action ?? "legacy_event",
    actor: snapshot,
    originatingSeller: seller.success ? seller.data : null,
    target: {
      kind: targetKind,
      id: row.target_id,
      code:
        targetParsed.success && targetParsed.data.id === row.target_id
          ? targetParsed.data.code
          : null,
      subjectAtEvent:
        targetParsed.success && targetParsed.data.id === row.target_id
          ? targetParsed.data.subjectAtEvent
          : null,
    },
    operationId: nullableId(row.operation_id),
    correlationId: nullableId(row.correlation_id),
    reason: action
      ? `Historical ${action.replaceAll("_", " ")}`
      : "Historical event",
    changes: action ? changes : [],
    relatedEventIds: [],
  });
  return result.success ? result.data : null;
}

import type pg from "pg";
import { timingSafeEqual } from "node:crypto";
import { newId } from "../../lib/ids";
import { hmac } from "../auth/crypto";
import { AuthError } from "../auth/errors";
import { auditText } from "../admin-access/privacy";
import {
  assignmentSchema,
  attendantSchema,
  pumpSchema,
  productSchema,
  priceSchema,
} from "../../../shared/contracts/station";

export async function stationId(db: pg.PoolClient) {
  const rows = (
    await db.query("SELECT id FROM station ORDER BY created_at,id LIMIT 2")
  ).rows;
  if (rows.length !== 1) throw new AuthError("temporarily_unavailable", 503);
  return rows[0].id as string;
}
export const productView = (r: Record<string, unknown>) =>
  productSchema.parse({ id: r.product_id, code: r.product_code, unit: r.unit });
export async function currentPrice(
  db: pg.PoolClient,
  station: string,
  product: string,
) {
  return (
    (
      await db.query(
        "SELECT *,rate_kobo::text,clock_timestamp() AS fetched_at FROM product_price_version WHERE station_id=$1 AND product_id=$2 AND effective_from<=clock_timestamp() ORDER BY effective_from DESC,id DESC LIMIT 1",
        [station, product],
      )
    ).rows[0] ?? null
  );
}
export function priceView(r: Record<string, unknown> | null) {
  return r
    ? priceSchema.parse({
        priceVersionId: r.id,
        version: r.version,
        rateKobo: r.rate_kobo,
        currency: r.currency,
        quantityPrecision: r.quantity_precision,
        effectiveFrom: (r.effective_from as Date).toISOString(),
        fetchedAt: ((r.fetched_at ?? r.effective_from) as Date).toISOString(),
      })
    : null;
}
export async function pumpView(db: pg.PoolClient, id: string, station: string) {
  const r = (
    await db.query(
      `SELECT p.*,pr.id AS product_id,pr.code AS product_code,pr.unit,(SELECT count(*)::text FROM assignment ag WHERE ag.pump_id=p.id AND ag.effective_until IS NULL) AS attendant_count FROM pump p JOIN product pr ON pr.id=p.product_id WHERE p.id=$1 AND p.station_id=$2`,
      [id, station],
    )
  ).rows[0];
  if (!r) throw new AuthError("not_found", 404);
  return pumpSchema.parse({
    id: r.id,
    code: r.code,
    name: r.name,
    version: r.version,
    product: productView(r),
    price: priceView(await currentPrice(db, station, r.product_id)),
    attendantCount: r.attendant_count,
  });
}
export async function assignmentView(db: pg.PoolClient, id: string) {
  const r = (
    await db.query(
      `SELECT ag.*,p.code,p.name,pr.id AS product_id,pr.code AS product_code,pr.unit FROM assignment ag JOIN pump p ON p.id=ag.pump_id JOIN product pr ON pr.id=p.product_id WHERE ag.id=$1`,
      [id],
    )
  ).rows[0];
  if (!r) throw new AuthError("not_found", 404);
  return assignmentSchema.parse({
    id: r.id,
    version: r.assignment_version,
    pump: { id: r.pump_id, code: r.code, name: r.name },
    product: productView(r),
    effectiveFrom: r.effective_from.toISOString(),
  });
}
export async function attendantView(
  db: pg.PoolClient,
  id: string,
  station: string,
) {
  const r = (
    await db.query(
      `SELECT a.*,u.username,u.display_name,ag.id AS assignment_id,EXISTS(SELECT 1 FROM capture_context c WHERE c.attendant_id=a.id AND c.assignment_id=ag.id) AS acknowledged FROM attendant a JOIN auth_user u ON u.id=a.user_id LEFT JOIN assignment ag ON ag.attendant_id=a.id AND ag.effective_until IS NULL LEFT JOIN pump p ON p.id=ag.pump_id WHERE a.id=$1 AND (p.station_id=$2 OR ag.id IS NULL)`,
      [id, station],
    )
  ).rows[0];
  if (!r) throw new AuthError("not_found", 404);
  return attendantSchema.parse({
    id: r.id,
    accountId: r.user_id,
    staffCode: r.staff_code,
    name: r.display_name,
    username: r.username,
    version: r.version,
    createdAt: r.created_at.toISOString(),
    assignment: r.assignment_id
      ? await assignmentView(db, r.assignment_id)
      : null,
    handover: r.assignment_id
      ? r.acknowledged
        ? "acknowledged"
        : "fresh_sign_in_required"
      : "unassigned",
  });
}
export async function eventView(db: pg.PoolClient, id: string) {
  const r = (
    await db.query(
      `SELECT ag.*,a.staff_code,u.display_name,ad.id AS actor_id,ad.admin_code,au.display_name AS actor_name,(SELECT old.pump_id FROM assignment old WHERE old.attendant_id=ag.attendant_id AND old.assignment_version<ag.assignment_version ORDER BY old.assignment_version DESC LIMIT 1) AS from_pump_id FROM assignment ag JOIN attendant a ON a.id=ag.attendant_id JOIN auth_user u ON u.id=a.user_id JOIN admin ad ON ad.id=ag.changed_by JOIN auth_user au ON au.id=ad.user_id WHERE ag.id=$1`,
      [id],
    )
  ).rows[0];
  if (!r) throw new AuthError("not_found", 404);
  return {
    id: r.id,
    version: r.assignment_version,
    fromPumpId: r.from_pump_id ?? null,
    toPumpId: r.pump_id,
    actor: { id: r.actor_id, code: r.admin_code, name: r.actor_name },
    reason: r.reason,
    effectiveFrom: r.effective_from.toISOString(),
    effectiveUntil: r.effective_until?.toISOString() ?? null,
    attendantId: r.attendant_id,
    staffCode: r.staff_code,
    attendantName: r.display_name,
  };
}
export async function priceEventView(
  db: pg.PoolClient,
  id: string,
  station: string,
) {
  const r = (
    await db.query(
      `SELECT v.*,v.rate_kobo::text,pr.id AS product_id,pr.code AS product_code,pr.unit,ad.admin_code,u.display_name FROM product_price_version v JOIN product pr ON pr.id=v.product_id JOIN admin ad ON ad.id=v.actor_id JOIN auth_user u ON u.id=ad.user_id WHERE v.id=$1 AND v.station_id=$2`,
      [id, station],
    )
  ).rows[0];
  if (!r) throw new AuthError("not_found", 404);
  const previous =
    (
      await db.query(
        "SELECT *,rate_kobo::text FROM product_price_version WHERE station_id=$1 AND product_id=$2 AND version<$3 ORDER BY version DESC LIMIT 1",
        [station, r.product_id, r.version],
      )
    ).rows[0] ?? null;
  return {
    id: r.id,
    product: productView(r),
    version: r.version,
    previous: priceView(previous),
    current: priceView(r),
    actor: { id: r.actor_id, code: r.admin_code, name: r.display_name },
    reason: r.reason,
  };
}
export async function audit(
  db: pg.PoolClient,
  actor: string,
  type: string,
  target: string,
  action: string,
  reason: string,
  before: unknown,
  after: unknown,
) {
  await db.query(
    `INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,"before","after",reason,occurred_at) VALUES($1,$2,'user',$3,$4,$5,$6::jsonb,$7::jsonb,$8,clock_timestamp())`,
    [
      newId(),
      actor,
      action,
      type,
      target,
      JSON.stringify(before),
      JSON.stringify(after),
      auditText(reason),
    ],
  );
}
export function cursorId(secret: string, scope: string, cursor?: string) {
  if (!cursor) return null;
  try {
    const [payload, mac, ...extra] = cursor.split(".");
    if (!payload || !mac || extra.length) throw new Error();
    const expected = hmac(secret, "station-cursor-v1", payload);
    if (
      mac.length !== expected.length ||
      !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
    )
      throw new Error();
    const value = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (
      value.scope !== hmac(secret, "station-cursor-scope-v1", scope) ||
      typeof value.id !== "string" ||
      !/^[0-9a-f-]{36}$/.test(value.id)
    )
      throw new Error();
    return value.id as string;
  } catch {
    throw new AuthError("invalid_request", 400);
  }
}
export function nextCursor(secret: string, scope: string, id: string) {
  const payload = Buffer.from(
    JSON.stringify({
      scope: hmac(secret, "station-cursor-scope-v1", scope),
      id,
    }),
  ).toString("base64url");
  return `${payload}.${hmac(secret, "station-cursor-v1", payload)}`;
}
// Display sequences are allocated under the security lock. Gaps after rollback are harmless.
export async function displayCode(
  db: pg.PoolClient,
  kind: "pump" | "attendant",
) {
  const prefix = kind === "pump" ? "PUMP" : "STAFF",
    column = kind === "pump" ? "code" : "staff_code";
  const r = (
    await db.query(
      `SELECT coalesce(max(substring(${column} from $1)::bigint),0)+1 AS next FROM ${kind} WHERE ${column} ~ $2`,
      [`^${prefix}([0-9]+)$`, `^${prefix}[0-9]{1,15}$`],
    )
  ).rows[0];
  return `${prefix}${String(r.next).padStart(kind === "pump" ? 2 : 3, "0")}`;
}

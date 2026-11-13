import type pg from "pg";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { AuthError } from "../auth/errors";
import { saleDateSchema } from "../../../shared/contracts/sales";
import {
  REPORT_LIMITS,
  reportSourceSchema,
  totalsSchema,
  type ReportFilter,
  type ReportSource,
  type Totals,
  type Report,
} from "../../../shared/contracts/reports";
import { acceptedContribution } from "./contribution";
export async function reportAuthority(
  db: pg.PoolClient,
  token: string | undefined,
  permission: "reports" | "overview" = "reports",
  write = false,
) {
  if (write) await securityLock(db);
  else await db.query("SELECT id FROM security_state WHERE id=true FOR SHARE");
  const actor = await requireAdminSession(db, token);
  requirePermission(actor, permission);
  const stations = (
    await db.query("SELECT id,timezone FROM station ORDER BY id LIMIT 2")
  ).rows;
  if (stations.length !== 1)
    throw new AuthError("temporarily_unavailable", 503);
  return { actor, station: stations[0]! };
}
export function validateFilter(f: ReportFilter) {
  if (
    f.from.startsWith("0000-") ||
    f.to.startsWith("0000-") ||
    !saleDateSchema.safeParse(f.from).success ||
    !saleDateSchema.safeParse(f.to).success
  )
    throw new AuthError("date_invalid", 422);
  const days =
    (Date.parse(f.to + "T00:00:00Z") - Date.parse(f.from + "T00:00:00Z")) /
      86400000 +
    1;
  if (days < 1) throw new AuthError("date_range_invalid", 422);
  if (days > REPORT_LIMITS.days) throw new AuthError("range_too_large", 422);
}
// One statement is the snapshot boundary for generation, all source rows and overview extras.
export async function dataset(
  db: pg.PoolClient,
  station: string,
  filters: ReportFilter,
  overview = false,
  sourceLimit: number | null = null,
): Promise<{
  sources: ReportSource[];
  asOf: string;
  dataVersion: string;
  launch_at: Date | null;
  customers: string | null;
  attention: Record<string, string>;
  recent_sales: unknown[];
  recent_customers: unknown[];
}> {
  const r = (
    await db.query(
      `WITH source AS (SELECT p.*,pr.code product,pu.code pump_code,pu.name pump_name,a.staff_code,
 r.id revision_id,coalesce(r.amount_kobo,p.amount_kobo)::text display_amount,trim_scale(coalesce(r.quantity,p.quantity))::text display_quantity,coalesce(r.currency,p.currency) display_currency,coalesce(r.unit,p.unit) display_unit,
 CASE WHEN r.id IS NOT NULL THEN r.verified_sale_date ELSE p.verified_sale_date END display_verified,
 coalesce(CASE WHEN r.id IS NOT NULL THEN r.verified_sale_date ELSE p.verified_sale_date END,(p.app_captured_at AT TIME ZONE 'Africa/Lagos')::date) sale_day,
 (${acceptedContribution}) included,
 CASE WHEN p.status='cancelled' THEN 'cancelled' WHEN p.status='held' OR EXISTS(SELECT 1 FROM purchase_hold h WHERE h.purchase_id=p.id AND h.state='open') OR EXISTS(SELECT 1 FROM purchase_validation_block b WHERE b.purchase_id=p.id AND b.resolved_at IS NULL) THEN 'held' WHEN p.status IN ('received','photo_pending','finalizing') THEN 'pending' ELSE 'ineligible' END excluded,
 EXISTS(SELECT 1 FROM duplicate_flag f WHERE (f.purchase_id=p.id OR f.other_purchase_id=p.id) AND f.state='open') duplicate,
 EXISTS(SELECT 1 FROM correction_request cr WHERE cr.purchase_id=p.id AND cr.state IN ('pending_validation','awaiting_review')) correction_pending
 FROM purchase p JOIN attendant a ON a.id=p.originating_attendant_id JOIN pump pu ON pu.id=p.pump_id JOIN product pr ON pr.id=p.product_id LEFT JOIN purchase_revision r ON r.id=p.current_revision_id AND r.purchase_id=p.id AND r.state='accepted' WHERE p.station_id=$1), filtered AS (SELECT * FROM source WHERE sale_day BETWEEN CASE WHEN $5 THEN (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date ELSE $2::date END AND CASE WHEN $5 THEN (statement_timestamp() AT TIME ZONE 'Africa/Lagos')::date ELSE $3::date END AND ($4::text IS NULL OR product=$4))
 SELECT statement_timestamp() AS at,coalesce((SELECT data_version::text FROM station_reporting_state WHERE station_id=$1),'0') version,
 coalesce((SELECT jsonb_agg(jsonb_build_object('purchaseId',id,'saleCode',sale_code,'revisionId',revision_id,'saleDate',sale_day::text,'dateEvidence',CASE WHEN display_verified IS NULL THEN 'reported' ELSE 'verified' END,'appCapturedAt',app_captured_at,'verifiedSaleDate',display_verified::text,'serverReceivedAt',server_received_at,'attendant',jsonb_build_object('id',originating_attendant_id,'staffCode',staff_code,'name',seller_name,'username',seller_username),'pump',jsonb_build_object('id',pump_id,'code',pump_code,'name',pump_name),'product',product,'unit',display_unit,'amountKobo',display_amount,'currency',display_currency,'quantity',display_quantity,'state',status,'included',included,'exclusion',CASE WHEN included THEN NULL ELSE excluded END,'valuesSource',CASE WHEN revision_id IS NULL THEN 'original' ELSE 'accepted_revision' END,'duplicateFlag',duplicate,'correctionPending',correction_pending) ORDER BY server_received_at DESC,id DESC) FROM (SELECT * FROM filtered ORDER BY server_received_at DESC,id DESC LIMIT $6) bounded),'[]') sources,
 CASE WHEN $5 THEN (SELECT launch_at FROM station_reporting_state WHERE station_id=$1) ELSE NULL END launch_at,
 CASE WHEN $5 THEN (SELECT count(*)::text FROM customer c WHERE c.registered_station_id=$1 AND c.created_at >= (SELECT launch_at FROM station_reporting_state WHERE station_id=$1)) ELSE NULL END customers,
 CASE WHEN $5 THEN jsonb_build_object('late_correction',(SELECT count(*)::text FROM source s WHERE EXISTS(SELECT 1 FROM correction_request cr WHERE cr.purchase_id=s.id AND cr.state='awaiting_review')),'incomplete',(SELECT count(*)::text FROM source WHERE status IN ('received','photo_pending','finalizing')),'duplicate',(SELECT count(*)::text FROM source WHERE duplicate)) ELSE NULL END attention,
 CASE WHEN $5 THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'saleCode',s.sale_code,'customerName',c.name,'receivedAt',s.server_received_at,'attendantName',s.seller_name,'username',s.seller_username,'pumpCode',s.pump_code,'state',s.status,'duplicateFlag',s.duplicate,'correctionPending',s.correction_pending,'amountKobo',s.display_amount,'currency',s.display_currency) ORDER BY s.server_received_at DESC,s.id DESC) FROM (SELECT * FROM source ORDER BY server_received_at DESC,id DESC LIMIT 5) s LEFT JOIN customer c ON c.id=s.customer_id),'[]') ELSE NULL END recent_sales,
 CASE WHEN $5 THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'customerCode',c.customer_code,'name',c.name,'category',c.category,'createdAt',c.created_at) ORDER BY c.created_at DESC,c.id DESC) FROM (SELECT * FROM customer WHERE registered_station_id=$1 ORDER BY created_at DESC,id DESC LIMIT 5)c),'[]') ELSE NULL END recent_customers`,
      [
        station,
        filters.from,
        filters.to,
        filters.product,
        overview,
        sourceLimit,
      ],
    )
  ).rows[0]!;
  return {
    ...r,
    sources: z.array(reportSourceSchema).parse(r.sources),
    asOf: (r.at as Date).toISOString(),
    dataVersion: r.version as string,
  };
}
const scaled = (v: string) => {
  const [a, b = ""] = v.split(".");
  return BigInt(a!) * 1000000n + BigInt(b.padEnd(6, "0"));
};
const decimal = (v: bigint) => {
  const s = v.toString().padStart(7, "0");
  return (s.slice(0, -6) + "." + s.slice(-6))
    .replace(/0+$/, "")
    .replace(/\.$/, "");
};
export function totals(rows: ReportSource[]): Totals {
  const money = new Map<string, bigint>(),
    products = new Map<
      string,
      {
        product: ReportSource["product"];
        unit: ReportSource["unit"];
        value: bigint;
      }
    >();
  let litres = 0n,
    kilograms = 0n;
  for (const r of rows) {
    money.set(r.currency, (money.get(r.currency) ?? 0n) + BigInt(r.amountKobo));
    const q = scaled(r.quantity);
    if (r.unit === "litre") litres += q;
    else kilograms += q;
    const key = r.product + ":" + r.unit;
    products.set(key, {
      product: r.product,
      unit: r.unit,
      value: (products.get(key)?.value ?? 0n) + q,
    });
  }
  const value = {
    purchases: String(rows.length),
    spend: [...money]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, value]) => ({ currency, amountKobo: String(value) })),
    litres: decimal(litres),
    kilograms: decimal(kilograms),
    products: [...products.values()]
      .sort((a, b) => a.product.localeCompare(b.product))
      .map((p) => ({
        product: p.product,
        unit: p.unit,
        quantity: decimal(p.value),
      })),
  };
  const parsed = totalsSchema.safeParse(value);
  if (!parsed.success) throw new AuthError("aggregate_overflow", 422);
  return parsed.data;
}
export function reportFromRows(
  filters: ReportFilter,
  asOf: string,
  dataVersion: string,
  rows: ReportSource[],
): Report {
  const included = rows.filter((r) => r.included),
    groups = new Map<string, ReportSource[]>(),
    days = new Map<string, ReportSource[]>();
  for (const r of included) {
    const key =
      filters.groupBy === "product"
        ? r.product
        : filters.groupBy === "attendant"
          ? r.attendant.id
          : r.pump.id;
    const group = groups.get(key) ?? [];
    group.push(r);
    groups.set(key, group);
    const day = days.get(r.saleDate) ?? [];
    day.push(r);
    days.set(r.saleDate, day);
  }
  const summary = totals(included);
  const items = [...groups].map(([key, rs]) => {
    const latest = [...rs].sort(
      (a, b) =>
        b.appCapturedAt.localeCompare(a.appCapturedAt) ||
        b.purchaseId.localeCompare(a.purchaseId),
    )[0]!;
    return {
      key,
      product: filters.groupBy === "product" ? latest.product : null,
      attendant: filters.groupBy === "attendant" ? latest.attendant : null,
      pump:
        filters.groupBy === "pump"
          ? { ...latest.pump, product: latest.product }
          : null,
      totals: totals(rs),
    };
  });
  items.sort((a, b) => {
    if (summary.spend.length === 1) {
      const av = BigInt(a.totals.spend[0]?.amountKobo ?? "0"),
        bv = BigInt(b.totals.spend[0]?.amountKobo ?? "0");
      if (av !== bv) return av > bv ? -1 : 1;
    }
    return a.key.localeCompare(b.key);
  });
  return {
    filters,
    asOf,
    timezone: "Africa/Lagos",
    dataVersion,
    totals: summary,
    excluded: (["cancelled", "held", "pending", "ineligible"] as const).map(
      (state) => {
        const rs = rows.filter((r) => r.exclusion === state);
        return { state, records: String(rs.length), spend: totals(rs).spend };
      },
    ),
    daily: [...days]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, rs]) => ({ day, totals: totals(rs) })),
    groups: { items, nextCursor: null },
    dateBasis: "verified_or_reported_sale_date",
  };
}
const cursorSchema = z.strictObject({
  scope: z.string(),
  version: z.string(),
  offset: z.number().int().min(0),
});
export function page<T>(
  items: T[],
  limit: number,
  secret: string,
  scope: string,
  version: string,
  cursor?: string,
) {
  let offset = 0;
  if (cursor) {
    try {
      const [payload, sig, ...rest] = cursor.split(".");
      if (!payload || !sig || rest.length) throw new Error();
      const expected = createHmac("sha256", secret).update(payload).digest(),
        actual = Buffer.from(sig, "base64url");
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Error();
      const p = cursorSchema.parse(
        JSON.parse(Buffer.from(payload, "base64url").toString()),
      );
      if (p.scope !== scope) throw new Error();
      if (p.version !== version) throw new AuthError("read_view_stale", 409);
      offset = p.offset;
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new AuthError("invalid_request", 400);
    }
  }
  const end = offset + limit,
    payload = Buffer.from(
      JSON.stringify({ scope, version, offset: end }),
    ).toString("base64url");
  return {
    items: items.slice(offset, end),
    nextCursor:
      end < items.length
        ? payload +
          "." +
          createHmac("sha256", secret).update(payload).digest("base64url")
        : null,
  };
}

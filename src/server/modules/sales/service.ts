import type pg from "pg";
import { z } from "zod";
import {
  requireSession,
  requireAdminSession,
  requirePermission,
} from "../../lib/authz";
import { digest } from "../auth/crypto";
import { AuthError } from "../auth/errors";
import { transaction } from "../admin-access/repo";
import type { AdminConfig } from "../admin-access/config";
import * as wire from "../../../shared/contracts/sales";
import { authId } from "../../../shared/contracts/auth";
import { decodeCursor, encodeCursor } from "./cursor";
import * as sql from "./projections";
import { reliableCutoff } from "../corrections/time";
export type Audience = "attendant" | "admin";
export type ReadAction = "list" | "search" | "detail" | "history";
export async function salesAuthority(
  db: pg.PoolClient,
  token: string | undefined,
  audience: Audience,
) {
  // Acquire authority boundary before the statement that observes authority. An
  // established REPEATABLE READ snapshot before this lock would permit stale grants.
  await db.query("SELECT id FROM security_state WHERE id=true FOR SHARE");
  const identity = (
    await db.query<{ kind: string }>(
      `SELECT u.kind FROM auth_session s JOIN auth_user u ON u.id=s.user_id WHERE s.secret_verifier=$1`,
      [digest(token ?? "")],
    )
  ).rows[0];
  if (identity && identity.kind !== audience)
    throw new AuthError("permission_denied", 403);
  if (audience === "admin") {
    const actor = await requireAdminSession(db, token);
    requirePermission(actor, "sales");
    const stations = (
      await db.query<{ id: string }>(
        "SELECT id FROM station ORDER BY id LIMIT 2",
      )
    ).rows;
    if (stations.length !== 1)
      throw new AuthError("temporarily_unavailable", 503);
    return {
      userId: actor.user_id,
      stationId: stations[0]!.id,
      attendantId: null,
    };
  }
  const actor = await requireSession(db, digest(token ?? ""));
  const scope = (
    await db.query<{ id: string; station_id: string }>(
      `SELECT a.id,p.station_id FROM attendant a JOIN capture_context c ON c.attendant_id=a.id JOIN assignment ag ON ag.id=c.assignment_id JOIN pump p ON p.id=ag.pump_id WHERE a.user_id=$1 AND c.id=$2`,
      [actor.user_id, actor.capture_context_id],
    )
  ).rows[0];
  if (!scope) throw new AuthError("permission_denied", 403);
  return {
    userId: actor.user_id,
    stationId: scope.station_id,
    attendantId: scope.id,
  };
}
const bundle = z.strictObject({
  data: z.unknown(),
  at: z.string(),
  id: authId,
});
const bundles = z.array(bundle);
function historyDefinition(kind: string, own: boolean) {
  switch (kind) {
    case "revisions":
      return {
        from: "purchase_revision r",
        at: "r.server_received_at",
        id: "r.id",
        where: "r.purchase_id=p.id",
        projection: sql.revision(own),
        schema: own ? wire.attendantRevisionSchema : wire.revisionSchema,
      };
    case "corrections":
      return {
        from: "correction_request cr JOIN purchase_revision r ON r.id=cr.proposed_revision_id AND r.purchase_id=cr.purchase_id",
        at: "cr.first_received_at",
        id: "cr.id",
        where: `cr.purchase_id=p.id${own ? " AND cr.authorship='authenticated_attendant'" : ""}`,
        projection: sql.correction(own),
        schema: own ? wire.attendantCorrectionSchema : wire.correctionSchema,
      };
    case "decisions":
      return {
        from: "sale_decision d",
        at: "d.decided_at",
        id: "d.id",
        where: "d.purchase_id=p.id",
        projection: sql.decision(own),
        schema: own ? wire.attendantDecisionSchema : wire.decisionSchema,
      };
    case "duplicateFlags":
      return {
        from: "duplicate_flag f",
        at: "f.created_at",
        id: "f.id",
        where: "(f.purchase_id=p.id OR f.other_purchase_id=p.id)",
        projection:
          "jsonb_build_object('id',f.id,'version',f.version,'purchaseIds',jsonb_build_array(f.purchase_id,f.other_purchase_id),'state',f.state,'reason',f.reason,'cancelledPurchaseId',NULL)",
        schema: wire.duplicateFlagSchema,
      };
    default:
      throw new AuthError("invalid_request", 400);
  }
}
function historySql(kind: string, own: boolean, limit: number, cursor = false) {
  const d = historyDefinition(kind, own);
  return `(SELECT coalesce(jsonb_agg(q.item ORDER BY q.at DESC,q.id DESC),'[]'::jsonb) FROM (SELECT jsonb_build_object('data',${d.projection},'at',${d.at},'id',${d.id}) item,${d.at} at,${d.id} id FROM ${d.from} WHERE ${d.where} ${cursor ? `AND ($4::timestamptz IS NULL OR (${d.at},${d.id})<($4::timestamptz,$5::uuid))` : ""} ORDER BY ${d.at} DESC,${d.id} DESC LIMIT ${limit + 1}) q)`;
}
function pageItems(
  raw: unknown,
  kind: string,
  own: boolean,
  limit: number,
  secret: string,
  scope: string,
) {
  const rows = bundles.parse(raw),
    more = rows.length > limit,
    selected = rows.slice(0, limit),
    last = selected.at(-1);
  const schema = historyDefinition(kind, own).schema;
  return {
    items: selected.map((r) => schema.parse(r.data)),
    nextCursor:
      more && last ? encodeCursor(secret, scope, last.at, last.id) : null,
  };
}
export async function readSales(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  audience: Audience,
  action: ReadAction,
  input: unknown = {},
  purchaseId?: string,
) {
  const own = audience === "attendant";
  if (
    action === "search" &&
    typeof input === "object" &&
    input !== null &&
    "day" in input &&
    input.day !== undefined &&
    !wire.saleDateSchema.safeParse(input.day).success
  )
    throw new AuthError("date_invalid", 422);
  if (purchaseId) authId.parse(purchaseId);
  const parsed =
    action === "detail"
      ? {}
      : action === "history"
        ? (own
            ? wire.attendantHistoryInputSchema
            : wire.saleHistoryInputSchema
          ).parse(input)
        : action === "search"
          ? wire.saleFilterSchema.parse(input)
          : wire.salePageInputSchema.parse(input);
  return transaction(pool, async (db) => {
    const actor = await salesAuthority(db, token, audience);
    const scope = JSON.stringify([
      audience,
      actor.userId,
      actor.stationId,
      actor.attendantId,
      action,
      purchaseId ?? null,
      { ...parsed, cursor: undefined },
    ]);
    const position = decodeCursor(
      config.secret,
      scope,
      "cursor" in parsed ? z.string().parse(parsed.cursor) : undefined,
    );
    const params: unknown[] = [
      actor.stationId,
      actor.attendantId,
      purchaseId ?? null,
      position?.at ?? null,
      position?.id ?? null,
    ];
    const where =
      "p.station_id=$1 AND ($2::uuid IS NULL OR p.originating_attendant_id=$2) AND ($3::uuid IS NULL OR p.id=$3)";
    if (action === "history") {
      const historyInput = (
        own ? wire.attendantHistoryInputSchema : wire.saleHistoryInputSchema
      ).parse(input);
      const result = (
        await db.query<{ items: unknown }>(
          `SELECT ${historySql(historyInput.kind, own, historyInput.limit, true)} items FROM purchase p ${sql.joins} JOIN capture_context ctx ON ctx.id=p.capture_context_id WHERE ${where} AND p.id=$3`,
          params,
        )
      ).rows[0];
      if (!result) throw new AuthError("not_found", 404);
      return pageItems(
        result.items,
        historyInput.kind,
        own,
        historyInput.limit,
        config.secret,
        scope,
      );
    }
    if (action === "detail") {
      const kinds = own
        ? ["revisions", "corrections", "decisions"]
        : ["revisions", "corrections", "decisions", "duplicateFlags"];
      const result = (
        await db.query<Record<string, unknown>>(
          `SELECT ${sql.row(own)} data,${sql.values("p", true)} original,
   p.correction_cutoff_at,p.correction_date_reliable,p.correction_time_policy_version,p.status,p.current_revision_id,r.calculation_mode,ctx.signed_in_at,ctx.offline_expires_at,p.server_received_at,
   (SELECT jsonb_build_object('assetId',ph.id,'state',CASE WHEN ph.deleted_at IS NOT NULL OR ph.state='deleted' THEN 'deleted' WHEN ph.state='validated' THEN 'validated' ELSE 'pending' END,'sha256',ph.validated_digest,'validatedAt',ph.validated_at) FROM photo_asset ph WHERE ph.purchase_id=p.id ORDER BY (ph.state='validated') DESC,ph.created_at DESC,ph.id DESC LIMIT 1) evidence,
   ${kinds.map((k) => `${historySql(k, own, 25)} "${k}"`).join(",")},
   ${own ? "NULL" : "(SELECT " + priceJson() + " FROM product_price_version v WHERE v.id=p.price_version_id AND v.station_id=p.station_id)"} price_reference,
   clock_timestamp() now FROM purchase p ${sql.joins} JOIN capture_context ctx ON ctx.id=p.capture_context_id WHERE ${where} AND p.id=$3`,
          params.slice(0, 3),
        )
      ).rows[0];
      if (!result) throw new AuthError("not_found", 404);
      const data = z.record(z.string(), z.unknown()).parse(result.data);
      const history: Record<string, unknown> = {},
        cursors: Record<string, string | null> = {};
      for (const kind of kinds) {
        const hs = JSON.stringify([
          audience,
          actor.userId,
          actor.stationId,
          actor.attendantId,
          "history",
          purchaseId,
          { limit: 25, kind },
        ]);
        const page = pageItems(result[kind], kind, own, 25, config.secret, hs);
        history[kind] = page.items;
        cursors[kind] = page.nextCursor;
      }
      const derivedCutoff = result.correction_time_policy_version
        ? result.correction_cutoff_at
        : reliableCutoff(
            result.signed_in_at as Date,
            result.server_received_at as Date,
            result.offline_expires_at as Date,
          );
      const cutoff =
        derivedCutoff instanceof Date ? derivedCutoff.toISOString() : null;
      const unavailable =
        result.status === "cancelled" ||
        !result.current_revision_id ||
        result.calculation_mode === "meter_evidence" ||
        !wire.evidenceSchema.safeParse(result.evidence).success ||
        wire.evidenceSchema.parse(result.evidence).state !== "validated";
      const past =
        !!cutoff &&
        (result.now as Date).getTime() >= new Date(cutoff).getTime();
      const detail = {
        ...data,
        original: result.original,
        evidence: result.evidence ?? {
          assetId: null,
          state: "missing",
          sha256: null,
          validatedAt: null,
        },
        correctionWindow: {
          cutoff,
          automaticEligible: !unavailable && !!cutoff && !past,
          reason: unavailable
            ? "sale_unavailable"
            : !cutoff
              ? "date_unresolved"
              : past
                ? "midnight_passed"
                : "open",
        },
        ...history,
        historyCursors: cursors,
        ...(own
          ? {}
          : { replacement: null, priceReference: result.price_reference }),
      };
      return (
        own ? wire.attendantSaleDetailSchema : wire.saleDetailSchema
      ).parse(detail);
    }
    const filter = wire.saleFilterSchema.parse(parsed),
      limit = filter.limit;
    params.push(
      filter.query ?? null,
      filter.customerId ?? null,
      filter.status ?? "all",
      filter.day ?? null,
      limit + 1,
    );
    const filtered = `${where} AND ($6::text IS NULL OR c.name ILIKE '%'||$6||'%' OR p.card_code ILIKE '%'||$6||'%' OR p.sale_code ILIKE '%'||$6||'%' OR p.seller_name ILIKE '%'||$6||'%' OR p.seller_username ILIKE '%'||$6||'%' OR a.staff_code ILIKE '%'||$6||'%') AND ($7::uuid IS NULL OR p.customer_id=$7) AND ($9::date IS NULL OR coalesce(p.verified_sale_date,(p.app_captured_at AT TIME ZONE 'Africa/Lagos')::date)=$9) AND (
   $8='all' OR ($8='completed' AND p.status='credited' AND r.id IS NOT NULL) OR ($8='incomplete' AND p.status IN ('received','photo_pending','finalizing')) OR ($8='cancelled' AND p.status='cancelled') OR ($8='duplicate' AND EXISTS(SELECT 1 FROM duplicate_flag f WHERE (f.purchase_id=p.id OR f.other_purchase_id=p.id) AND f.state='open')) OR ($8='late_correction' AND EXISTS(SELECT 1 FROM correction_request cr WHERE cr.purchase_id=p.id AND cr.state='awaiting_review')) OR ($8 IN ('price_review','card_review','date_review') AND EXISTS(SELECT 1 FROM purchase_hold h WHERE h.purchase_id=p.id AND h.state='open' AND h.kind=split_part($8,'_',1))) OR ($8='policy_review' AND (EXISTS(SELECT 1 FROM purchase_validation_block b WHERE b.purchase_id=p.id AND b.resolved_at IS NULL) OR EXISTS(SELECT 1 FROM correction_request cr WHERE cr.purchase_id=p.id AND cr.state IN ('pending_validation','awaiting_review') AND cardinality(cr.policy_blocks)>0))))`;
    const result = (
      await db.query<{ items: unknown; summary: unknown; as_of: Date }>(
        `WITH filtered AS MATERIALIZED (SELECT p.id,p.server_received_at,${sql.row(own)} data,p.status='credited' AND r.id IS NOT NULL credited,r.amount_kobo,r.quantity,r.currency,r.unit,pr.code product FROM purchase p ${sql.joins} WHERE ${filtered}), paged AS (SELECT * FROM filtered WHERE ($4::timestamptz IS NULL OR (server_received_at,id)<($4::timestamptz,$5::uuid)) ORDER BY server_received_at DESC,id DESC LIMIT $10)
   SELECT (SELECT coalesce(jsonb_agg(jsonb_build_object('data',data,'id',id,'at',server_received_at) ORDER BY server_received_at DESC,id DESC),'[]') FROM paged) items,
   jsonb_build_object('records',(SELECT count(*)::text FROM filtered),'completed',(SELECT count(*)::text FROM filtered WHERE credited),'spend',(SELECT coalesce(jsonb_agg(jsonb_build_object('currency',currency,'amountKobo',amount::text)),'[]') FROM (SELECT currency,sum(amount_kobo) amount FROM filtered WHERE credited GROUP BY currency) s),'quantities',(SELECT coalesce(jsonb_agg(jsonb_build_object('product',product,'unit',unit,'quantity',trim_scale(quantity)::text)),'[]') FROM (SELECT product,unit,sum(quantity) quantity FROM filtered WHERE credited GROUP BY product,unit) q)) summary,statement_timestamp() as_of`,
        params,
      )
    ).rows[0]!;
    const rows = bundles.parse(result.items),
      selected = rows.slice(0, limit),
      last = selected.at(-1);
    const page = {
      items: selected.map((r) =>
        (own ? wire.attendantSaleRowSchema : wire.saleRowSchema).parse(r.data),
      ),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor(config.secret, scope, last.at, last.id)
          : null,
    };
    return own
      ? wire.attendantSalePageSchema.parse(page)
      : wire.salePageSchema.parse({
          ...page,
          asOf: result.as_of.toISOString(),
          summary: result.summary,
        });
  });
}
function priceJson() {
  return `jsonb_build_object('priceVersionId',v.id,'version',v.version,'rateKobo',v.rate_kobo::text,'currency',v.currency,'quantityPrecision',v.quantity_precision,'effectiveFrom',v.effective_from,'fetchedAt',statement_timestamp())`;
}

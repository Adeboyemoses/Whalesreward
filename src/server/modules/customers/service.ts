import type pg from "pg";
import {
  registrationSchema,
  phoneLookupSchema,
  customerSearchSchema,
  registrationReceiptSchema,
  customerLookupSchema,
  customerSummarySchema,
  customerProfileSchema,
} from "../../../shared/contracts/customers-cards";
import { pageSchema } from "../../../shared/contracts/admin";
import {
  requireSession,
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { newId } from "../../lib/ids";
import { digest } from "../auth/crypto";
import { AuthError } from "../auth/errors";
import { transaction, receipt } from "../admin-access/repo";
import type { AdminConfig } from "../admin-access/config";
import { phoneNormalizer, type PhoneNormalizer } from "../../adapters/phone";
import { audit, cursorId, nextCursor, stationId } from "../station/repo";

async function attendant(db: pg.PoolClient, token: string | undefined) {
  const session = await requireSession(db, digest(token ?? ""));
  const r = (
    await db.query(
      `SELECT a.id,a.staff_code,u.display_name,p.station_id,st.name AS station_name,c.offline_expires_at>clock_timestamp() AS online,c.assignment_id=ag.id AS fresh FROM attendant a JOIN auth_user u ON u.id=a.user_id JOIN assignment ag ON ag.attendant_id=a.id AND ag.effective_until IS NULL AND ag.effective_from<=clock_timestamp() JOIN pump p ON p.id=ag.pump_id AND p.enabled JOIN station st ON st.id=p.station_id JOIN capture_context c ON c.id=$2 AND c.attendant_id=a.id AND c.revoked_at IS NULL WHERE a.user_id=$1`,
      [session.user_id, session.capture_context_id],
    )
  ).rows[0];
  if (!r) throw new AuthError("assignment_unavailable", 422);
  if (!r.online) throw new AuthError("online_sign_in_required", 403);
  if (!r.fresh) throw new AuthError("fresh_sign_in_required", 403);
  return { ...r, user_id: session.user_id };
}
export async function registerCustomer(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  input: unknown,
  normalizer: PhoneNormalizer = phoneNormalizer(),
) {
  const parsed = registrationSchema.parse(input),
    phone = normalizer.normalize(parsed.phone),
    code = parsed.card.source === "code" ? parsed.card.code : parsed.card.qr;
  const canonical = { ...parsed, phone, card: { code } };
  try {
    return await transaction(pool, async (db) => {
      await securityLock(db);
      const actor = await attendant(db, token);
      const replayed =
        (
          await db.query(
            "SELECT 1 FROM mutation_receipt WHERE actor_user_id=$1 AND operation_kind='customer-register' AND operation_id=$2",
            [actor.user_id, parsed.operationId],
          )
        ).rowCount === 1;
      const data = await receipt(
        db,
        config,
        actor,
        "customer-register",
        canonical,
        async () => {
          const batch = (
            await db.query(
              "SELECT b.* FROM card_batch b JOIN card c ON c.batch_id=b.id WHERE c.code=$1 FOR UPDATE OF b",
              [code],
            )
          ).rows[0];
          if (!batch || batch.status !== "active")
            throw new AuthError("card_unavailable", 409);
          const card = (
            await db.query("SELECT * FROM card WHERE code=$1 FOR UPDATE", [
              code,
            ])
          ).rows[0];
          if (
            card.state !== "unassigned" ||
            card.retired_at !== null ||
            (
              await db.query(
                "SELECT 1 FROM card_customer_link WHERE card_id=$1",
                [card.id],
              )
            ).rowCount
          )
            throw new AuthError("card_unavailable", 409);
          const id = newId();
          const seq = (
            await db.query(
              "SELECT coalesce(max(substring(customer_code from '^CUST([0-9]+)$')::bigint),0)+1 AS n FROM customer WHERE customer_code ~ '^CUST[0-9]{1,15}$'",
            )
          ).rows[0].n;
          const customerCode = `CUST${String(seq).padStart(3, "0")}`;
          const r = (
            await db.query(
              "INSERT INTO customer(id,customer_code,name,phone_normalized,category,version,registered_station_id,registered_by_user_id) VALUES($1,$2,$3,$4,$5,1,$6,$7) RETURNING created_at",
              [
                id,
                customerCode,
                parsed.name,
                phone,
                parsed.category,
                actor.station_id,
                actor.user_id,
              ],
            )
          ).rows[0];
          const claim = await db.query(
            "UPDATE card SET state='linked',version=version+1 WHERE id=$1 AND state='unassigned' AND version=$2 AND retired_at IS NULL",
            [card.id, card.version],
          );
          if (claim.rowCount !== 1)
            throw new AuthError("card_unavailable", 409);
          await db.query(
            "INSERT INTO card_customer_link(id,card_id,customer_id,linked_at,actor_user_id,reason) VALUES($1,$2,$3,$4,$5,'Customer registration')",
            [newId(), card.id, id, r.created_at, actor.user_id],
          );
          await audit(
            db,
            actor.user_id,
            "customer",
            id,
            "customer_registered",
            "Customer registration",
            null,
            {
              customerCode,
              category: parsed.category,
              cardId: card.id,
              stationId: actor.station_id,
            },
            {
              operationId: parsed.operationId,
              occurredAt: r.created_at.toISOString(),
            },
          );
          return registrationReceiptSchema.parse({
            operationId: parsed.operationId,
            customer: {
              id,
              customerCode,
              name: parsed.name,
              category: parsed.category,
              phone,
            },
            cardCode: code,
            registeredAt: r.created_at.toISOString(),
            registeredAtStation: {
              id: actor.station_id,
              name: actor.station_name,
            },
            registeredBy: {
              id: actor.id,
              code: actor.staff_code,
              name: actor.display_name,
            },
          });
        },
      );
      return { data, replayed };
    });
  } catch (e) {
    const error = e as { code?: string; constraint?: string };
    if (error.code === "23505" && error.constraint === "uq_customer_phone")
      throw new AuthError("phone_in_use", 409);
    if (
      error.code === "23505" &&
      error.constraint === "uq_card_customer_link_card_id"
    )
      throw new AuthError("card_unavailable", 409);
    throw e;
  }
}
export async function lookupCustomer(
  pool: pg.Pool,
  token: string | undefined,
  input: unknown,
  normalizer: PhoneNormalizer = phoneNormalizer(),
) {
  const phone = normalizer.normalize(phoneLookupSchema.parse(input).phone);
  return transaction(pool, async (db) => {
    await securityLock(db);
    await attendant(db, token);
    const r = (
      await db.query(
        `SELECT c.*,card.code,card.state,b.status,clock_timestamp() AS looked_up_at FROM customer c LEFT JOIN card_customer_link l ON l.customer_id=c.id AND l.ended_at IS NULL LEFT JOIN card ON card.id=l.card_id LEFT JOIN card_batch b ON b.id=card.batch_id WHERE c.phone_normalized=$1`,
        [phone],
      )
    ).rows[0];
    if (!r) throw new AuthError("customer_not_found", 404);
    return customerLookupSchema.parse({
      customer: {
        id: r.id,
        customerCode: r.customer_code,
        name: r.name,
        category: r.category,
      },
      cardCode: r.code ?? null,
      cardUsable: r.state === "linked" && r.status === "active",
      lookedUpAt: r.looked_up_at.toISOString(),
    });
  });
}
// All-time credit is current accepted revision, independent of campaign eligibility.
const contribution = `p.status='credited' AND r.state='accepted' AND NOT EXISTS(SELECT 1 FROM purchase_hold h WHERE h.purchase_id=p.id AND h.state='open')`;
async function summary(db: pg.PoolClient, id: string, station: string) {
  const r = (
    await db.query(
      `SELECT c.*, (SELECT card.code FROM card_customer_link l JOIN card ON card.id=l.card_id JOIN card_batch b ON b.id=card.batch_id WHERE l.customer_id=c.id AND l.ended_at IS NULL AND card.state='linked' AND b.status='active') AS active_code,coalesce((SELECT sum(r.amount_kobo)::text FROM purchase p JOIN purchase_revision r ON r.id=p.current_revision_id WHERE p.customer_id=c.id AND p.station_id=$2 AND ${contribution}),'0') AS spend,(SELECT count(*)::text FROM purchase p JOIN purchase_revision r ON r.id=p.current_revision_id WHERE p.customer_id=c.id AND p.station_id=$2 AND ${contribution}) AS completed FROM customer c WHERE c.id=$1 AND (c.registered_station_id=$2 OR c.registered_station_id IS NULL)`,
      [id, station],
    )
  ).rows[0];
  if (!r) throw new AuthError("not_found", 404);
  return {
    row: r,
    view: customerSummarySchema.parse({
      id: r.id,
      customerCode: r.customer_code,
      name: r.name,
      phoneMasked: `•••• ${r.phone_normalized.slice(-4)}`,
      category: r.category,
      activeCardCode: r.active_code ?? null,
      registeredAt: r.created_at.toISOString(),
      recordedSpendKobo: r.spend,
      currency: "NGN",
      completedPurchaseCount: r.completed,
    }),
  };
}
export async function customerRead(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  action: string,
  input: unknown = {},
  targetId?: string,
) {
  return transaction(pool, async (db) => {
    // Access lock precedes a repeatable snapshot. Profile queries remain consistent while sales mutate.
    await securityLock(db);
    const actor = await requireAdminSession(db, token);
    requirePermission(actor, "customers");
    if (action === "purchases") requirePermission(actor, "sales");
    const station = await stationId(db);
    // One explicit transaction-local materialized dataset feeds profile totals below.
    if (action === "profile") {
      // Customer/profile reads share one PostgreSQL statement snapshot via an aggregate query.
      const result = await db.query(
        `SELECT c.id,to_jsonb(c) AS customer,st.name AS station_name,u.display_name,a.id AS actor_id,a.staff_code,ad.id AS admin_id,ad.admin_code,(SELECT card.code FROM card_customer_link l JOIN card ON card.id=l.card_id JOIN card_batch b ON b.id=card.batch_id WHERE l.customer_id=c.id AND l.ended_at IS NULL AND card.state='linked' AND b.status='active') AS active_code,coalesce(t.spend,'0') AS spend,coalesce(t.completed,'0') AS completed,coalesce(t.pending_amount,'0') AS pending_amount,coalesce(t.pending_count,'0') AS pending_count,coalesce(q.quantities,'[]'::jsonb) AS quantities FROM customer c LEFT JOIN station st ON st.id=c.registered_station_id LEFT JOIN auth_user u ON u.id=c.registered_by_user_id LEFT JOIN attendant a ON a.user_id=u.id LEFT JOIN admin ad ON ad.user_id=u.id LEFT JOIN LATERAL(SELECT sum(r.amount_kobo) FILTER(WHERE ${contribution})::text AS spend,count(*) FILTER(WHERE ${contribution})::text AS completed,sum(p.amount_kobo) FILTER(WHERE p.status IN('received','photo_pending','finalizing'))::text AS pending_amount,count(*) FILTER(WHERE p.status IN('received','photo_pending','finalizing'))::text AS pending_count FROM purchase p LEFT JOIN purchase_revision r ON r.id=p.current_revision_id WHERE p.customer_id=c.id AND p.station_id=$2) t ON true LEFT JOIN LATERAL(SELECT jsonb_agg(x) AS quantities FROM (SELECT pr.code AS product,r.unit,sum(r.quantity)::text AS quantity FROM purchase p JOIN purchase_revision r ON r.id=p.current_revision_id JOIN product pr ON pr.id=p.product_id WHERE p.customer_id=c.id AND p.station_id=$2 AND ${contribution} GROUP BY pr.code,r.unit ORDER BY pr.code,r.unit) x) q ON true WHERE c.id=$1 AND(c.registered_station_id=$2 OR c.registered_station_id IS NULL)`,
        [targetId, station],
      );
      const v = result.rows[0];
      if (!v) throw new AuthError("not_found", 404);
      const c = v.customer;
      return customerProfileSchema.parse({
        id: c.id,
        customerCode: c.customer_code,
        name: c.name,
        phoneMasked: `•••• ${c.phone_normalized.slice(-4)}`,
        category: c.category,
        activeCardCode: v.active_code ?? null,
        registeredAt: new Date(c.created_at).toISOString(),
        recordedSpendKobo: v.spend,
        currency: "NGN",
        completedPurchaseCount: v.completed,
        version: c.version,
        registeredAtStation: c.registered_station_id
          ? { id: c.registered_station_id, name: v.station_name }
          : null,
        registeredBy: c.registered_by_user_id
          ? {
              id: v.actor_id ?? v.admin_id,
              code: v.staff_code ?? v.admin_code,
              name: v.display_name,
            }
          : null,
        pending: { amountKobo: v.pending_amount, count: v.pending_count },
        quantities: v.quantities,
      });
    }
    const parsed =
      action === "search"
        ? customerSearchSchema.parse(input)
        : pageSchema.parse(input);
    const query = "query" in parsed ? parsed.query : undefined,
      category = "category" in parsed ? parsed.category : undefined;
    const scope = JSON.stringify([
        actor.user_id,
        station,
        action,
        targetId ?? null,
        query ?? null,
        category ?? null,
      ]),
      cursor = cursorId(config.secret, scope, parsed.cursor),
      limit = parsed.limit ?? 25;
    if (action === "search") {
      const ids = (
        await db.query(
          `SELECT c.id FROM customer c WHERE (c.registered_station_id=$1 OR c.registered_station_id IS NULL) AND ($2::text IS NULL OR strpos(lower(c.name),lower($2))>0 OR c.phone_normalized=$2 OR (length($2)=4 AND right(c.phone_normalized,4)=$2) OR upper(c.customer_code)=upper($2) OR EXISTS(SELECT 1 FROM card_customer_link l JOIN card ON card.id=l.card_id WHERE l.customer_id=c.id AND card.code=upper(btrim($2)))) AND($3::text IS NULL OR c.category=$3) AND($4::uuid IS NULL OR(c.created_at,c.id)<(SELECT created_at,id FROM customer WHERE id=$4)) ORDER BY c.created_at DESC,c.id DESC LIMIT $5`,
          [station, query ?? null, category ?? null, cursor, limit + 1],
        )
      ).rows;
      const items = [];
      for (const r of ids.slice(0, limit))
        items.push((await summary(db, r.id, station)).view);
      return {
        items,
        nextCursor:
          ids.length > limit
            ? nextCursor(config.secret, scope, ids[limit - 1].id)
            : null,
      };
    }
    if (action === "purchases") {
      await summary(db, targetId!, station);
      const rows = (
        await db.query(
          `SELECT p.*,pr.code AS product_code,pp.code AS pump_code,coalesce(r.amount_kobo,p.amount_kobo)::text AS projected_amount,coalesce(r.quantity,p.quantity)::text AS projected_quantity,coalesce(r.currency,p.currency) AS projected_currency,coalesce(r.unit,p.unit) AS projected_unit,(${contribution}) AS credited,coalesce((SELECT jsonb_agg(jsonb_build_object('kind',h.kind,'reasonCode',h.reason_code)) FROM purchase_hold h WHERE h.purchase_id=p.id AND h.state='open'),'[]') AS holds,EXISTS(SELECT 1 FROM duplicate_flag f WHERE f.purchase_id=p.id AND f.state='open') AS duplicate_flag,EXISTS(SELECT 1 FROM purchase_revision proposed WHERE proposed.purchase_id=p.id AND proposed.state='proposed') AS correction_pending FROM purchase p LEFT JOIN purchase_revision r ON r.id=p.current_revision_id AND r.state='accepted' JOIN product pr ON pr.id=p.product_id JOIN pump pp ON pp.id=p.pump_id WHERE p.customer_id=$1 AND p.station_id=$2 AND($3::uuid IS NULL OR(p.server_received_at,p.id)<(SELECT server_received_at,id FROM purchase WHERE id=$3)) ORDER BY p.server_received_at DESC,p.id DESC LIMIT $4`,
          [targetId, station, cursor, limit + 1],
        )
      ).rows;
      return {
        items: rows
          .slice(0, limit)
          .map((r) => ({
            id: r.id,
            saleCode: r.sale_code,
            appCapturedAt: r.app_captured_at.toISOString(),
            serverReceivedAt: r.server_received_at.toISOString(),
            product: r.product_code,
            unit: r.projected_unit,
            amountKobo: r.projected_amount,
            currency: r.projected_currency,
            quantity: r.projected_quantity,
            seller: {
              id: r.originating_attendant_id,
              name: r.seller_name,
              username: r.seller_username,
            },
            pump: { id: r.pump_id, code: r.pump_code },
            state: r.status,
            holds: r.holds,
            duplicateFlag: r.duplicate_flag,
            correctionPending: r.correction_pending,
            credited: r.credited === true,
          })),
        nextCursor:
          rows.length > limit
            ? nextCursor(config.secret, scope, rows[limit - 1].id)
            : null,
      };
    }
    throw new AuthError("not_found", 404);
  });
}

import type pg from "pg";
import { hashPassword } from "better-auth/crypto";
import { newId } from "../../lib/ids";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import type { PermissionCode } from "../../../shared/contracts/admin";
import {
  activatePriceSchema,
  assignAttendantSchema,
  createAttendantSchema,
  createPumpSchema,
  attendantSearchSchema,
  candidateSchema,
  stationPageSchema,
} from "../../../shared/contracts/station";
import { AuthError } from "../auth/errors";
import type { AdminConfig } from "../admin-access/config";
import { transaction, receipt } from "../admin-access/repo";
import {
  stationId,
  pumpView,
  attendantView,
  priceEventView,
  eventView,
  productView,
  priceView,
  currentPrice,
  cursorId,
  nextCursor,
  audit,
  displayCode,
} from "./repo";

const permissions = (action: string): PermissionCode[] =>
  action.startsWith("prices-")
    ? ["prices"]
    : action === "products"
      ? ["pumps", "prices"]
      : action === "attendants-create" ||
          action === "attendants-search" ||
          action === "attendants-get"
        ? ["attendants"]
        : action === "pumps-create"
          ? ["pumps"]
          : action === "pumps-list" || action === "pumps-get"
            ? ["pumps", "attendants", "prices"]
            : ["pumps", "attendants"];
const checkVersion = (actual: number, expected: number) => {
  if (actual !== expected) throw new AuthError("version_conflict", 409);
};
async function usablePump(
  db: pg.PoolClient,
  id: string,
  station: string,
  expected: number,
) {
  const p = (
    await db.query(
      "SELECT * FROM pump WHERE id=$1 AND station_id=$2 FOR SHARE",
      [id, station],
    )
  ).rows[0];
  if (!p || !p.enabled) throw new AuthError("pump_unavailable", 422);
  checkVersion(p.version, expected);
  return p;
}
export async function stationWrite(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  action: string,
  input: unknown,
  targetId?: string,
) {
  try {
    return await transaction(pool, async (db) => {
      await securityLock(db);
      const actor = await requireAdminSession(db, token);
      requirePermission(actor, ...permissions(action));
      const station = await stationId(db);
      await db.query(
        "UPDATE auth_session SET last_activity_at=clock_timestamp() WHERE id=$1",
        [actor.id],
      );
      if (action === "pumps-create") {
        const parsed = createPumpSchema.parse(input);
        return receipt(db, config, actor, action, parsed, async () => {
          const product = (
            await db.query("SELECT id FROM product WHERE code=$1", [
              parsed.productCode,
            ])
          ).rows[0];
          if (!product) throw new AuthError("product_unavailable", 422);
          const id = newId(),
            code = await displayCode(db, "pump");
          await db.query(
            "INSERT INTO pump(id,station_id,code,name,product_id,enabled,version) VALUES($1,$2,$3,$4,$5,true,1)",
            [id, station, code, parsed.name, product.id],
          );
          const result = await pumpView(db, id, station);
          await audit(
            db,
            actor.user_id,
            "pump",
            id,
            "pump_created",
            "Pump created",
            null,
            { name: parsed.name, productId: product.id, version: 1 },
          );
          return result;
        });
      }
      if (action === "prices-activate") {
        const parsed = activatePriceSchema.parse(input);
        return receipt(
          db,
          config,
          actor,
          action,
          { ...parsed, productCode: targetId },
          async () => {
            if (
              !/^[1-9]\d*$/.test(parsed.rateKobo) ||
              BigInt(parsed.rateKobo) > 9223372036854775807n
            )
              throw new AuthError("rate_invalid", 422);
            if (parsed.quantityPrecision < 0 || parsed.quantityPrecision > 6)
              throw new AuthError("precision_invalid", 422);
            if (parsed.currency !== "NGN")
              throw new AuthError("currency_unsupported", 422);
            const product = (
              await db.query("SELECT id FROM product WHERE code=$1", [targetId])
            ).rows[0];
            if (!product) throw new AuthError("not_found", 404);
            const old = await currentPrice(db, station, product.id);
            if ((old?.version ?? null) !== parsed.expectedVersion)
              throw new AuthError("version_conflict", 409);
            if (
              old &&
              old.rate_kobo === parsed.rateKobo &&
              old.quantity_precision === parsed.quantityPrecision
            )
              throw new AuthError("no_change", 409);
            const id = newId();
            // Clock resolution is microseconds in PostgreSQL. Never fabricate an activation time.
            const boundary = await trustedBoundary(
              db,
              "product_price_version",
              old?.id,
            );
            await db.query(
              "INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
              [
                id,
                station,
                product.id,
                (old?.version ?? 0) + 1,
                parsed.rateKobo,
                parsed.currency,
                parsed.quantityPrecision,
                boundary,
                actor.admin_id,
                parsed.reason,
              ],
            );
            const result = await priceEventView(db, id, station);
            await audit(
              db,
              actor.user_id,
              "product",
              product.id,
              "price_activated",
              parsed.reason,
              old
                ? {
                    priceVersionId: old.id,
                    version: old.version,
                    rateKobo: old.rate_kobo,
                    quantityPrecision: old.quantity_precision,
                  }
                : null,
              {
                priceVersionId: id,
                version: result.version,
                rateKobo: parsed.rateKobo,
                quantityPrecision: parsed.quantityPrecision,
              },
            );
            return result;
          },
        );
      }
      if (action === "attendants-create") {
        const parsed = createAttendantSchema.parse(input);
        return receipt(db, config, actor, action, parsed, async () => {
          if (parsed.password.length < 12)
            throw new AuthError("password_policy", 422);
          const pump = await usablePump(
            db,
            parsed.pumpId,
            station,
            parsed.expectedPumpVersion,
          );
          const user = newId(),
            id = newId(),
            assignment = newId(),
            code = await displayCode(db, "attendant");
          const hash = await hashPassword(parsed.password);
          await db.query(
            "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at,created_by_user_id) VALUES($1,'attendant',$2,$2,$3,true,1,true,clock_timestamp(),$4)",
            [user, parsed.username, parsed.name, actor.user_id],
          );
          await db.query(
            "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2::uuid,'credential',$2::text,$3,clock_timestamp())",
            [newId(), user, hash],
          );
          await db.query(
            "INSERT INTO attendant(id,user_id,staff_code,version) VALUES($1,$2,$3,1)",
            [id, user, code],
          );
          await db.query(
            "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,1,clock_timestamp(),$4,'Initial assignment at account creation')",
            [assignment, id, pump.id, actor.admin_id],
          );
          const result = await attendantView(db, id, station);
          await audit(
            db,
            actor.user_id,
            "attendant",
            id,
            "attendant_created",
            "Attendant created",
            null,
            {
              staffCode: code,
              username: parsed.username,
              name: parsed.name,
              version: 1,
            },
          );
          await audit(
            db,
            actor.user_id,
            "attendant",
            id,
            "assignment_changed",
            "Initial assignment at account creation",
            null,
            { assignmentId: assignment, pumpId: pump.id, version: 1 },
          );
          return result;
        });
      }
      if (action === "attendants-assignment") {
        const parsed = assignAttendantSchema.parse(input);
        return receipt(
          db,
          config,
          actor,
          action,
          { ...parsed, targetId },
          async () => {
            const a = (
              await db.query(
                "SELECT a.*,u.enabled FROM attendant a JOIN auth_user u ON u.id=a.user_id WHERE a.id=$1 FOR UPDATE OF a",
                [targetId],
              )
            ).rows[0];
            if (!a) throw new AuthError("not_found", 404);
            if (!a.enabled) throw new AuthError("attendant_unavailable", 422);
            await attendantView(db, a.id, station);
            checkVersion(a.version, parsed.expectedVersion);
            const old = (
              await db.query(
                "SELECT * FROM assignment WHERE attendant_id=$1 AND effective_until IS NULL FOR UPDATE",
                [a.id],
              )
            ).rows[0];
            if ((old?.id ?? null) !== parsed.expectedAssignmentId)
              throw new AuthError("version_conflict", 409);
            const pump = await usablePump(
              db,
              parsed.pumpId,
              station,
              parsed.expectedPumpVersion,
            );
            if (old?.pump_id === pump.id) throw new AuthError("no_change", 409);
            // Keep the actual boundary as a PostgreSQL timestamp, not a millisecond Date.
            const boundary = await trustedBoundary(db, "assignment", old?.id);
            if (old)
              await db.query(
                "UPDATE assignment SET effective_until=$2 WHERE id=$1 AND effective_until IS NULL",
                [old.id, boundary],
              );
            const id = newId();
            await db.query(
              "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                id,
                a.id,
                pump.id,
                (old?.assignment_version ?? 0) + 1,
                boundary,
                actor.admin_id,
                parsed.reason,
              ],
            );
            const updated = await db.query(
              "UPDATE attendant SET version=version+1 WHERE id=$1 AND version=$2",
              [a.id, parsed.expectedVersion],
            );
            if (updated.rowCount !== 1)
              throw new AuthError("version_conflict", 409);
            await audit(
              db,
              actor.user_id,
              "attendant",
              a.id,
              "assignment_changed",
              parsed.reason,
              old
                ? {
                    assignmentId: old.id,
                    pumpId: old.pump_id,
                    version: old.assignment_version,
                  }
                : null,
              {
                assignmentId: id,
                pumpId: pump.id,
                version: (old?.assignment_version ?? 0) + 1,
              },
            );
            const change = assignmentChange(await eventView(db, id));
            return {
              attendant: await attendantView(db, a.id, station),
              change,
            };
          },
        );
      }
      throw new AuthError("not_found", 404);
    });
  } catch (e) {
    const error = e as { code?: string; constraint?: string };
    if (error.code === "23505") {
      if (error.constraint === "uq_pump_normalized_name")
        throw new AuthError("pump_name_in_use", 409);
      if (error.constraint === "uq_user_username_normalized")
        throw new AuthError("username_in_use", 409);
    }
    throw e;
  }
}
export async function stationRead(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  action: string,
  input: unknown = {},
  targetId?: string,
) {
  return transaction(pool, async (db) => {
    await securityLock(db);
    const actor = await requireAdminSession(db, token);
    requirePermission(actor, ...permissions(action));
    const station = await stationId(db);
    await db.query(
      "UPDATE auth_session SET last_activity_at=clock_timestamp() WHERE id=$1",
      [actor.id],
    );
    if (action === "pumps-get") return pumpView(db, targetId!, station);
    if (action === "attendants-get")
      return attendantView(db, targetId!, station);
    if (action === "products")
      return {
        items: (
          await db.query(
            "SELECT id AS product_id,code AS product_code,unit FROM product ORDER BY code",
          )
        ).rows.map(productView),
      };
    if (action === "prices-list") {
      const products = (
        await db.query(
          "SELECT id AS product_id,code AS product_code,unit FROM product ORDER BY code",
        )
      ).rows;
      const items = [];
      for (const p of products) {
        const pumps = (
          await db.query(
            "SELECT id,code,name FROM pump WHERE station_id=$1 AND product_id=$2 AND enabled ORDER BY created_at DESC,id DESC",
            [station, p.product_id],
          )
        ).rows;
        items.push({
          product: productView(p),
          price: priceView(await currentPrice(db, station, p.product_id)),
          pumps,
        });
      }
      return { items };
    }
    const parsed =
      action === "attendants-search"
        ? attendantSearchSchema.parse(input)
        : action === "assignment-candidates"
          ? candidateSchema.parse(input)
          : stationPageSchema.parse(input);
    const filterPump =
        "pumpId" in parsed && typeof parsed.pumpId === "string"
          ? parsed.pumpId
          : undefined,
      query =
        "query" in parsed && typeof parsed.query === "string"
          ? parsed.query
          : undefined;
    const scope = JSON.stringify([
      station,
      actor.user_id,
      action,
      targetId ?? null,
      filterPump ?? null,
      query ?? null,
    ]);
    const cursor = cursorId(config.secret, scope, parsed.cursor),
      limit = parsed.limit ?? 25;
    let rows: { id: string }[] = [];
    let kind: "pump" | "attendant" | "assignment" | "price" = "pump";
    if (action === "pumps-list")
      rows = (
        await db.query(
          "SELECT p.id FROM pump p WHERE station_id=$1 AND enabled AND ($2::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM pump WHERE id=$2)) ORDER BY created_at DESC,id DESC LIMIT $3",
          [station, cursor, limit + 1],
        )
      ).rows;
    else if (
      action === "attendants-search" ||
      action === "assignment-candidates" ||
      action === "pumps-attendants"
    ) {
      kind = "attendant";
      if (action === "pumps-attendants") await pumpView(db, targetId!, station);
      if (filterPump) await pumpView(db, filterPump, station);
      rows = (
        await db.query(
          `SELECT a.id FROM attendant a JOIN auth_user u ON u.id=a.user_id LEFT JOIN assignment ag ON ag.attendant_id=a.id AND ag.effective_until IS NULL LEFT JOIN pump p ON p.id=ag.pump_id WHERE (p.station_id=$1 OR ag.id IS NULL) AND ($2::uuid IS NULL OR p.id=$2) AND ($3::text IS NULL OR strpos(lower(u.display_name),lower($3))>0 OR strpos(u.username_normalized,lower($3))>0 OR strpos(lower(a.staff_code),lower($3))>0) AND ($4::boolean=false OR u.enabled) AND ($5::uuid IS NULL OR (a.created_at,a.id)<(SELECT created_at,id FROM attendant WHERE id=$5)) ORDER BY a.created_at DESC,a.id DESC LIMIT $6`,
          [
            station,
            action === "pumps-attendants" ? targetId : (filterPump ?? null),
            query ?? null,
            action === "assignment-candidates",
            cursor,
            limit + 1,
          ],
        )
      ).rows;
    } else if (
      action === "attendants-assignments" ||
      action === "pumps-assignments"
    ) {
      kind = "assignment";
      if (action === "pumps-assignments")
        await pumpView(db, targetId!, station);
      else await attendantView(db, targetId!, station);
      rows = (
        await db.query(
          `SELECT ag.id FROM assignment ag JOIN pump p ON p.id=ag.pump_id WHERE p.station_id=$1 AND (${action === "attendants-assignments" ? "ag.attendant_id=$2" : "(ag.pump_id=$2 OR EXISTS(SELECT 1 FROM assignment old WHERE old.attendant_id=ag.attendant_id AND old.assignment_version=ag.assignment_version-1 AND old.pump_id=$2))"}) AND ($3::uuid IS NULL OR (ag.effective_from,ag.id)<(SELECT effective_from,id FROM assignment WHERE id=$3)) ORDER BY ag.effective_from DESC,ag.id DESC LIMIT $4`,
          [station, targetId, cursor, limit + 1],
        )
      ).rows;
    } else if (action === "prices-history") {
      kind = "price";
      const product = (
        await db.query("SELECT id FROM product WHERE code=$1", [targetId])
      ).rows[0];
      if (!product) throw new AuthError("not_found", 404);
      rows = (
        await db.query(
          "SELECT id FROM product_price_version WHERE station_id=$1 AND product_id=$2 AND ($3::uuid IS NULL OR (effective_from,id)<(SELECT effective_from,id FROM product_price_version WHERE id=$3)) ORDER BY effective_from DESC,id DESC LIMIT $4",
          [station, product.id, cursor, limit + 1],
        )
      ).rows;
    } else throw new AuthError("not_found", 404);
    const selected = rows.slice(0, limit),
      items = [];
    for (const row of selected) {
      if (kind === "pump") items.push(await pumpView(db, row.id, station));
      else if (kind === "attendant")
        items.push(await attendantView(db, row.id, station));
      else if (kind === "price")
        items.push(await priceEventView(db, row.id, station));
      else {
        const event = await eventView(db, row.id);
        if (action === "attendants-assignments") {
          items.push(assignmentChange(event));
        } else items.push(event);
      }
    }
    return {
      items,
      nextCursor:
        rows.length > limit
          ? nextCursor(config.secret, scope, selected.at(-1)!.id)
          : null,
    };
  });
}

async function trustedBoundary(
  db: pg.PoolClient,
  table: "assignment" | "product_price_version",
  previous?: string,
) {
  for (let i = 0; i < 3; i++) {
    const r = (
      await db.query(
        `WITH trusted_now AS MATERIALIZED (SELECT clock_timestamp() AS t) SELECT t::text AS boundary,($1::uuid IS NULL OR t>(SELECT effective_from FROM ${table} WHERE id=$1)) AS later FROM trusted_now`,
        [previous ?? null],
      )
    ).rows[0];
    if (r.later) return r.boundary as string;
  }
  throw new AuthError("temporarily_unavailable", 503);
}
function assignmentChange(event: Awaited<ReturnType<typeof eventView>>) {
  return {
    id: event.id,
    version: event.version,
    fromPumpId: event.fromPumpId,
    toPumpId: event.toPumpId,
    actor: event.actor,
    reason: event.reason,
    effectiveFrom: event.effectiveFrom,
    effectiveUntil: event.effectiveUntil,
  };
}

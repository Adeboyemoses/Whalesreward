import type pg from "pg";
import { randomInt } from "node:crypto";
import { validateCardPrintLayout } from "./renderer";
import { CARD_ALPHABET, cardCode } from "../../../shared/contracts/sync";
import { pageSchema } from "../../../shared/contracts/admin";
import {
  createBatchSchema,
  batchTransitionSchema,
  createExportSchema,
  batchListSchema,
  cardListSchema,
  batchSchema,
  inventoryCardSchema,
  batchEventSchema,
  cardExportSchema,
} from "../../../shared/contracts/customers-cards";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { newId } from "../../lib/ids";
import { AuthError } from "../auth/errors";
import { transaction, receipt, type LiveAdmin } from "../admin-access/repo";
import type { AdminConfig } from "../admin-access/config";
import { audit, cursorId, nextCursor } from "../station/repo";
import { CARD_POLICY, cardOptions, type CardOptions } from "./config";
export function randomCardCode() {
  return Array.from(
    { length: 7 },
    () => CARD_ALPHABET[randomInt(CARD_ALPHABET.length)],
  ).join("");
}
function permissions(actor: LiveAdmin, action: string) {
  requirePermission(actor, "cards");
  if (action === "create") requirePermission(actor, "cardGenerate");
  if (action === "mark-printed") requirePermission(actor, "cardPrint");
  if (action === "activate") requirePermission(actor, "cardActivate");
  if (["export", "exports", "export-detail", "file"].includes(action))
    requirePermission(actor, "cardExport");
}
export async function batchView(db: pg.PoolClient, id: string, lock = false) {
  if (
    lock &&
    !(await db.query("SELECT id FROM card_batch WHERE id=$1 FOR UPDATE", [id]))
      .rowCount
  )
    throw new AuthError("not_found", 404);
  const r = (
    await db.query(
      `SELECT b.*,a.admin_code,u.display_name,count(c.id)::text AS total,count(c.id) FILTER(WHERE c.state='unassigned')::text AS unassigned,count(c.id) FILTER(WHERE c.state='linked')::text AS linked,count(c.id) FILTER(WHERE c.state='retired')::text AS retired FROM card_batch b JOIN admin a ON a.id=b.created_by JOIN auth_user u ON u.id=a.user_id LEFT JOIN card c ON c.batch_id=b.id WHERE b.id=$1 GROUP BY b.id,a.id,u.id`,
      [id],
    )
  ).rows[0];
  if (!r) throw new AuthError("not_found", 404);
  return batchSchema.parse({
    id: r.id,
    batchCode: r.batch_code,
    name: r.name ?? r.batch_code,
    version: r.version,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    createdBy: { id: r.created_by, code: r.admin_code, name: r.display_name },
    total: r.total,
    unassigned: r.unassigned,
    linked: r.linked,
    retired: r.retired,
    availableToAssign: r.status === "active" ? r.unassigned : "0",
  });
}
export async function exportView(db: pg.PoolClient, batch: string, id: string) {
  const r = (
    await db.query(
      "SELECT e.*,(SELECT count(*)::text FROM card_export_item i WHERE i.export_id=e.id) AS card_count,expires_at<=clock_timestamp() AS expired FROM card_export e WHERE e.id=$1 AND e.batch_id=$2",
      [id, batch],
    )
  ).rows[0];
  if (!r) throw new AuthError("not_found", 404);
  return cardExportSchema.parse({
    id: r.id,
    batchId: r.batch_id,
    format: r.format,
    state: r.expired ? "expired" : r.status,
    preparedAt: r.prepared_at?.toISOString() ?? null,
    snapshotAt: r.snapshot_at.toISOString(),
    batchStatus: r.batch_status,
    batchVersion: r.batch_version,
    cardCount: r.card_count,
    expiresAt: r.expires_at?.toISOString() ?? null,
    failure: r.failure_code,
  });
}
export async function cardsWrite(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  action: string,
  input: unknown,
  targetId?: string,
  options: CardOptions = cardOptions(),
) {
  const parsed =
    action === "create"
      ? createBatchSchema.parse(input)
      : action === "export"
        ? createExportSchema.parse(input)
        : batchTransitionSchema.parse(input);
  return transaction(pool, async (db) => {
    await securityLock(db);
    const actor = await requireAdminSession(db, token);
    permissions(actor, action);
    const kind = `cards-${action}`;
    const replayed =
      (
        await db.query(
          "SELECT 1 FROM mutation_receipt WHERE actor_user_id=$1 AND operation_kind=$2 AND operation_id=$3",
          [actor.user_id, kind, parsed.operationId],
        )
      ).rowCount === 1;
    const data = await receipt(
      db,
      config,
      actor,
      kind,
      { ...parsed, targetId },
      async () => {
        if (action === "create") {
          const body = createBatchSchema.parse(parsed);
          if (body.count < 1 || body.count > CARD_POLICY.maxBatchSize)
            throw new AuthError("batch_size_invalid", 422);
          const id = newId(),
            seq = (
              await db.query(
                "SELECT coalesce(max(substring(batch_code from '^BATCH([0-9]+)$')::bigint),0)+1 AS n FROM card_batch WHERE batch_code ~ '^BATCH[0-9]{1,15}$'",
              )
            ).rows[0].n;
          await db.query(
            "INSERT INTO card_batch(id,batch_code,name,status,version,created_by) VALUES($1,$2,$3,'generated',1,$4)",
            [
              id,
              `BATCH${String(seq).padStart(3, "0")}`,
              body.name,
              actor.admin_id,
            ],
          );
          for (let n = 0; n < body.count; n++) {
            let allocated = false;
            for (
              let attempt = 0;
              attempt < CARD_POLICY.allocationAttempts;
              attempt++
            ) {
              const code = cardCode.parse(
                (options.codeGenerator ?? randomCardCode)(),
              );
              const r = await db.query(
                "INSERT INTO card(id,batch_id,code,qr_payload,state,version) VALUES($1,$2,$3,$3,'unassigned',1) ON CONFLICT DO NOTHING",
                [newId(), id, code],
              );
              if (r.rowCount === 1) {
                allocated = true;
                break;
              }
            }
            if (!allocated)
              throw new AuthError("code_allocation_unavailable", 503);
          }
          await audit(
            db,
            actor.user_id,
            "card_batch",
            id,
            "batch_generated",
            "Batch generated",
            null,
            { status: "generated", version: 1 },
            {
              operationId: body.operationId,
              occurredAt: new Date().toISOString(),
            },
          );
          return batchView(db, id);
        }
        const batch = await batchView(db, targetId!, true);
        if (
          batch.version !==
          ("expectedVersion" in parsed ? parsed.expectedVersion : undefined)
        )
          throw new AuthError("version_conflict", 409);
        if (action === "export") {
          const body = createExportSchema.parse(parsed);
          if (body.format === "pdf") {
            if (!options.layout)
              throw new AuthError("print_layout_unconfigured", 503);
            try {
              validateCardPrintLayout(options.layout);
            } catch {
              throw new AuthError("print_layout_unconfigured", 503);
            }
          }
          const active = (
            await db.query(
              "SELECT count(*)::int AS n FROM card_export WHERE created_by=$1 AND(status='pending' OR(status='failed' AND attempts<$2))",
              [actor.admin_id, CARD_POLICY.maxAttempts],
            )
          ).rows[0].n;
          if (active >= 2) throw new AuthError("rate_limited", 429, 30);
          // Registration takes batch then card locks in this same order.
          const cards = (
            await db.query(
              "SELECT * FROM card WHERE batch_id=$1 ORDER BY created_at,id FOR UPDATE",
              [targetId],
            )
          ).rows.filter(
            (c) => body.format === "xlsx" || c.state === "unassigned",
          );
          if (body.format === "pdf" && !cards.length)
            throw new AuthError("no_printable_cards", 409);
          const id = newId();
          await db.query(
            "INSERT INTO card_export(id,batch_id,created_by,operation_id,format,batch_version,batch_status,batch_code,batch_name,snapshot_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp(),'pending')",
            [
              id,
              targetId,
              actor.admin_id,
              body.operationId,
              body.format,
              batch.version,
              batch.status,
              batch.batchCode,
              batch.name,
            ],
          );
          let ordinal = 0;
          for (const card of cards)
            await db.query(
              "INSERT INTO card_export_item(export_id,card_id,ordinal,code,qr_payload,card_state,assignment_eligible) VALUES($1,$2,$3,$4,$5,$6,$7)",
              [
                id,
                card.id,
                ++ordinal,
                card.code,
                card.qr_payload,
                card.state,
                batch.status === "active" && card.state === "unassigned",
              ],
            );
          await audit(
            db,
            actor.user_id,
            "card_batch",
            targetId!,
            "batch_export_requested",
            "Batch export requested",
            null,
            {
              exportId: id,
              format: body.format,
              cardCount: String(cards.length),
            },
          );
          return exportView(db, targetId!, id);
        }
        const body = batchTransitionSchema.parse(parsed),
          from = action === "mark-printed" ? "generated" : "printed",
          to = action === "mark-printed" ? "printed" : "active";
        if (batch.status !== from)
          throw new AuthError("invalid_transition", 409);
        const updated = await db.query(
          "UPDATE card_batch SET status=$2,version=version+1 WHERE id=$1 AND status=$3 AND version=$4",
          [targetId, to, from, body.expectedVersion],
        );
        if (updated.rowCount !== 1)
          throw new AuthError("version_conflict", 409);
        await audit(
          db,
          actor.user_id,
          "card_batch",
          targetId!,
          "batch_status_changed",
          body.reason,
          { status: from, version: batch.version },
          { status: to, version: batch.version + 1 },
          {
            operationId: body.operationId,
            occurredAt: new Date().toISOString(),
          },
        );
        return batchView(db, targetId!);
      },
    );
    await db.query(
      "UPDATE auth_session SET last_activity_at=clock_timestamp() WHERE id=$1",
      [actor.id],
    );
    return { data, replayed };
  });
}
export async function cardsRead(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  action: string,
  input: unknown = {},
  batchId?: string,
  exportId?: string,
) {
  return transaction(pool, async (db) => {
    await securityLock(db);
    const actor = await requireAdminSession(db, token);
    permissions(actor, action);
    if (action === "detail") return batchView(db, batchId!);
    if (action === "export-detail") return exportView(db, batchId!, exportId!);
    if (batchId) await batchView(db, batchId);
    const parsed =
      action === "list"
        ? batchListSchema.parse(input)
        : action === "cards"
          ? cardListSchema.parse(input)
          : pageSchema.parse(input);
    const filter =
      "status" in parsed
        ? parsed.status
        : "state" in parsed
          ? parsed.state
          : null;
    const scope = JSON.stringify([
        actor.user_id,
        action,
        batchId ?? null,
        filter ?? null,
      ]),
      cursor = cursorId(config.secret, scope, parsed.cursor),
      limit = parsed.limit ?? 25;
    let rows: Record<string, unknown>[];
    if (action === "list")
      rows = (
        await db.query(
          "SELECT id FROM card_batch WHERE($1::text IS NULL OR status=$1) AND($2::uuid IS NULL OR(created_at,id)<(SELECT created_at,id FROM card_batch WHERE id=$2)) ORDER BY created_at DESC,id DESC LIMIT $3",
          [filter ?? null, cursor, limit + 1],
        )
      ).rows;
    else if (action === "cards")
      rows = (
        await db.query(
          `SELECT c.*,b.status,cu.id AS customer_id,cu.customer_code,cu.name AS customer_name FROM card c JOIN card_batch b ON b.id=c.batch_id LEFT JOIN card_customer_link l ON l.card_id=c.id AND l.ended_at IS NULL LEFT JOIN customer cu ON cu.id=l.customer_id WHERE c.batch_id=$1 AND($2::text IS NULL OR c.state=$2) AND($3::uuid IS NULL OR(c.created_at,c.id)<(SELECT created_at,id FROM card WHERE id=$3)) ORDER BY c.created_at DESC,c.id DESC LIMIT $4`,
          [batchId, filter ?? null, cursor, limit + 1],
        )
      ).rows;
    else if (action === "history")
      rows = (
        await db.query(
          `SELECT e.*,ad.id AS admin_id,ad.admin_code,u.display_name FROM audit_event e JOIN admin ad ON ad.user_id=e.actor_user_id JOIN auth_user u ON u.id=ad.user_id WHERE e.target_type='card_batch' AND e.target_id=$1 AND e.action IN('batch_generated','batch_status_changed') AND($2::uuid IS NULL OR(e.occurred_at,e.id)<(SELECT occurred_at,id FROM audit_event WHERE id=$2)) ORDER BY e.occurred_at DESC,e.id DESC LIMIT $3`,
          [batchId, cursor, limit + 1],
        )
      ).rows;
    else if (action === "exports")
      rows = (
        await db.query(
          "SELECT id FROM card_export WHERE batch_id=$1 AND($2::uuid IS NULL OR(created_at,id)<(SELECT created_at,id FROM card_export WHERE id=$2)) ORDER BY created_at DESC,id DESC LIMIT $3",
          [batchId, cursor, limit + 1],
        )
      ).rows;
    else throw new AuthError("not_found", 404);
    const selected = rows.slice(0, limit),
      items = [];
    for (const r of selected) {
      if (action === "list") items.push(await batchView(db, r.id as string));
      if (action === "exports")
        items.push(await exportView(db, batchId!, r.id as string));
      if (action === "cards")
        items.push(
          inventoryCardSchema.parse({
            id: r.id,
            code: r.code,
            qrPayload: r.qr_payload,
            state: r.state,
            assignmentEligible:
              r.status === "active" && r.state === "unassigned",
            linkedCustomer:
              r.state === "linked" &&
              r.customer_id &&
              actor.permissions.includes("customers")
                ? {
                    id: r.customer_id,
                    customerCode: r.customer_code,
                    name: r.customer_name,
                  }
                : null,
            retiredAt: (r.retired_at as Date | null)?.toISOString() ?? null,
          }),
        );
      if (action === "history")
        items.push(
          batchEventSchema.parse({
            id: r.id,
            from: (r.before as { status?: string })?.status ?? null,
            to: (r.after as { status: string }).status,
            actor: { id: r.admin_id, code: r.admin_code, name: r.display_name },
            reason: r.reason,
            occurredAt: (r.occurred_at as Date).toISOString(),
          }),
        );
    }
    return {
      items,
      nextCursor:
        rows.length > limit
          ? nextCursor(config.secret, scope, selected.at(-1)!.id as string)
          : null,
    };
  });
}

import type pg from "pg";
import { z } from "zod";
import { transaction } from "../admin-access/repo";
import { AuthError } from "../auth/errors";
import {
  checklistQuery,
  selectionQuery,
  checklistProjectionSchema,
  storedChecklistSchema,
  managerSelectionSchema,
  attendantSelectionSchema,
  phoneSelectionSchema,
  incompleteSelectionSchema,
} from "../../../shared/contracts/giveaway-projections";
import {
  projectionContext,
  projectionView,
  pack,
  unpack,
  type ProjectionAction,
} from "./projection-context";
import {
  managers,
  attendants,
  phones,
  incomplete,
  retained,
} from "./projection-selections";
import { outcomes } from "./projection-outcomes";
const cursorSchema = z.strictObject({
  scope: z.string(),
  actor: z.string(),
  view: z.string(),
  limit: z.number().int(),
  last: z.string(),
});
/** Lock waits can invalidate a repeatable-read snapshot. Retry the whole read,
 * including current authority and expected-view checks, never only its serializer. */
async function consistentRead<T>(
  pool: pg.Pool,
  run: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await transaction(pool, run);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "40001"
      ) {
        if (attempt < 2) continue;
        throw new AuthError("temporarily_unavailable", 503);
      }
      throw error;
    }
  }
}
export async function readProjection(
  pool: pg.Pool,
  secret: string,
  token: string | undefined,
  campaignId: string,
  action: ProjectionAction,
  resourceId?: string,
  input: unknown = {},
) {
  return consistentRead(pool, async (db) => {
    const ctx = await projectionContext(db, token, campaignId, action);
    if (action === "results") {
      z.strictObject({}).parse(input);
      const r = (
        await db.query(
          `SELECT id,campaign_id,phone_check_id,source_data_version::text,content,checked_at FROM giveaway_reconciliation WHERE id=$1 AND campaign_id=$2 AND station_id=$3`,
          [resourceId, ctx.c.id, ctx.c.station_id],
        )
      ).rows[0];
      if (!r) throw new AuthError("not_found", 404);
      const v = r.content;
      if (
        !v ||
        v.phoneCheckId !== r.phone_check_id ||
        new Date(v.checkedAt).getTime() !== r.checked_at.getTime()
      )
        throw new AuthError("temporarily_unavailable", 503);
      return retained(storedChecklistSchema, {
        id: r.id,
        campaignId: r.campaign_id,
        kind: v.currentSnapshotId ? "revision" : "initial",
        checkedAt: v.checkedAt,
        sourceDataVersion: r.source_data_version,
        settingsVersionId: v.settingsVersionId,
        timingPolicyVersion: v.timingPolicyVersion,
        reconciliationPolicyVersion: v.policyVersion,
        previousSnapshotId: v.currentSnapshotId,
        phoneCheckId: v.phoneCheckId,
        approvedExclusionIds: v.approvedExclusionIds,
        actor: v.actor,
        reason: v.reason,
        auditEventId: v.auditEventId,
        outcome: v.outcome,
        checks: v.checks,
        countBasis: "reconciliation_v1_stored",
        historical: true,
      });
    }
    const p =
      action === "checklist"
        ? checklistQuery.parse(input)
        : selectionQuery.parse(input);
    const view = await projectionView(db, secret, ctx);
    if (p.expectedView && p.expectedView !== view.viewToken)
      throw new AuthError("read_view_stale", 409);
    if (action === "checklist")
      return retained(checklistProjectionSchema, {
        view,
        ...(await outcomes(db, ctx)),
        latestStoredResultId: ctx.c.reconciliation_id,
      });
    const page = selectionQuery.parse(input),
      scope = `${campaignId}:${action}:${resourceId ?? ""}`;
    let last = "";
    if (page.cursor) {
      const old = cursorSchema.parse(unpack(secret, page.cursor));
      if (
        old.scope !== scope ||
        old.actor !== ctx.actor.id ||
        old.limit !== page.limit
      )
        throw new AuthError("invalid_request", 400);
      if (old.view !== view.viewToken)
        throw new AuthError("read_view_stale", 409);
      last = old.last;
    }
    let items: Record<string, unknown>[],
      currentDesignation: unknown = null;
    if (action === "managers") {
      const result = await managers(db, ctx);
      items = result.items;
      currentDesignation = result.currentDesignation;
    } else if (action === "attendants") items = await attendants(db, ctx);
    else if (action === "phones") items = await phones(db, ctx);
    else items = await incomplete(db, ctx, resourceId!);
    const key =
      action === "managers"
        ? "adminId"
        : action === "attendants"
          ? "attendantId"
          : action === "phones"
            ? "id"
            : "purchaseId";
    const remaining = items.filter((r) => String(r[key]) > last),
      selected: Record<string, unknown>[] = [];
    for (const item of remaining.slice(0, page.limit)) {
      if (
        Buffer.byteLength(
          JSON.stringify({
            view,
            items: [...selected, item],
            nextCursor: "x".repeat(1024),
            ...(action === "managers" ? { currentDesignation } : {}),
          }),
        ) > 32768
      ) {
        if (!selected.length) throw new AuthError("request_too_large", 413);
        break;
      }
      selected.push(item);
    }
    const nextCursor =
      selected.length < remaining.length
        ? pack(secret, {
            scope,
            actor: ctx.actor.id,
            view: view.viewToken,
            limit: page.limit,
            last: String(selected.at(-1)![key]),
          })
        : null;
    const result = { view, items: selected, nextCursor };
    if (action === "managers")
      return retained(managerSelectionSchema, {
        ...result,
        currentDesignation,
      });
    return retained(
      action === "attendants"
        ? attendantSelectionSchema
        : action === "phones"
          ? phoneSelectionSchema
          : incompleteSelectionSchema,
      result,
    );
  });
}

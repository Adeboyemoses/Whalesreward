import type pg from "pg";
import { z } from "zod";
import { categorySchema } from "../../../shared/contracts/customers-cards";
import { giveawayPage } from "../../../shared/contracts/giveaway";
import { transaction } from "../admin-access/repo";
import type { AdminConfig } from "../admin-access/config";
import { AuthError } from "../auth/errors";
import { requirePermission } from "../../lib/authz";
import { authority, campaignData, ranking, type Contribution } from "./data";
import { page } from "../reports/data";
const query = z.strictObject({
  ...giveawayPage,
  category: categorySchema.optional(),
  kind: z.enum(["purchases", "customers"]).optional(),
});
export const publicSource = (s: Contribution) => ({
  purchaseId: s.purchaseId,
  revisionId: s.revisionId,
  purchaseVersion: s.purchaseVersion,
  included: s.included,
  reasons: s.reasons,
  customerId: s.customerId,
  category: s.category,
  amountKobo: s.amountKobo,
  currency: s.currency,
  quantity: s.quantity,
  unit: s.unit,
  valuesSource: s.valuesSource,
  photoAssetId: s.photoAssetId,
  detailsReceivedAt: s.detailsReceivedAt,
  photoReceiptAt: s.photoReceiptAt,
  timingPolicyVersion: s.timingPolicyVersion,
  phoneExclusionId: s.phoneExclusionId,
});
export async function readGiveawayHistory(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  campaignId: string,
  collection: "previews" | "snapshots",
  id: string | undefined,
  child: "rows" | "sources" | "changes" | undefined,
  input: unknown = {},
) {
  const q = query.parse(input);
  const keys = Object.keys(input as Record<string, unknown>);
  if (
    (id && !child && keys.length) ||
    (child !== "rows" && q.category !== undefined) ||
    (child !== "changes" && q.kind !== undefined)
  )
    throw new AuthError("invalid_request", 400);
  return transaction(pool, async (db) => {
    const { actor, station } = await authority(db, token);
    await campaignData(db, station.id, campaignId);
    if (child === "sources" || (child === "changes" && q.kind === "purchases"))
      requirePermission(actor, "sales");
    const table =
      collection === "previews" ? "giveaway_preview" : "giveaway_snapshot";
    const scope = JSON.stringify([
      actor.admin_id,
      station.id,
      campaignId,
      collection,
      id ?? null,
      child ?? null,
      q.category ?? null,
      q.kind ?? null,
    ]);
    if (!id) {
      if (collection !== "snapshots" || child)
        throw new AuthError("invalid_request", 400);
      const rows = (
        await db.query(
          "SELECT content FROM giveaway_snapshot WHERE campaign_id=$1 ORDER BY snapshot_number DESC",
          [campaignId],
        )
      ).rows.map((r) => r.content);
      return page(rows, q.limit, config.secret, scope, hashIds(rows), q.cursor);
    }
    const record = (
      await db.query(`SELECT * FROM ${table} WHERE id=$1 AND campaign_id=$2`, [
        id,
        campaignId,
      ])
    ).rows[0];
    if (!record) throw new AuthError("not_found", 404);
    if (!record.content) throw new AuthError("temporarily_unavailable", 503);
    if (!child) {
      if (collection === "snapshots") return record.content;
      const consumed = (
        await db.query(
          "SELECT snapshot_id FROM giveaway_preview_consumption WHERE preview_id=$1",
          [id],
        )
      ).rows[0];
      return {
        ...record.content,
        consumedSnapshotId: consumed?.snapshot_id ?? null,
      };
    }
    if (child === "rows")
      return page(
        ranking(record.sources, q.category).rows,
        q.limit,
        config.secret,
        scope,
        id,
        q.cursor,
      );
    if (child === "sources")
      return page(
        record.sources.map(publicSource),
        q.limit,
        config.secret,
        scope,
        id,
        q.cursor,
      );
    if (!q.kind) throw new AuthError("invalid_request", 400);
    const previousId = record.content.previousSnapshotId;
    const previous = previousId
      ? (
          await db.query(
            "SELECT sources,rows FROM giveaway_snapshot WHERE id=$1 AND campaign_id=$2",
            [previousId, campaignId],
          )
        ).rows[0]
      : null;
    if (q.kind === "customers") {
      const old = new Map<string, unknown>(
        (previous?.rows ?? []).map((r: { customerId: string }) => [
          r.customerId,
          r,
        ]),
      );
      const now = new Map<string, unknown>(
        record.rows.map((r: { customerId: string }) => [r.customerId, r]),
      );
      const rows = [...new Set([...old.keys(), ...now.keys()])]
        .sort()
        .flatMap((customerId) => {
          const before = old.get(customerId) ?? null,
            after = now.get(customerId) ?? null;
          return JSON.stringify(before) === JSON.stringify(after)
            ? []
            : [{ customerId, before, after }];
        });
      return page(rows, q.limit, config.secret, scope, id, q.cursor);
    }
    const old = new Map<string, Contribution>(
      (previous?.sources ?? []).map((s: Contribution) => [s.purchaseId, s]),
    );
    const rows = (record.sources as Contribution[]).flatMap((s) => {
      const before = old.get(s.purchaseId);
      const beforeWire = before ? publicSource(before) : null,
        after = publicSource(s);
      return JSON.stringify(beforeWire) === JSON.stringify(after)
        ? []
        : [
            {
              purchaseId: s.purchaseId,
              before: beforeWire,
              after,
              decisionEventIds: s.decisionEventIds.filter(
                (id) => !before?.decisionEventIds?.includes(id),
              ),
            },
          ];
    });
    return page(rows, q.limit, config.secret, scope, id, q.cursor);
  });
}
const hashIds = (rows: { id: string }[]) => rows.map((r) => r.id).join(":");

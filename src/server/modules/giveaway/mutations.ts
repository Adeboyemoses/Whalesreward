import type pg from "pg";
import { createHash } from "node:crypto";
import { transaction, receipt, type LiveAdmin } from "../admin-access/repo";
import { adminConfig, type AdminConfig } from "../admin-access/config";
import { AuthError } from "../auth/errors";
import { requirePermission } from "../../lib/authz";
import { newId } from "../../lib/ids";
import { auditActor } from "../audit/write";
import { writeGiveawayAudit } from "../audit/write-giveaway";
import {
  safeAuditText,
  type M4GiveawayAuditEvent,
} from "../../../shared/contracts/audit";
import {
  prepareGiveawaySchema,
  confirmGiveawaySchema,
  type Exclusion,
} from "../../../shared/contracts/giveaway";
import {
  authority,
  campaignData,
  campaignView,
  ranking,
  type Contribution,
} from "./data";
import { readiness } from "./readiness";
import { totals } from "../reports/data";
type Campaign = NonNullable<Awaited<ReturnType<typeof campaignData>>>;
export const hashContent = (v: unknown): string =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
function guard(
  c: Campaign,
  p: {
    expectedVersion: number;
    expectedSettingsVersionId: string | null;
    expectedDataVersion: string;
    expectedPreviousSnapshotId: string | null;
  },
) {
  if (p.expectedPreviousSnapshotId !== c.latest_snapshot_id)
    throw new AuthError("snapshot_superseded", 409);
  if (
    p.expectedVersion !== c.version ||
    p.expectedSettingsVersionId !== c.current_timing_version_id ||
    p.expectedDataVersion !== c.data_version
  )
    throw new AuthError("version_conflict", 409);
}
const campaignGuard = (c: Campaign) => ({
  expectedVersion: c.version,
  expectedSettingsVersionId: c.current_timing_version_id,
  expectedDataVersion: c.data_version,
  expectedPreviousSnapshotId: c.latest_snapshot_id,
});
const effective = (sources: Contribution[]) =>
  sources.map((s) => ({
    purchaseId: s.purchaseId,
    revisionId: s.revisionId,
    included: s.included,
    reasons: s.reasons,
    customerId: s.customerId,
    category: s.category,
    amountKobo: s.amountKobo,
    currency: s.currency,
    quantity: s.quantity,
    unit: s.unit,
    photoAssetId: s.photoAssetId,
    photoReceiptAt: s.photoReceiptAt,
  }));
async function audit(
  db: pg.PoolClient,
  actor: LiveAdmin,
  c: Campaign,
  operationId: string,
  action: M4GiveawayAuditEvent["action"],
  reason: string,
  before: Record<string, string | null>,
  after: Record<string, string | null>,
) {
  const id = newId(),
    at = (
      await db.query("SELECT clock_timestamp() now")
    ).rows[0].now.toISOString();
  await writeGiveawayAudit(db, {
    id,
    eventCode: `AUD-${id}`,
    schemaVersion: 2,
    stationId: c.station_id,
    occurredAt: at,
    area: "giveaway",
    action,
    actor: await auditActor(db, actor.user_id),
    originatingSeller: null,
    target: {
      kind: "campaign",
      id: c.id,
      code: "CAMPAIGN",
      subjectAtEvent: null,
    },
    operationId,
    correlationId: operationId,
    reason,
    changes: Object.keys(after).map((field) => ({
      field,
      before: before[field] ?? null,
      after: after[field]!,
    })),
    relatedEventIds: [],
  });
  return { id, at };
}
async function actorView(db: pg.PoolClient, actor: LiveAdmin) {
  const a = await auditActor(db, actor.user_id);
  return {
    id: actor.admin_id,
    code: a.kind === "admin" ? a.code : "ADMIN",
    name: a.nameAtEvent,
  };
}
function exclusionSummary(sources: Contribution[]) {
  const reasons = [...new Set(sources.flatMap((s) => s.reasons))].sort();
  return reasons.map((reason: Exclusion) => {
    const rows = sources.filter((s) => s.reasons.includes(reason));
    return { reason, records: String(rows.length), spend: totals(rows).spend };
  });
}
export async function prepareGiveaway(
  pool: pg.Pool,
  token: string | undefined,
  campaignId: string,
  input: unknown,
  config: AdminConfig = adminConfig(),
) {
  const p = prepareGiveawaySchema.parse(input);
  if (!safeAuditText(p.reason)) throw new AuthError("invalid_request", 400);
  return transaction(pool, async (db) => {
    const { actor, station } = await authority(db, token, true);
    requirePermission(
      actor,
      p.kind === "initial" ? "giveawayFinalize" : "giveawayRevise",
    );
    const c = (await campaignData(db, station.id, campaignId))!;
    let replayed = true;
    const data = await receipt(
      db,
      config,
      actor,
      "giveaway.prepare",
      { ...p, campaignId },
      async () => {
        replayed = false;
        guard(c, p);
        if (p.kind === "initial" && c.latest_snapshot_id)
          throw new AuthError("snapshot_exists", 409);
        if (p.kind === "revision" && !c.latest_snapshot_id)
          throw new AuthError("snapshot_missing", 409);
        const ready = await readiness(db, c, actor.admin_id);
        if (!ready.view.canPrepare)
          throw new AuthError("finalization_blocked", 409);
        const reconciliationId = newId(),
          phoneCheckId = ready.phone.phoneCheckId!,
          policy = ready.phone.policyVersion!,
          sources = ready.sources;
        const checkNames = [
          "timing",
          "holds",
          "corrections",
          "duplicates",
          "two_person_proposals",
          "uploads",
          "complete_photo_deadline",
          "eligibility",
          "phone_census",
        ];
        const checks = checkNames.map((name) => ({
          name,
          result: "clear",
          checked: String(sources.length),
          blocking: "0",
        }));
        await db.query(
          "INSERT INTO giveaway_reconciliation(id,campaign_id,station_id,phone_check_id,source_data_version,content) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
          [
            reconciliationId,
            c.id,
            station.id,
            phoneCheckId,
            c.data_version,
            JSON.stringify({
              checks,
              sourceDigest: hashContent(sources),
              phoneCheckId,
              approvedExclusionIds: ready.phone.approvedExclusionIds,
              policyVersion: policy,
              settingsVersionId: c.current_timing_version_id,
            }),
          ],
        );
        await db.query(
          "UPDATE campaign SET reconciliation_required=false,reconciled_data_version=$2,version=version+1 WHERE id=$1",
          [c.id, c.data_version],
        );
        c.version++;
        c.reconciliation_required = false;
        c.reconciled_data_version = c.data_version;
        const predecessor = c.latest_snapshot_id
          ? (
              await db.query(
                "SELECT content,sources,rows FROM giveaway_snapshot WHERE id=$1 AND campaign_id=$2",
                [c.latest_snapshot_id, c.id],
              )
            ).rows[0]
          : null;
        const context = {
          phoneCheckId,
          reconciliationId,
          campaignVersion: String(c.version),
          sourceDataVersion: c.data_version,
          settingsVersionId: c.current_timing_version_id,
          reconciliationPolicyVersion: policy,
        };
        if (
          predecessor &&
          hashContent(effective(predecessor.sources)) ===
            hashContent(effective(sources))
        ) {
          const event = await audit(
            db,
            actor,
            c,
            p.operationId,
            "giveaway_reconciled_unchanged",
            p.reason,
            { campaignVersion: String(c.version - 1) },
            { ...context, snapshotId: c.latest_snapshot_id },
          );
          return {
            state: "unchanged",
            campaign: campaignView(c),
            reconciliationId,
            currentSnapshotId: c.latest_snapshot_id,
            phoneCheckId,
            checkedAt: event.at,
            reason: p.reason,
            auditEventId: event.id,
          };
        }
        const id = newId(),
          ranked = ranking(sources),
          now = (
            await db.query(
              "SELECT clock_timestamp() now,clock_timestamp()+interval '15 minutes' expiry",
            )
          ).rows[0];
        const changes = sources.flatMap((after) => {
          const before: Contribution | null =
            predecessor?.sources.find(
              (s: Contribution) => s.purchaseId === after.purchaseId,
            ) ?? null;
          return hashContent(before && effective([before])) ===
            hashContent(effective([after]))
            ? []
            : [
                {
                  purchaseId: after.purchaseId,
                  before,
                  after,
                  decisionEventIds: [],
                },
              ];
        });
        const content = {
          id,
          campaignId: c.id,
          kind: p.kind,
          createdBy: await actorView(db, actor),
          preparedAt: now.now.toISOString(),
          expiresAt: now.expiry.toISOString(),
          guard: campaignGuard(c),
          reason: p.reason,
          timing: campaignView(c).timing,
          tieRule: "competition_v1",
          totals: ranked.summary,
          customers: ranked.customers,
          exclusions: exclusionSummary(sources),
          reconciliationPolicyVersion: policy,
          contentDigest: hashContent({ sources, rows: ranked.rows, changes }),
          previousSnapshotId: c.latest_snapshot_id,
          consumedSnapshotId: null,
          reconciliationId,
          phoneCheckId,
        };
        await db.query(
          "INSERT INTO giveaway_preview(id,campaign_id,station_id,content,sources,rows,changes,expires_at) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8)",
          [
            id,
            c.id,
            station.id,
            JSON.stringify(content),
            JSON.stringify(sources),
            JSON.stringify(ranked.rows),
            JSON.stringify(changes),
            now.expiry,
          ],
        );
        await audit(
          db,
          actor,
          c,
          p.operationId,
          "giveaway_review_prepared",
          p.reason,
          { campaignVersion: String(c.version - 1) },
          {
            ...context,
            previewId: id,
            previousSnapshotId: c.latest_snapshot_id,
          },
        );
        return content;
      },
    );
    return { data, replayed };
  });
}
export async function confirmGiveaway(
  pool: pg.Pool,
  token: string | undefined,
  campaignId: string,
  input: unknown,
  previousSnapshotId?: string,
  config: AdminConfig = adminConfig(),
) {
  const p = confirmGiveawaySchema.parse(input);
  return transaction(pool, async (db) => {
    const { actor, station } = await authority(db, token, true);
    requirePermission(
      actor,
      previousSnapshotId ? "giveawayRevise" : "giveawayFinalize",
    );
    const c = (await campaignData(db, station.id, campaignId))!;
    let replayed = true;
    const data = await receipt(
      db,
      config,
      actor,
      "giveaway.confirm",
      { ...p, campaignId, previousSnapshotId: previousSnapshotId ?? null },
      async () => {
        replayed = false;
        guard(c, p);
        if (!previousSnapshotId && c.latest_snapshot_id)
          throw new AuthError("snapshot_exists", 409);
        if (
          previousSnapshotId !== undefined &&
          previousSnapshotId !== c.latest_snapshot_id
        )
          throw new AuthError("snapshot_superseded", 409);
        const preview = (
          await db.query(
            "SELECT *,expires_at<=clock_timestamp() expired FROM giveaway_preview WHERE id=$1 AND campaign_id=$2 AND station_id=$3",
            [p.previewId, c.id, station.id],
          )
        ).rows[0];
        if (!preview) throw new AuthError("not_found", 404);
        const v = preview.content;
        if (
          v.createdBy.id !== actor.admin_id ||
          v.kind !== (previousSnapshotId ? "revision" : "initial")
        )
          throw new AuthError("permission_denied", 403);
        if (v.contentDigest !== p.contentDigest)
          throw new AuthError("preview_mismatch", 422);
        if (preview.expired) throw new AuthError("preview_expired", 409);
        if (
          (
            await db.query(
              "SELECT 1 FROM giveaway_preview_consumption WHERE preview_id=$1",
              [p.previewId],
            )
          ).rowCount
        )
          throw new AuthError("preview_used", 409);
        if (JSON.stringify(v.guard) !== JSON.stringify(campaignGuard(c)))
          throw new AuthError("preview_stale", 409);
        const ready = await readiness(db, c, actor.admin_id);
        if (
          !ready.view.canConfirm ||
          ready.phone.phoneCheckId !== v.phoneCheckId ||
          ready.phone.policyVersion !== v.reconciliationPolicyVersion ||
          hashContent(ready.sources) !== hashContent(preview.sources)
        )
          throw new AuthError("finalization_blocked", 409);
        const predecessor = previousSnapshotId
          ? (
              await db.query(
                "SELECT content,snapshot_number FROM giveaway_snapshot WHERE id=$1 AND campaign_id=$2",
                [previousSnapshotId, c.id],
              )
            ).rows[0]
          : null;
        const id = newId(),
          number = (predecessor?.snapshot_number ?? 0) + 1;
        const fields = {
          phoneCheckId: v.phoneCheckId,
          reconciliationId: v.reconciliationId,
          reconciliationPolicyVersion: v.reconciliationPolicyVersion,
          snapshotId: id,
          previousSnapshotId: c.latest_snapshot_id,
          snapshotNumber: String(number),
          campaignVersion: String(c.version + 1),
          sourceDataVersion: c.data_version,
          settingsVersionId: c.current_timing_version_id,
          qualifyingSpendKobo: v.totals.spend[0]?.amountKobo ?? "0",
          currency: v.totals.spend[0]?.currency ?? "NGN",
          litres: v.totals.litres,
          kilograms: v.totals.kilograms,
          purchaseCount: v.totals.purchases,
          customerCount: v.customers,
          tieRule: v.tieRule,
        };
        const before = predecessor
          ? {
              ...fields,
              snapshotId: previousSnapshotId!,
              snapshotNumber: String(number - 1),
              campaignVersion: String(c.version),
              qualifyingSpendKobo:
                predecessor.content.totals.spend[0]?.amountKobo ?? "0",
              litres: predecessor.content.totals.litres,
              kilograms: predecessor.content.totals.kilograms,
              purchaseCount: predecessor.content.totals.purchases,
              customerCount: predecessor.content.customers,
            }
          : {};
        const event = await audit(
          db,
          actor,
          c,
          p.operationId,
          previousSnapshotId ? "giveaway_revised" : "giveaway_finalized",
          v.reason,
          before,
          fields,
        );
        const content = {
          id,
          campaignId: c.id,
          number,
          previousSnapshotId: c.latest_snapshot_id,
          settingsVersionId: c.current_timing_version_id,
          timing: v.timing,
          sourceDataVersion: c.data_version,
          finalizedAt: event.at,
          actor: await actorView(db, actor),
          reason: v.reason,
          tieRule: v.tieRule,
          totals: v.totals,
          customers: v.customers,
          exclusions: v.exclusions,
          reconciliationPolicyVersion: v.reconciliationPolicyVersion,
          reconciliationId: v.reconciliationId,
          phoneCheckId: v.phoneCheckId,
          auditEventId: event.id,
        };
        await db.query(
          `INSERT INTO giveaway_snapshot(id,campaign_id,settings_version_id,snapshot_number,previous_snapshot_id,operation_id,actor_id,reason,tie_rule,finalized_at,content,sources,rows,reconciliation_id,phone_check_id,source_data_version,content_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,$17)`,
          [
            id,
            c.id,
            c.current_timing_version_id,
            number,
            c.latest_snapshot_id,
            p.operationId,
            actor.admin_id,
            v.reason,
            v.tieRule,
            event.at,
            JSON.stringify(content),
            JSON.stringify(preview.sources),
            JSON.stringify(preview.rows),
            v.reconciliationId,
            v.phoneCheckId,
            c.data_version,
            v.contentDigest,
          ],
        );
        for (const s of preview.sources)
          await db.query(
            "INSERT INTO giveaway_snapshot_source(id,snapshot_id,purchase_id,revision_id,included,exclusion_reason) VALUES($1,$2,$3,$4,$5,$6)",
            [
              newId(),
              id,
              s.purchaseId,
              s.revisionId,
              s.included,
              s.included ? null : s.reasons.join(","),
            ],
          );
        const categoryRanks = new Map<string, string>();
        for (const cat of new Set(
          (preview.sources as Contribution[]).map((s) => s.category),
        )) {
          if (cat)
            for (const r of ranking(preview.sources, cat).rows)
              categoryRanks.set(r.customerId, r.rank);
        }
        for (const r of preview.rows)
          await db.query(
            "INSERT INTO giveaway_snapshot_row(id,snapshot_id,customer_id,category,qualifying_spend_kobo,currency,transaction_count,overall_rank,category_rank) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            [
              newId(),
              id,
              r.customerId,
              r.category,
              r.totals.spend[0].amountKobo,
              r.totals.spend[0].currency,
              r.totals.purchases,
              r.rank,
              categoryRanks.get(r.customerId),
            ],
          );
        await db.query(
          "INSERT INTO giveaway_preview_consumption(preview_id,snapshot_id) VALUES($1,$2)",
          [p.previewId, id],
        );
        await db.query(
          "UPDATE campaign SET latest_snapshot_id=$2,version=version+1 WHERE id=$1",
          [c.id, id],
        );
        return content;
      },
    );
    return { data, replayed };
  });
}

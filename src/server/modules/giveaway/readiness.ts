import type pg from "pg";
import { recordedReconciliationPolicy } from "./policy";
import { phoneReadiness } from "./phone-readiness";
import { campaignView, contributions, type campaignData } from "./data";
import { recordedTimingPolicy } from "../settings/policy";
import { pendingReleaseBlockers } from "../reviews/release-integrations";
import type { Blocker } from "../../../shared/contracts/giveaway";
export async function readiness(
  db: pg.PoolClient,
  c: NonNullable<Awaited<ReturnType<typeof campaignData>>>,
  adminId: string,
) {
  const phone = await phoneReadiness(
    db,
    c.id,
    c.latest_snapshot_id ? "revision" : "initial",
  );
  phone.policyVersion = await recordedReconciliationPolicy(db, c.station_id);
  const bounds =
    c.start_us && c.cutoff_us && c.launch_us && c.deadline_us
      ? {
          id: c.id,
          settingsVersionId: c.current_timing_version_id,
          launch: c.launch_us,
          start: c.start_us,
          cutoff: c.cutoff_us,
          deadline: c.deadline_us,
        }
      : null;
  const sources = await contributions(
    db,
    c.station_id,
    bounds,
    phone.partialExclusions,
  );
  const excludedTargets = new Set(
    (
      await db.query<{ id: string }>(
        `SELECT DISTINCT source->>'purchaseId' id FROM giveaway_phone_exclusion e CROSS JOIN LATERAL jsonb_array_elements(e.content->'partialSources') source WHERE e.campaign_id=$1`,
        [c.id],
      )
    ).rows.map((r) => r.id),
  );
  const relevant = sources
    .filter(
      (s) =>
        s.phoneExclusionId ||
        excludedTargets.has(s.purchaseId) ||
        (!s.reasons.includes("outside_period") &&
          !s.reasons.includes("before_launch")),
    )
    .map((s) => s.purchaseId);
  const ordinary = (
    await db.query<{ kind: string; id: string }>(
      `SELECT 'holds' kind,purchase_id id FROM purchase_hold WHERE state='open' AND purchase_id=ANY($1::uuid[])
 UNION SELECT 'corrections',purchase_id FROM correction_request WHERE state IN ('pending_validation','awaiting_review') AND purchase_id=ANY($1::uuid[])
 UNION SELECT 'duplicateFlags',purchase_id FROM duplicate_flag WHERE state='open' AND (purchase_id=ANY($1::uuid[]) OR other_purchase_id=ANY($1::uuid[]))
 UNION SELECT 'policyBlocks',purchase_id FROM purchase_validation_block WHERE resolved_at IS NULL AND purchase_id=ANY($1::uuid[])`,
      [relevant],
    )
  ).rows;
  const pending = await pendingReleaseBlockers(db, c.station_id);
  const sets = {
    holds: new Set<string>(),
    corrections: new Set<string>(),
    duplicateFlags: new Set<string>(),
    uploads: new Set<string>(),
    policyBlocks: new Set<string>(),
  };
  for (const row of ordinary) sets[row.kind as keyof typeof sets].add(row.id);
  // Pending/stale proposals block even when the underlying target looks closed or policy is inactive.
  for (const id of pending.holds) sets.holds.add(id);
  for (const id of pending.policyBlocks) sets.policyBlocks.add(id);
  for (const source of sources)
    if (
      relevant.includes(source.purchaseId) &&
      !source.phoneExclusionId &&
      (source.reasons.includes("incomplete") ||
        source.reasons.includes("evidence_deadline_unresolved"))
    )
      sets.uploads.add(source.purchaseId);
  const blockers: Blocker[] = [...phone.blockers];
  if (!bounds) blockers.push("campaign_unconfigured");
  if (!(await recordedTimingPolicy(db, c.station_id)))
    blockers.push("timing_policy_unconfigured");
  if (!phone.policyVersion) blockers.push("reconciliation_policy_unconfigured");
  if (!c.after_cutoff) blockers.push("before_cutoff");
  if (!c.after_deadline) blockers.push("grace_open");
  if (
    sets.holds.size ||
    sets.corrections.size ||
    sets.duplicateFlags.size ||
    pending.holds.length ||
    pending.policyBlocks.length
  )
    blockers.push("reviews_unresolved");
  if (sets.uploads.size) blockers.push("uploads_unresolved");
  if (
    sets.policyBlocks.size ||
    sources.some((s) => s.reasons.includes("timing_unresolved"))
  )
    blockers.push("eligibility_unresolved");
  const canPrepare = blockers.length === 0;
  if (c.reconciliation_required) blockers.push("reconciliation_required");
  const preview =
    canPrepare && !c.reconciliation_required
      ? (
          await db.query(
            `SELECT 1 FROM giveaway_preview p WHERE p.campaign_id=$1 AND p.expires_at>clock_timestamp() AND p.content->'createdBy'->>'id'=$2 AND p.content->'guard'->>'expectedVersion'=$3 AND NOT EXISTS(SELECT 1 FROM giveaway_preview_consumption x WHERE x.preview_id=p.id) LIMIT 1`,
            [c.id, adminId, String(c.version)],
          )
        ).rowCount
      : 0;
  return {
    view: {
      campaign: campaignView(c),
      asOf: c.now.toISOString(),
      canPrepare,
      canConfirm:
        Boolean(preview) &&
        c.reconciled_data_version !== null &&
        String(c.reconciled_data_version) === c.data_version,
      blockers: [...new Set(blockers)],
      counts: Object.fromEntries(
        Object.entries(sets).map(([k, v]) => [k, String(v.size)]),
      ),
      reconciliationPolicyVersion: phone.policyVersion,
      phoneCheck: phone.status,
    },
    sources,
    phone,
    relevant,
    ordinary,
    pending,
    sets,
  };
}

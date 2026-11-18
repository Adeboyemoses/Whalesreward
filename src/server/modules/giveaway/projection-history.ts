import type pg from "pg";
import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import { storedChecklistSchema } from "../../../shared/contracts/giveaway-projections";
import { AuthError } from "../auth/errors";
import { retained } from "./projection-selections";

// Validate the protected preparation record before selecting its public fields.
// Its source digest is evidence, never something a read can reconstruct or repair.
const reconciliationEvidence = z
  .strictObject({
    checks: storedChecklistSchema.shape.checks,
    actor: storedChecklistSchema.shape.actor,
    actorId: authId,
    operationId: authId,
    reason: storedChecklistSchema.shape.reason,
    auditEventId: authId,
    checkedAt: z.iso.datetime(),
    timingPolicyVersion: z.literal("campaign-timing-v1"),
    outcome: storedChecklistSchema.shape.outcome,
    currentSnapshotId: authId.nullable(),
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    phoneCheckId: authId,
    approvedExclusionIds: z.array(authId).max(100),
    policyVersion: z.literal("reconciliation-v1"),
    settingsVersionId: authId,
  })
  .superRefine((v, ctx) => {
    if (v.actorId !== v.actor.id)
      ctx.addIssue({ code: "custom", message: "Actor binding mismatch" });
    if (v.outcome === "unchanged" && !v.currentSnapshotId)
      ctx.addIssue({
        code: "custom",
        message: "Unchanged requires predecessor",
      });
    if (new Set(v.approvedExclusionIds).size !== v.approvedExclusionIds.length)
      ctx.addIssue({ code: "custom", message: "Duplicate exclusion identity" });
  });
const phonePins = z.object({
  id: authId,
  campaignId: authId,
  kind: z.enum(["initial", "revision"]),
  sourceDataVersion: z.string().regex(/^(0|[1-9][0-9]*)$/),
  settingsVersionId: authId,
  previousSnapshotId: authId.nullable(),
  policyVersion: z.literal("reconciliation-v1"),
});
const entryPins = z
  .array(
    z
      .object({
        result: z.enum(["empty", "unavailable"]),
        exclusionId: authId.nullable(),
      })
      .refine((v) => (v.result === "empty") === (v.exclusionId === null)),
  )
  .max(100);
function unavailable(): never {
  throw new AuthError("temporarily_unavailable", 503);
}

export async function storedProjection(
  db: pg.PoolClient,
  stationId: string,
  campaignId: string,
  id: string,
) {
  const r = (
    await db.query(
      `SELECT id,campaign_id,phone_check_id,source_data_version::text,content,
 to_char(checked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') checked_text,
 actor_id,operation_id,settings_version_id,policy_version,timing_policy_version,audit_event_id,
 current_snapshot_id,outcome,reason
 FROM giveaway_reconciliation WHERE id=$1 AND campaign_id=$2 AND station_id=$3`,
      [id, campaignId, stationId],
    )
  ).rows[0];
  if (!r) throw new AuthError("not_found", 404);
  const v = retained(reconciliationEvidence, r.content);
  const checked = v.checkedAt.replace(
    /(?:\.(\d+))?Z$/,
    (_, fraction: string | undefined) =>
      `.` + (fraction ?? "").padEnd(6, "0") + "Z",
  );
  if (
    v.phoneCheckId !== r.phone_check_id ||
    checked !== r.checked_text ||
    v.actorId !== r.actor_id ||
    v.operationId !== r.operation_id ||
    v.settingsVersionId !== r.settings_version_id ||
    v.policyVersion !== r.policy_version ||
    v.timingPolicyVersion !== r.timing_policy_version ||
    v.auditEventId !== r.audit_event_id ||
    v.currentSnapshotId !== r.current_snapshot_id ||
    v.outcome !== r.outcome ||
    v.reason !== r.reason
  )
    unavailable();
  const check = (
    await db.query(
      "SELECT content,entries FROM giveaway_phone_check WHERE id=$1 AND campaign_id=$2",
      [v.phoneCheckId, campaignId],
    )
  ).rows[0];
  const pins = retained(phonePins, check?.content),
    entries = retained(entryPins, check?.entries);
  const kind = v.currentSnapshotId ? "revision" : "initial";
  if (
    pins.id !== v.phoneCheckId ||
    pins.campaignId !== campaignId ||
    pins.kind !== kind ||
    pins.sourceDataVersion !== r.source_data_version ||
    pins.settingsVersionId !== v.settingsVersionId ||
    pins.previousSnapshotId !== v.currentSnapshotId ||
    pins.policyVersion !== v.policyVersion
  )
    unavailable();
  const exclusions = entries
    .filter((e) => e.result === "unavailable")
    .map((e) => e.exclusionId);
  if (
    exclusions.some((e) => !e) ||
    JSON.stringify([...exclusions].sort()) !==
      JSON.stringify([...v.approvedExclusionIds].sort())
  )
    unavailable();
  if (v.approvedExclusionIds.length) {
    const bound = (
      await db.query(
        "SELECT id FROM giveaway_phone_exclusion WHERE campaign_id=$1 AND id=ANY($2::uuid[])",
        [campaignId, v.approvedExclusionIds],
      )
    ).rows;
    if (bound.length !== v.approvedExclusionIds.length) unavailable();
  }
  return retained(storedChecklistSchema, {
    id: r.id,
    campaignId: r.campaign_id,
    kind,
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

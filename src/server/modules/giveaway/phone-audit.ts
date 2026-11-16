import {
  giveawayAuditMapping,
  m4GiveawayAuditSchema,
} from "../../../shared/contracts/audit";
import { newId } from "../../lib/ids";
import { auditActor } from "../audit/write";
import { writeGiveawayAudit } from "../audit/write-giveaway";
import type { PhoneAudit } from "./phones";
const reasons: Record<string, string> = {
  giveaway_manager_designated: "Campaign manager designated",
  giveaway_phone_census_recorded: "Phone census recorded",
  giveaway_phone_check_recorded: "Phone check recorded",
  giveaway_phone_unavailable_proposed: "Phone unavailable proposed",
  giveaway_phone_unavailable_approved: "Phone unavailable approved",
  giveaway_phone_unavailable_rejected: "Phone unavailable rejected",
};
export const phoneAudit: PhoneAudit = async (
  db,
  actor,
  campaignId,
  operationId,
  action,
  fields,
  related = [],
) => {
  const c = (
    await db.query(
      `SELECT c.*,s.data_version::text,sp.policy_version FROM campaign c JOIN station_reporting_state s ON s.station_id=c.station_id LEFT JOIN station_reconciliation_policy sp ON sp.station_id=c.station_id WHERE c.id=$1`,
      [campaignId],
    )
  ).rows[0];
  const manager = c.manager_designation_id
    ? (
        await db.query(
          "SELECT manager_admin_id FROM giveaway_manager_designation WHERE id=$1",
          [c.manager_designation_id],
        )
      ).rows[0]?.manager_admin_id
    : null;
  const values: Record<string, unknown> = {
    campaignVersion: c.version + 1,
    sourceDataVersion: (BigInt(c.data_version) + 1n).toString(),
    managerAdminId: manager,
    settingsVersionId: c.current_timing_version_id,
    reconciliationPolicyVersion: c.policy_version,
    ...fields,
  };
  const mapping =
    giveawayAuditMapping[action as keyof typeof giveawayAuditMapping];
  const id = newId(),
    event = m4GiveawayAuditSchema.parse({
      id,
      eventCode: `AUD-${id}`,
      schemaVersion: 2,
      stationId: c.station_id,
      occurredAt: (
        await db.query("SELECT clock_timestamp() AS at")
      ).rows[0].at.toISOString(),
      area: "giveaway",
      action,
      actor: await auditActor(db, actor.user_id),
      originatingSeller: null,
      target: {
        kind: "campaign",
        id: campaignId,
        code: `CAMPAIGN-${campaignId}`,
        subjectAtEvent: null,
      },
      operationId,
      correlationId: operationId,
      reason: reasons[action],
      changes: mapping.map((field) => ({
        field,
        before: null,
        after:
          typeof values[field] === "number"
            ? String(values[field])
            : values[field],
      })),
      relatedEventIds: related,
    });
  await writeGiveawayAudit(db, event);
  return id;
};

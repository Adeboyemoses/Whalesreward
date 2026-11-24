import { config, fixtureId } from "./cards-adversarial-fixture";
import { newId } from "../../src/server/lib/ids";
import { createPhoneService } from "../../src/server/modules/giveaway/phones";
import { phoneAudit } from "../../src/server/modules/giveaway/phone-audit";
import {
  campaignData,
  campaignView,
} from "../../src/server/modules/giveaway/data";
import { readCampaign } from "../../src/server/modules/giveaway/service";
export async function giveawayAtStation(
  pool: import("pg").Pool,
  stationId: string,
  token: string,
) {
  const f = { pool };
  const existing = (
    await pool.query("SELECT id FROM campaign WHERE station_id=$1", [stationId])
  ).rows[0];
  const campaignId = existing?.id ?? newId(),
    settingsId = newId();
  if (!existing)
    await f.pool.query(
      "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional giveaway',1,true)",
      [campaignId, stationId],
    );
  await f.pool.query(
    "INSERT INTO settings_version(id,station_id,campaign_id,version,section,launch_at,purchase_start,purchase_cutoff,grace_hours,upload_deadline,timezone,effective_from,actor_id,reason,timing_policy_version,previous_version_id) VALUES($1,$2,$3,(SELECT coalesce(max(version),0)+1 FROM settings_version WHERE station_id=$2),'giveaway',statement_timestamp()-interval '3 days',statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day',0,statement_timestamp()-interval '1 day','Africa/Lagos',statement_timestamp()-interval '4 days',$4,'Fictional completed campaign','campaign-timing-v1',(SELECT id FROM settings_version WHERE station_id=$2 ORDER BY version DESC LIMIT 1))",
    [settingsId, stationId, campaignId, fixtureId(5)],
  );
  await f.pool.query(
    "UPDATE campaign SET current_timing_version_id=$2,version=version+1 WHERE id=$1",
    [campaignId, settingsId],
  );
  const binding = (
    await pool.query(
      "SELECT 1 FROM held_release_person_binding WHERE station_id=$1 AND user_id=$2",
      [stationId, fixtureId(2)],
    )
  ).rowCount;
  if (!binding) {
    const person = newId();
    await f.pool.query(
      "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
      [person, stationId],
    );
    await f.pool.query(
      "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,1,true)",
      [newId(), stationId, fixtureId(2), person],
    );
  }
  const phones = createPhoneService(
    f.pool,
    config,
    phoneAudit,
    async (db, id) => campaignView((await campaignData(db, stationId, id))!),
  );
  async function guard() {
    const c = (await readCampaign(f.pool, token)).campaign!;
    return {
      expectedVersion: c.version,
      expectedSettingsVersionId: c.settingsVersionId,
      expectedDataVersion: c.dataVersion,
      expectedPreviousSnapshotId: c.latestSnapshotId,
    };
  }
  await phones.designate(token, campaignId, {
    operationId: newId(),
    expectedVersion: (await guard()).expectedVersion,
    managerAdminId: fixtureId(5),
    reason: "Fictional manager designation",
  });
  async function check(kind: "initial" | "revision" = "initial") {
    const census = (
      await f.pool.query(
        "SELECT coalesce(max(version),1) v FROM giveaway_phone_census WHERE campaign_id=$1",
        [campaignId],
      )
    ).rows[0].v;
    const attendants = (
      await f.pool.query("SELECT DISTINCT attendant_id FROM assignment")
    ).rows.map((r) => r.attendant_id);
    await phones.census(token, campaignId, {
      operationId: newId(),
      kind,
      reason: "Fictional physical census",
      ...(await guard()),
      expectedCensusVersion: census,
      phones: [{ label: "Fictional handset", attendantIds: attendants }],
    });
    const row = (
      await f.pool.query(
        "SELECT content FROM giveaway_phone_census WHERE campaign_id=$1 ORDER BY version DESC LIMIT 1",
        [campaignId],
      )
    ).rows[0].content;
    await phones.check(token, campaignId, {
      operationId: newId(),
      kind,
      reason: "Fictional phone inspection",
      ...(await guard()),
      expectedCensusVersion: census + 1,
      entries: row.phones.map((p: { id: string; version: number }) => ({
        phoneId: p.id,
        expectedPhoneVersion: p.version,
        result: "empty",
        exclusionId: null,
      })),
    });
  }
  return { ...f, token, campaignId, phones, guard, check };
}

import { cardsFixture, config, fixtureId } from "./cards-adversarial-fixture";
import { newId } from "../../src/server/lib/ids";
import { createPhoneService } from "../../src/server/modules/giveaway/phones";
import { phoneAudit } from "../../src/server/modules/giveaway/phone-audit";
import {
  campaignData,
  campaignView,
} from "../../src/server/modules/giveaway/data";
import { readCampaign } from "../../src/server/modules/giveaway/service";
export async function giveawayFixture() {
  const f = await cardsFixture(),
    token = await f.owner(),
    campaignId = newId(),
    settingsId = newId();
  await f.pool.query(
    "INSERT INTO campaign(id,station_id,name,version,reconciliation_required) VALUES($1,$2,'Fictional giveaway',1,true)",
    [campaignId, fixtureId(8)],
  );
  await f.pool.query(
    "INSERT INTO settings_version(id,station_id,campaign_id,version,section,launch_at,purchase_start,purchase_cutoff,grace_hours,upload_deadline,timezone,effective_from,actor_id,reason,timing_policy_version) VALUES($1,$2,$3,1,'giveaway',statement_timestamp()-interval '3 days',statement_timestamp()-interval '2 days',statement_timestamp()-interval '1 day',0,statement_timestamp()-interval '1 day','Africa/Lagos',statement_timestamp()-interval '4 days',$4,'Fictional completed campaign','campaign-timing-v1')",
    [settingsId, fixtureId(8), campaignId, fixtureId(5)],
  );
  await f.pool.query(
    "UPDATE campaign SET current_timing_version_id=$2,version=version+1 WHERE id=$1",
    [campaignId, settingsId],
  );
  await f.pool.query(
    "INSERT INTO reconciliation_policy_definition(policy_version,evaluator_identity,approval_reference,partial_uploads) VALUES('reconciliation-v1','reconciliation-v1','WHR-158 / WHR-162 / Earl 16 Nov 2026','exact_incomplete') ON CONFLICT DO NOTHING",
  );
  await f.pool.query(
    "INSERT INTO station_reconciliation_policy(station_id,policy_version) VALUES($1,'reconciliation-v1')",
    [fixtureId(8)],
  );
  const person = newId();
  await f.pool.query(
    "INSERT INTO held_release_person(id,station_id) VALUES($1,$2)",
    [person, fixtureId(8)],
  );
  await f.pool.query(
    "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,1,true)",
    [newId(), fixtureId(8), fixtureId(2), person],
  );
  const phones = createPhoneService(
    f.pool,
    config,
    phoneAudit,
    async (db, id) => campaignView((await campaignData(db, fixtureId(8), id))!),
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

/** Retained proposal history for stale/inactive-policy readiness regression. */
export async function pendingGiveawayProposal(
  f: Awaited<ReturnType<typeof giveawayFixture>>,
  purchaseId: string,
) {
  const sheet = newId(),
    proposal = newId();
  const person = (
    await f.pool.query(
      "SELECT person_id FROM held_release_person_binding WHERE user_id=$1 ORDER BY version DESC LIMIT 1",
      [fixtureId(2)],
    )
  ).rows[0].person_id;
  await f.pool.query(
    "INSERT INTO held_release_sheet(id,purchase_id,station_id,uploader_id,uploader_person_id,target,sha256,bytes,staging_key,expires_at) VALUES($1,$2,$3,$4,$5,'{}',$6,100,$7,clock_timestamp()+interval '1 hour')",
    [
      sheet,
      purchaseId,
      fixtureId(8),
      fixtureId(2),
      person,
      "a".repeat(64),
      `fictional/${sheet}`,
    ],
  );
  await f.pool.query(
    "INSERT INTO held_release_proposal(id,purchase_id,station_id,target_kind,outcome,sheet_asset_id,proposer_id,proposer_person_id,content,provenance) VALUES($1,$2,$3,'capture','confirm',$4,$5,$6,'{}','{}')",
    [proposal, purchaseId, fixtureId(8), sheet, fixtureId(2), person],
  );
  const db = await f.pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "INSERT INTO held_release_transition(id,proposal_id,version,state,actor_id,content) VALUES($1,$2,1,'pending',$3,'{}')",
      [newId(), proposal, fixtureId(2)],
    );
    await db.query(
      "INSERT INTO held_release_state(proposal_id,purchase_id) VALUES($1,$2)",
      [proposal, purchaseId],
    );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
  return proposal;
}

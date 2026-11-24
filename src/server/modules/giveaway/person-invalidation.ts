import type pg from "pg";

/** Caller holds the exclusive security_state lock through commit. */
export async function invalidatePersonDependants(
  db: pg.PoolClient,
  stationId: string,
  changedUserIds: readonly string[],
) {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('reporting:'||$1::text,0))",
    [stationId],
  );
  const state = (
    await db.query<{ data_version: string }>(
      "SELECT data_version::text FROM station_reporting_state WHERE station_id=$1 FOR UPDATE",
      [stationId],
    )
  ).rows[0];
  if (!state) throw new Error("person_invalidation_state_missing");
  const before = state.data_version;
  const campaigns = (
    await db.query<{ id: string; version: number; manager_cleared: boolean }>(
      `SELECT c.id,c.version,EXISTS(SELECT 1 FROM giveaway_manager_designation d JOIN admin a ON a.id=d.manager_admin_id WHERE d.id=c.manager_designation_id AND a.user_id=ANY($2::uuid[])) manager_cleared
       FROM campaign c WHERE c.station_id=$1 ORDER BY c.id FOR UPDATE OF c`,
      [stationId, changedUserIds],
    )
  ).rows;
  await db.query(
    "UPDATE station_reporting_state SET data_version=data_version+1,last_writer_transaction=pg_current_xact_id() WHERE station_id=$1 AND last_writer_transaction IS DISTINCT FROM pg_current_xact_id()",
    [stationId],
  );
  const dataVersion = (
    await db.query<{ data_version: string }>(
      "SELECT data_version::text FROM station_reporting_state WHERE station_id=$1",
      [stationId],
    )
  ).rows[0]!.data_version;
  for (const c of campaigns) {
    await db.query(
      "INSERT INTO person_identity_invalidation(campaign_id,old_version,new_version) VALUES($1,$2,$3)",
      [c.id, c.version, c.version + 1],
    );
    await db.query(
      "UPDATE campaign SET version=version+1,reconciliation_required=true,phone_check_id=NULL,manager_designation_id=CASE WHEN $2 THEN NULL ELSE manager_designation_id END WHERE id=$1",
      [c.id, c.manager_cleared],
    );
  }
  return {
    dataVersion,
    campaigns: campaigns.map((c) => ({
      id: c.id,
      oldVersion: c.version,
      version: c.version + 1,
      oldDataVersion: before,
      dataVersion,
      managerCleared: c.manager_cleared,
    })),
  };
}

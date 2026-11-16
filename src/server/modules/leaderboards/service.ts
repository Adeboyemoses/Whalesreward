import type pg from "pg";
import type { AdminConfig } from "../admin-access/config";
import { transaction } from "../admin-access/repo";
import { page } from "../reports/data";
import { leaderboardQuery } from "../../../shared/contracts/giveaway";
import {
  authority,
  campaignData,
  campaignView,
  contributions,
  ranking,
} from "../giveaway/data";
import { recordedTimingPolicy } from "../settings/policy";
export async function readLeaderboards(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  input: unknown,
) {
  const q = leaderboardQuery.parse(input);
  return transaction(pool, async (db) => {
    const { actor, station } = await authority(db, token);
    const c =
      q.basis === "campaign_qualifying"
        ? await campaignData(db, station.id, q.campaignId)
        : null;
    const stamp = (
      await db.query(
        "SELECT clock_timestamp() now,data_version::text version FROM station_reporting_state WHERE station_id=$1",
        [station.id],
      )
    ).rows[0]!;
    const base = {
      asOf: stamp.now.toISOString(),
      dataVersion: stamp.version,
      basis: q.basis,
      category: q.category ?? null,
      campaign: c ? campaignView(c) : null,
      tieRule: "competition_v1" as const,
    };
    if (
      q.basis === "campaign_qualifying" &&
      (!c?.start_us ||
        !c?.cutoff_us ||
        !c?.launch_us ||
        !c?.deadline_us ||
        !(await recordedTimingPolicy(db, station.id)))
    )
      return {
        ...base,
        state: "unconfigured",
        items: [],
        nextCursor: null,
        customers: "0",
        summary: null,
      };
    const bounds = c
      ? {
          id: c.id,
          settingsVersionId: c.current_timing_version_id,
          launch: c.launch_us,
          start: c.start_us,
          cutoff: c.cutoff_us,
          deadline: c.deadline_us,
        }
      : null;
    const data = ranking(
      await contributions(db, station.id, bounds),
      q.category,
    );
    return {
      ...base,
      state: c ? "provisional" : "recorded",
      summary: data.summary,
      customers: data.customers,
      ...page(
        data.rows,
        q.limit,
        config.secret,
        JSON.stringify([
          station.id,
          actor.admin_id,
          q.basis,
          q.campaignId ?? null,
          q.category ?? null,
        ]),
        stamp.version,
        q.cursor,
      ),
    };
  });
}

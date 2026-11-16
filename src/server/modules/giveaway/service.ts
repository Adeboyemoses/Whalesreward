import type pg from "pg";
import { transaction } from "../admin-access/repo";
import { authority, campaignData, campaignView } from "./data";
import { readiness } from "./readiness";
export async function readCampaign(pool: pg.Pool, token: string | undefined) {
  return transaction(pool, async (db) => {
    const { station } = await authority(db, token);
    const c = await campaignData(db, station.id);
    return { campaign: c ? campaignView(c) : null };
  });
}
export async function readReadiness(
  pool: pg.Pool,
  token: string | undefined,
  campaignId: string,
) {
  return transaction(pool, async (db) => {
    const { actor, station } = await authority(db, token);
    const c = await campaignData(db, station.id, campaignId);
    return (await readiness(db, c!, actor.admin_id)).view;
  });
}
export { prepareGiveaway, confirmGiveaway } from "./mutations";

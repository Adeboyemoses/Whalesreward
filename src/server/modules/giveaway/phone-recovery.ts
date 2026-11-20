import type pg from "pg";

/** Caller holds the security, reporting and campaign locks.
 * Approval history requires replacement of the census before a phone can be
 * certified empty, even when the old exclusion is no longer applicable.
 */
export async function hasSameCensusRecovery(
  db: pg.PoolClient,
  campaignId: string,
  censusId: string,
  entries: { phoneId: string; result: string }[],
) {
  const emptyPhones = entries
    .filter((entry) => entry.result === "empty")
    .map((entry) => entry.phoneId);
  if (emptyPhones.length === 0) return false;
  return Boolean(
    (
      await db.query(
        `SELECT 1 FROM giveaway_phone_exclusion e
         JOIN giveaway_phone_exclusion_transition t ON t.exclusion_id=e.id AND t.state='approved'
         WHERE e.campaign_id=$1 AND e.census_id=$2
         AND e.content->>'phoneId'=ANY($3::text[]) LIMIT 1`,
        [campaignId, censusId, emptyPhones],
      )
    ).rowCount,
  );
}

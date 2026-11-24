import type pg from "pg";
import { AuthError } from "../auth/errors";

export type ReleasePerson = {
  personId: string;
  bindingId: string;
  version: number;
};
/** Caller holds the security-state lock through commit. Unknown/ambiguous bindings deny. */
export async function releasePerson(
  db: Pick<pg.PoolClient, "query">,
  stationId: string,
  userId: string,
): Promise<ReleasePerson> {
  const row = (
    await db.query<{
      id: string;
      person_id: string;
      version: number;
      verified: boolean;
    }>(
      `SELECT id,person_id,version,verified FROM held_release_person_binding
      WHERE station_id=$1 AND user_id=$2 ORDER BY version DESC LIMIT 1`,
      [stationId, userId],
    )
  ).rows[0];
  if (!row?.verified) throw new AuthError("independence_unverifiable", 403);
  return { personId: row.person_id, bindingId: row.id, version: row.version };
}
type IndependenceOptions = {
  allowRevokedExcluded?: boolean;
  frozenProposer?: { userId: string; person: ReleasePerson };
};

/** Retain every verified association: correcting an account cannot launder self-review. */
export async function requireIndependentReleasePerson(
  db: Pick<pg.PoolClient, "query">,
  stationId: string,
  actorUserId: string,
  excludedUserIds: readonly string[],
  options: IndependenceOptions = {},
): Promise<ReleasePerson> {
  const actor = await releasePerson(db, stationId, actorUserId);
  for (const userId of new Set(excludedUserIds)) {
    const rows = (
      await db.query<{
        id: string;
        person_id: string;
        version: number;
        verified: boolean;
      }>(
        `SELECT id,person_id,version,verified FROM held_release_person_binding
         WHERE station_id=$1 AND user_id=$2 ORDER BY version DESC`,
        [stationId, userId],
      )
    ).rows;
    const current = rows[0];
    // Rejection can close a stale proposal after revocation, but must still
    // resolve retained verified history for every excluded account.
    if (
      !current ||
      !rows.some((r) => r.verified) ||
      (!options.allowRevokedExcluded && !current.verified)
    )
      throw new AuthError("independence_unverifiable", 403);
    if (options.frozenProposer?.userId === userId) {
      const frozen = options.frozenProposer.person;
      if (
        !frozen ||
        !rows.some(
          (r) =>
            r.verified &&
            r.id === frozen.bindingId &&
            r.person_id === frozen.personId &&
            r.version === frozen.version,
        )
      )
        throw new AuthError("independence_unverifiable", 403);
    }
    if (
      rows.some(
        (r) =>
          (r.verified || r.id === current.id) && r.person_id === actor.personId,
      )
    )
      throw new AuthError("independent_reviewer_required", 403);
  }
  return actor;
}

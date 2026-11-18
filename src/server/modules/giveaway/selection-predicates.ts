/** SQL fragments shared by guarded writes and their read-only candidate projections. */
export const managerCandidatePredicate = `u.enabled AND u.kind='admin' AND r.enabled AND NOT u.must_change_password
 AND (SELECT count(DISTINCT permission_code) FROM role_permission WHERE role_id=r.id AND permission_code=ANY($3::text[]))=3`;
export const requiredAttendantsQuery = `SELECT DISTINCT a.attendant_id AS id FROM assignment a JOIN pump p ON p.id=a.pump_id WHERE p.station_id=$1 UNION SELECT originating_attendant_id AS id FROM purchase WHERE station_id=$1 ORDER BY id`;
/** The caller independently checks expected versions only after structural eligibility. */
export function incompleteCandidate(
  p:
    | {
        originating_attendant_id: string;
        current_revision_id: string | null;
        ever_accepted: boolean;
        status: string;
        observed: boolean;
      }
    | undefined,
  partitions: readonly string[],
) {
  return Boolean(
    p &&
    partitions.includes(p.originating_attendant_id) &&
    !p.current_revision_id &&
    !p.ever_accepted &&
    ["received", "photo_pending"].includes(p.status) &&
    !p.observed,
  );
}

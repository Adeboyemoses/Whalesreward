import type pg from "pg";
import { AuthError } from "../auth/errors";

/** Fresh use only. Historical receipts and already attached proposal reads do not
 * reinterpret the uploader's old binding through the account's current person. */
export async function requireCurrentReleaseSheetBinding(
  db: Pick<pg.PoolClient, "query">,
  sheetId: string,
  purchaseId: string,
  error: "proposal_stale" | "evidence_unavailable" = "proposal_stale",
) {
  const current = await db.query(
    `SELECT 1 FROM held_release_sheet s
     JOIN LATERAL(SELECT id,person_id,version,verified FROM held_release_person_binding
       WHERE station_id=s.station_id AND user_id=s.uploader_id ORDER BY version DESC LIMIT 1)b
       ON b.id=s.uploader_binding_id AND b.version=s.uploader_binding_version
       AND b.person_id=s.uploader_person_id AND b.verified
     WHERE s.id=$1 AND s.purchase_id=$2`,
    [sheetId, purchaseId],
  );
  if (!current.rowCount)
    throw new AuthError(error, error === "proposal_stale" ? 409 : 422);
}

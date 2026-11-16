import type pg from "pg";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { AuthError } from "../auth/errors";
import { requireIndependentReleasePerson } from "./release-people";
import type { ReleaseTarget } from "../../../shared/contracts/held-release";

/** Security lock precedes policy/domain locks. Does not lock or change purchases. */
export async function releaseAuthority(
  db: pg.PoolClient,
  token: string | undefined,
  kind: ReleaseTarget["kind"],
  purchaseId: string,
) {
  await securityLock(db);
  const live = await requireAdminSession(db, token);
  requirePermission(live, "sales");
  requirePermission(
    live,
    {
      price: "priceReview",
      card: "cardEligibility",
      date: "dateReview",
      capture: "dateReview",
    }[kind] as "priceReview" | "cardEligibility" | "dateReview",
  );
  const stations = (
    await db.query<{ id: string }>("SELECT id FROM station ORDER BY id LIMIT 2")
  ).rows;
  if (stations.length !== 1) throw new AuthError("permission_denied", 403);
  const stationId = stations[0]!.id;
  const purchase = (
    await db.query<{
      id: string;
      station_id: string;
      originating_attendant_id: string;
      operation_id: string;
    }>(
      "SELECT id,station_id,originating_attendant_id,operation_id FROM purchase WHERE id=$1 AND station_id=$2",
      [purchaseId, stationId],
    )
  ).rows[0];
  if (!purchase) throw new AuthError("not_found", 404);
  const exclusions = (
    await db.query<{ user_id: string }>(
      `SELECT user_id FROM attendant WHERE id=$1
    UNION SELECT a.user_id FROM correction_request c JOIN admin a ON a.id=c.recovery_executor_id OR a.id=c.recovery_authorizing_admin_id WHERE c.purchase_id=$2
    UNION SELECT a.user_id FROM recovery_grant g JOIN recovery_grant_item i ON i.grant_id=g.id JOIN admin a ON a.id=g.admin_id WHERE g.originating_attendant_id=$1 AND i.operation_id=$3`,
      [purchase.originating_attendant_id, purchaseId, purchase.operation_id],
    )
  ).rows.map((r) => r.user_id);
  if (!exclusions.length) throw new AuthError("independence_unverifiable", 403);
  const person = await requireIndependentReleasePerson(
    db,
    stationId,
    live.user_id,
    exclusions,
  );
  return { actor: { ...live, stationId }, person, purchase, exclusions };
}

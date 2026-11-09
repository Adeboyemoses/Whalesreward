import type pg from "pg";
import { lockAssignmentHistory } from "../../lib/assignment-history-lock";
import { AuthError } from "./errors";
import {
  attendantSessionSchema,
  restrictedAttendantSessionSchema,
  type AttendantSession,
} from "../../../shared/contracts/auth";

export type LiveSession = {
  id: string;
  user_id: string;
  expires_at: Date;
  created_at: Date;
  capture_context_id: string | null;
  access_scope: string;
  must_change_password: boolean;
};
export async function liveSession(
  db: pg.PoolClient,
  verifier: string,
  restricted = false,
): Promise<LiveSession> {
  // Take the boundary lock in a separate statement before opening the authority
  // snapshot. Offboarding and sign-in use this same transaction lifetime lock.
  const identity = (
    await db.query<{ user_id: string }>(
      "SELECT user_id FROM auth_session WHERE secret_verifier=$1",
      [verifier],
    )
  ).rows[0];
  if (!identity) throw new AuthError("unauthenticated", 401);
  await lockAssignmentHistory(db, identity.user_id, "read");
  const result = await db.query<LiveSession>(
    `SELECT s.id,s.user_id,s.expires_at,s.created_at,s.capture_context_id,s.access_scope,u.must_change_password
 FROM auth_session s JOIN auth_user u ON u.id=s.user_id
 WHERE s.secret_verifier=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
 AND u.enabled AND u.kind='attendant' AND u.auth_version=s.auth_version
 AND EXISTS(SELECT 1 FROM attendant a JOIN assignment ag ON ag.attendant_id=a.id WHERE a.user_id=u.id AND ag.effective_until IS NULL AND ag.effective_from<=clock_timestamp())
 FOR SHARE OF s,u`,
    [verifier],
  );
  if (!result.rows[0]) throw new AuthError("unauthenticated", 401);
  if (
    !restricted &&
    (result.rows[0].access_scope !== "full" ||
      result.rows[0].must_change_password)
  )
    throw new AuthError("password_change_required", 403);
  return result.rows[0];
}
export async function sessionView(
  db: pg.PoolClient,
  session: LiveSession,
): Promise<AttendantSession> {
  if (session.access_scope !== "full" || session.must_change_password)
    throw new AuthError("password_change_required", 403);
  const result = await db.query(
    `SELECT a.id AS attendant_id,a.staff_code,u.display_name,u.username,
 st.id AS station_id,st.code AS station_code,st.name AS station_name,st.timezone,
 ag.id AS assignment_id,ag.assignment_version,p.id AS pump_id,p.code AS pump_code,
 pr.id AS product_id,pr.code AS product_code,pr.unit,c.id AS context_id,c.signed_in_at,c.offline_expires_at,
 price.id AS price_id,price.version AS price_version,price.rate_kobo::text,price.currency,price.quantity_precision,price.effective_from,
 clock_timestamp() AS now,
 NOT (ag.effective_from<=clock_timestamp() AND (ag.effective_until IS NULL OR ag.effective_until>clock_timestamp())) AS reassigned
 FROM auth_user u JOIN attendant a ON a.user_id=u.id
 JOIN capture_context c ON c.id=$2 AND c.attendant_id=a.id
 JOIN assignment ag ON ag.id=c.assignment_id
 JOIN pump p ON p.id=ag.pump_id AND p.enabled
 JOIN station st ON st.id=p.station_id JOIN product pr ON pr.id=p.product_id
 JOIN LATERAL (SELECT * FROM product_price_version v WHERE v.station_id=st.id AND v.product_id=pr.id AND v.effective_from<=clock_timestamp() ORDER BY v.effective_from DESC LIMIT 1) price ON true
 WHERE u.id=$1 AND c.revoked_at IS NULL`,
    [session.user_id, session.capture_context_id],
  );
  const r = result.rows[0];
  if (!r) throw new AuthError("assignment_unavailable", 422);
  return attendantSessionSchema.parse({
    account: {
      id: r.attendant_id,
      staffCode: r.staff_code,
      name: r.display_name,
      username: r.username,
    },
    station: {
      id: r.station_id,
      code: r.station_code,
      name: r.station_name,
      timezone: r.timezone,
    },
    assignment: { id: r.assignment_id, version: r.assignment_version },
    pump: { id: r.pump_id, code: r.pump_code },
    product: { id: r.product_id, code: r.product_code, unit: r.unit },
    price: {
      priceVersionId: r.price_id,
      version: r.price_version,
      rateKobo: r.rate_kobo,
      currency: r.currency,
      quantityPrecision: r.quantity_precision,
      effectiveFrom: r.effective_from.toISOString(),
      fetchedAt: r.now.toISOString(),
    },
    captureContextId: r.context_id,
    lastOnlineSignInAt: r.signed_in_at.toISOString(),
    offlineExpiresAt: r.offline_expires_at.toISOString(),
    sessionExpiresAt: session.expires_at.toISOString(),
    serverTime: r.now.toISOString(),
    reassignmentRequiresSignIn: r.reassigned,
  });
}

export async function restrictedSessionView(
  db: pg.PoolClient,
  session: LiveSession,
) {
  const r = (
    await db.query(
      "SELECT a.id,a.staff_code,u.display_name,u.username,clock_timestamp() AS now FROM attendant a JOIN auth_user u ON u.id=a.user_id WHERE u.id=$1",
      [session.user_id],
    )
  ).rows[0];
  if (!r) throw new AuthError("unauthenticated", 401);
  return restrictedAttendantSessionSchema.parse({
    state: "password_change_required",
    account: {
      id: r.id,
      staffCode: r.staff_code,
      name: r.display_name,
      username: r.username,
    },
    sessionExpiresAt: session.expires_at.toISOString(),
    serverTime: r.now.toISOString(),
  });
}

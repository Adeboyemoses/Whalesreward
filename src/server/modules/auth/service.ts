import { transaction } from "../../lib/transaction";
import type pg from "pg";
import { APIError } from "better-auth/api";
import type {
  AttendantSession,
  RestrictedAttendantSession,
  SignInInput,
} from "../../../shared/contracts/auth";
import { newId } from "../../lib/ids";
import { attendantAuth } from "../../auth";
import { AUTH_POLICY } from "./config";
import { digest, hmac, sessionSecret } from "./crypto";
import { AuthError } from "./errors";
import { sessionView, restrictedSessionView, type LiveSession } from "./repo";
import { securityLock } from "../../lib/security-lock";
import { requireSession } from "../../lib/authz";
import { consumeLimits } from "./rate-limit";

type Config = { secret: string; origin: string };
type ConfiguredResult = { session: AttendantSession; token: string };
type HttpResult = {
  session: AttendantSession | RestrictedAttendantSession;
  token: string;
};
export function signIn(
  pool: pg.Pool,
  config: Config,
  input: SignInInput,
  key: string,
  ip: string,
  restricted?: false,
): Promise<ConfiguredResult>;
export function signIn(
  pool: pg.Pool,
  config: Config,
  input: SignInInput,
  key: string,
  ip: string,
  restricted: true,
): Promise<HttpResult>;
export async function signIn(
  pool: pg.Pool,
  config: Config,
  input: SignInInput,
  key: string,
  ip: string,
  restricted = false,
) {
  const normalized = input.username.trim().toLowerCase();
  await consumeLimits(pool, config.secret, [
    { key: `in:ip:${ip}`, capacity: 30 },
    { key: `in:user:${normalized}:${ip}`, capacity: 5 },
  ]);
  return transaction(pool, async (db) => {
    await securityLock(db);
    // All retries serialize even when the first request has not committed a receipt.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `attendant-sign-in:${key}`,
    ]);
    const requestHmac = hmac(
      config.secret,
      "sign-in-v1",
      JSON.stringify([normalized, input.password, input.deviceId]),
    );
    const receipt = (
      await db.query<{
        request_hmac: string;
        session_id: string;
        expires_at: Date;
      }>("SELECT * FROM attendant_sign_in_request WHERE request_key=$1", [key])
    ).rows[0];
    let selected: LiveSession | undefined;
    const auth = attendantAuth(db, config, async (userId) => {
      // This callback runs only after Better Auth has verified the current password.
      // Credential verification precedes this check; no assignment details leak
      // for unknown accounts or bad passwords. Both session scopes need it.
      const assignment = await db.query(
        `SELECT ag.id FROM attendant a JOIN assignment ag ON ag.attendant_id=a.id
         JOIN pump p ON p.id=ag.pump_id AND p.enabled
         WHERE a.user_id=$1 AND ag.effective_from<=clock_timestamp()
         AND ag.effective_until IS NULL`,
        [userId],
      );
      // A revoked receipt must keep failing authentication even when the account
      // is subsequently unassigned; it can never mint replacement authority.
      if (receipt) {
        const valid = await db.query(
          "SELECT 1 FROM auth_session s JOIN auth_user u ON u.id=s.user_id WHERE s.id=$1 AND s.revoked_at IS NULL AND s.auth_version=u.auth_version AND u.enabled AND s.expires_at>clock_timestamp()",
          [receipt.session_id],
        );
        if (!valid.rowCount) throw new AuthError("unauthenticated", 401);
      }
      if (!assignment.rowCount)
        throw new AuthError("assignment_unavailable", 422);
      if (receipt) {
        if (receipt.request_hmac !== requestHmac)
          throw new AuthError("operation_conflict", 409);
        if (receipt.expires_at.getTime() <= Date.now())
          throw new AuthError("sign_in_retry_expired", 409);
        selected = await requireSession(
          db,
          digest(sessionSecret(config.secret, receipt.session_id)),
          restricted,
        );
        if (selected.user_id !== userId)
          throw new AuthError("invalid_credentials", 401);
      } else {
        const u = (
          await db.query(
            "SELECT must_change_password,auth_version FROM auth_user WHERE id=$1 AND enabled AND kind='attendant' FOR SHARE",
            [userId],
          )
        ).rows[0];
        if (!u) throw new AuthError("invalid_credentials", 401);
        if (u.must_change_password) {
          if (!restricted) throw new AuthError("password_change_required", 403);
          const id = newId();
          const row = (
            await db.query(
              "INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,access_scope) VALUES($1,$2,$3,clock_timestamp()+interval '15 minutes',$4,clock_timestamp(),'first_password') RETURNING *",
              [
                id,
                userId,
                digest(sessionSecret(config.secret, id)),
                u.auth_version,
              ],
            )
          ).rows[0];
          selected = { ...row, must_change_password: true };
          await db.query(
            "INSERT INTO attendant_sign_in_request VALUES($1,$2,$3,clock_timestamp(),clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '24 hours')",
            [key, requestHmac, id],
          );
          return {
            id,
            userId,
            token: sessionSecret(config.secret, id),
            createdAt: row.created_at,
            updatedAt: row.created_at,
            expiresAt: row.expires_at,
            ipAddress: "",
            userAgent: "",
          };
        }
        const result = await db.query(
          `SELECT u.id AS user_id,u.auth_version,u.display_name,u.username,a.id AS attendant_id,ag.id AS assignment_id,clock_timestamp() AS now
     FROM auth_user u JOIN attendant a ON a.user_id=u.id
     JOIN assignment ag ON ag.attendant_id=a.id AND ag.effective_from<=clock_timestamp() AND (ag.effective_until IS NULL OR ag.effective_until>clock_timestamp())
     JOIN pump p ON p.id=ag.pump_id AND p.enabled
     WHERE u.id=$1 AND u.enabled AND u.kind='attendant' FOR SHARE OF u,a,ag,p`,
          [userId],
        );
        const row = result.rows[0];
        if (!row) throw new AuthError("assignment_unavailable", 422);
        const now: Date = row.now;
        const contextId = newId();
        const sessionId = newId();
        selected = {
          id: sessionId,
          user_id: userId,
          created_at: now,
          expires_at: new Date(now.getTime() + AUTH_POLICY.sessionMs),
          capture_context_id: contextId,
          access_scope: "full",
          must_change_password: false,
        };
        await db.query(
          `INSERT INTO capture_context(id,attendant_id,assignment_id,signed_in_at,offline_expires_at,seller_name,seller_username,device_binding_digest)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            contextId,
            row.attendant_id,
            row.assignment_id,
            now,
            new Date(now.getTime() + AUTH_POLICY.offlineMs),
            row.display_name,
            row.username,
            hmac(config.secret, "device-v1", input.deviceId),
          ],
        );
        await db.query(
          `INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,assignment_id,capture_context_id,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$6)`,
          [
            sessionId,
            userId,
            digest(sessionSecret(config.secret, sessionId)),
            selected.expires_at,
            row.auth_version,
            now,
            row.assignment_id,
            contextId,
          ],
        );
        await db.query(
          "INSERT INTO attendant_sign_in_request VALUES($1,$2,$3,$4,$5,$6)",
          [
            key,
            requestHmac,
            sessionId,
            now,
            new Date(now.getTime() + AUTH_POLICY.replayMs),
            new Date(now.getTime() + AUTH_POLICY.tombstoneMs),
          ],
        );
      }
      return {
        id: selected.id,
        userId,
        token: sessionSecret(config.secret, selected.id),
        createdAt: selected.created_at,
        updatedAt: selected.created_at,
        expiresAt: selected.expires_at,
        ipAddress: "",
        userAgent: "",
      };
    });
    try {
      await auth.api.signInUsername({
        body: { username: normalized, password: input.password },
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      if (
        error instanceof APIError &&
        [400, 401, 403, 422].includes(error.statusCode)
      )
        throw new AuthError("invalid_credentials", 401);
      throw error;
    }
    if (!selected) throw new Error("Authentication did not create a session");
    return {
      session:
        selected.must_change_password || selected.access_scope !== "full"
          ? await restrictedSessionView(db, selected)
          : await sessionView(db, selected),
      token: sessionSecret(config.secret, selected.id),
    };
  });
}
export function getSession(
  pool: pg.Pool,
  config: Config,
  token: string | undefined,
  ip: string,
  restricted?: false,
): Promise<AttendantSession>;
export function getSession(
  pool: pg.Pool,
  config: Config,
  token: string | undefined,
  ip: string,
  restricted: true,
): Promise<AttendantSession | RestrictedAttendantSession>;
export async function getSession(
  pool: pg.Pool,
  config: Config,
  token: string | undefined,
  ip: string,
  restricted = false,
) {
  await consumeLimits(pool, config.secret, [
    { key: `get:ip:${ip}`, capacity: 120 },
  ]);
  if (!token) throw new AuthError("unauthenticated", 401);
  // Release the lookup connection before taking the limiter connection: even a
  // one-connection pool must make progress. Recheck live authority in the final
  // read transaction so disable/revoke during throttling cannot leak a response.
  const identity = await transaction(pool, (db) =>
    requireSession(db, digest(token), restricted),
  );
  await consumeLimits(pool, config.secret, [
    { key: `get:account:${identity.user_id}`, capacity: 60 },
  ]);
  return transaction(pool, async (db) => {
    const live = await requireSession(db, digest(token), restricted);
    return live.must_change_password || live.access_scope !== "full"
      ? restrictedSessionView(db, live)
      : sessionView(db, live);
  });
}
export async function signOut(
  pool: pg.Pool,
  config: Config,
  token: string | undefined,
  ip: string,
) {
  await consumeLimits(pool, config.secret, [
    { key: `out:ip:${ip}`, capacity: 30 },
    ...(token ? [{ key: `out:session:${digest(token)}`, capacity: 10 }] : []),
  ]);
  await pool.query(
    "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE secret_verifier=$1 AND revoked_at IS NULL",
    [digest(token ?? "")],
  );
}

import type pg from "pg";
import { APIError } from "better-auth/api";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { attendantAuth } from "../../auth";
import { newId } from "../../lib/ids";
import { requireAdminSession, securityLock } from "../../lib/authz";
import { digest, hmac, sessionSecret } from "../auth/crypto";
import { AuthError } from "../auth/errors";
import { consumeLimits } from "../auth/rate-limit";
import { ADMIN_POLICY, requirePolicy, type AdminConfig } from "./config";
import { transaction, sessionView, audit, revoke, receipt } from "./repo";
export async function issueSession(
  db: pg.PoolClient,
  config: AdminConfig,
  userId: string,
) {
  const u = (
    await db.query(
      "SELECT auth_version,must_change_password FROM auth_user WHERE id=$1",
      [userId],
    )
  ).rows[0];
  const id = newId();
  const ms = u.must_change_password
    ? ADMIN_POLICY.restrictedMs
    : ADMIN_POLICY.sessionMs;
  await db.query(
    `INSERT INTO auth_session(id,user_id,secret_verifier,expires_at,auth_version,last_online_sign_in_at,access_scope) VALUES($1,$2,$3,clock_timestamp()+($4::bigint*interval '1 millisecond'),$5,clock_timestamp(),$6)`,
    [
      id,
      userId,
      digest(sessionSecret(config.secret, id)),
      ms,
      u.auth_version,
      u.must_change_password ? "first_password" : "full",
    ],
  );
  const token = sessionSecret(config.secret, id);
  const live = await requireAdminSession(db, token, true);
  return { session: await sessionView(db, live), token, live };
}
export async function signIn(
  pool: pg.Pool,
  config: AdminConfig,
  input: { username: string; password: string },
  key: string,
  ip: string,
) {
  requirePolicy(config);
  const username = input.username.trim().toLowerCase();
  await consumeLimits(pool, config.secret, [
    { key: `admin-login-ip:${ip}`, capacity: 30 },
    { key: `admin-login:${username}:${ip}`, capacity: 5 },
  ]);
  return transaction(pool, async (db) => {
    await securityLock(db);
    const scope = hmac(config.secret, "admin-sign-in-scope", "surface");
    const hash = hmac(
      config.secret,
      "admin-sign-in-input",
      JSON.stringify([username, input.password]),
    );
    const old = (
      await db.query(
        "SELECT *,expires_at>clock_timestamp() AS replay_live FROM auth_request_dedup WHERE scope_digest=$1 AND operation_kind='admin_sign_in' AND request_key=$2",
        [scope, key],
      )
    ).rows[0];
    let selected: Awaited<ReturnType<typeof issueSession>> | undefined;
    const auth = attendantAuth(
      db,
      config,
      async (userId) => {
        const a = (
          await db.query(
            "SELECT a.id FROM admin a JOIN role r ON r.id=a.role_id WHERE a.user_id=$1 AND r.enabled",
            [userId],
          )
        ).rows[0];
        if (!a) throw new AuthError("invalid_credentials", 401);
        if (old) {
          if (old.request_hmac !== hash)
            throw new AuthError("operation_conflict", 409);
          if (!old.replay_live)
            throw new AuthError("sign_in_retry_expired", 409);
          const token = sessionSecret(config.secret, old.session_id);
          const live = await requireAdminSession(db, token, true);
          selected = { token, live, session: await sessionView(db, live) };
        } else {
          selected = await issueSession(db, config, userId);
          await db.query(
            "UPDATE auth_user SET last_sign_in_at=clock_timestamp() WHERE id=$1",
            [userId],
          );
          await db.query(
            "INSERT INTO auth_request_dedup VALUES($1,'admin_sign_in',$2,$3,'v1',$4,clock_timestamp()+interval '5 minutes',clock_timestamp()+interval '24 hours')",
            [scope, key, hash, selected.live.id],
          );
        }
        return {
          id: selected.live.id,
          userId,
          token: selected.token,
          createdAt: selected.live.created_at,
          updatedAt: selected.live.created_at,
          expiresAt: selected.live.expires_at,
          ipAddress: "",
          userAgent: "",
        };
      },
      "admin",
    );
    try {
      await auth.api.signInUsername({
        body: { username, password: input.password },
      });
    } catch (e) {
      if (e instanceof AuthError) throw e;
      if (e instanceof APIError && [400, 401, 403, 422].includes(e.statusCode))
        throw new AuthError("invalid_credentials", 401);
      throw e;
    }
    if (!selected) throw new AuthError("invalid_credentials", 401);
    return { session: selected.session, token: selected.token };
  });
}
export async function getSession(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  ip: string,
) {
  requirePolicy(config);
  await consumeLimits(pool, config.secret, [
    { key: `admin-read-ip:${ip}`, capacity: 180 },
  ]);
  const id = await transaction(pool, async (db) => {
    await securityLock(db);
    return (await requireAdminSession(db, token, true)).user_id;
  });
  await consumeLimits(pool, config.secret, [
    { key: `admin-read-account:${id}`, capacity: 60 },
  ]);
  return transaction(pool, async (db) => {
    await securityLock(db);
    const s = await requireAdminSession(db, token, true);
    return sessionView(db, s);
  });
}
export async function signOut(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  ip: string,
) {
  await consumeLimits(pool, config.secret, [
    { key: `admin-out-ip:${ip}`, capacity: 30 },
    ...(token
      ? [{ key: `admin-out-session:${digest(token)}`, capacity: 10 }]
      : []),
  ]);
  return transaction(pool, async (db) => {
    await securityLock(db);
    await db.query(
      "UPDATE auth_session s SET revoked_at=clock_timestamp() FROM auth_user u WHERE s.user_id=u.id AND u.kind='admin' AND s.secret_verifier=$1 AND s.revoked_at IS NULL",
      [digest(token ?? "")],
    );
  });
}
export async function validatePassword(
  db: pg.PoolClient,
  userId: string,
  password: string,
  confirm: string,
) {
  if (password.length < 12 || password.length > 1024)
    throw new AuthError("password_policy", 422);
  if (password !== confirm) throw new AuthError("password_mismatch", 422);
  const c = (
    await db.query(
      "SELECT password_hash FROM auth_credential WHERE user_id=$1 AND provider='credential'",
      [userId],
    )
  ).rows[0];
  if (c && (await verifyPassword({ hash: c.password_hash, password })))
    throw new AuthError("password_unchanged", 422);
  return hashPassword(password);
}
export async function firstPassword(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  input: { operationId: string; newPassword: string; confirmPassword: string },
) {
  requirePolicy(config);
  return transaction(pool, async (db) => {
    await securityLock(db);
    const s = await requireAdminSession(db, token, true);
    if (s.access_scope !== "first_password" || !s.must_change_password)
      throw new AuthError("first_password_completed", 409);
    const hash = await validatePassword(
      db,
      s.user_id,
      input.newPassword,
      input.confirmPassword,
    );
    await receipt(db, config, s, "first-password", input, async () => {
      await db.query(
        "UPDATE auth_credential SET password_hash=$2,updated_at=clock_timestamp() WHERE user_id=$1 AND provider='credential'",
        [s.user_id, hash],
      );
      await db.query(
        "UPDATE auth_user SET must_change_password=false,updated_at=clock_timestamp() WHERE id=$1",
        [s.user_id],
      );
      await revoke(db, s.user_id);
      await audit(
        db,
        s.user_id,
        "admin",
        s.admin_id,
        "password_changed",
        "First password changed",
        null,
        null,
        input.operationId,
      );
      return { changed: true };
    });
    const issued = await issueSession(db, config, s.user_id);
    return { session: issued.session, token: issued.token };
  });
}

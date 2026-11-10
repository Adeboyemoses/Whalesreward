import { auditText } from "./privacy";
import type pg from "pg";
import { AuthError } from "../auth/errors";
import { digest, hmac } from "../auth/crypto";
import { newId } from "../../lib/ids";
import { ADMIN_POLICY, type AdminConfig } from "./config";
import {
  accessValuesSchema,
  adminUserSchema,
  roleSummarySchema,
  permissionCodes,
  dependencies,
  type PermissionCode,
} from "../../../shared/contracts/admin";
export async function transaction<T>(
  pool: pg.Pool,
  run: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  let discard = false;
  const onError = () => {
    discard = true;
  };
  db.on("error", onError);
  try {
    await db.query("BEGIN");
    const r = await run(db);
    await db.query("COMMIT");
    return r;
  } catch (e) {
    // Client query timeouts do not cancel PostgreSQL work. Never return that
    // connection to the pool (nor queue ROLLBACK behind the still-running query).
    if (e instanceof Error && e.message === "Query read timeout")
      discard = true;
    else {
      try {
        await db.query("ROLLBACK");
      } catch {
        discard = true;
      }
    }
    throw e;
  } finally {
    db.removeListener("error", onError);
    db.release(discard);
  }
}
export { securityLock } from "../../lib/security-lock";
export type LiveAdmin = {
  id: string;
  user_id: string;
  admin_id: string;
  role_id: string;
  is_owner: boolean;
  access_scope: "full" | "first_password";
  must_change_password: boolean;
  expires_at: Date;
  created_at: Date;
  permissions: PermissionCode[];
  auth_version: number;
};
export async function liveAdmin(
  db: pg.PoolClient,
  token: string | undefined,
  restricted = false,
): Promise<LiveAdmin> {
  if (!token) throw new AuthError("unauthenticated", 401);
  const r = (
    await db.query<LiveAdmin>(
      `SELECT s.id,s.user_id,a.id AS admin_id,a.role_id,r.is_owner,s.access_scope,u.must_change_password,s.expires_at,s.created_at,u.auth_version,
 ARRAY(SELECT permission_code FROM role_permission WHERE role_id=r.id AND permission_code=ANY($2::text[])) AS permissions
 FROM auth_session s JOIN auth_user u ON u.id=s.user_id JOIN admin a ON a.user_id=u.id JOIN role r ON r.id=a.role_id
 WHERE s.secret_verifier=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.last_activity_at>clock_timestamp()-($3::bigint*interval '1 millisecond') AND u.enabled AND u.kind='admin' AND r.enabled AND s.auth_version=u.auth_version FOR SHARE OF s,u,a,r`,
      [digest(token), permissionCodes, ADMIN_POLICY.idleMs],
    )
  ).rows[0];
  if (!r) throw new AuthError("unauthenticated", 401);
  if (!restricted && (r.access_scope !== "full" || r.must_change_password))
    throw new AuthError("password_change_required", 403);
  // Legacy/incomplete grants do not become usable without their canonical view.
  r.permissions = r.permissions.filter(
    (p) => !dependencies[p] || r.permissions.includes(dependencies[p]!),
  );
  return r;
}
export function permission(actor: LiveAdmin, ...codes: PermissionCode[]) {
  if (
    !codes.some(
      (p) =>
        actor.permissions.includes(p) &&
        (!dependencies[p] || actor.permissions.includes(dependencies[p]!)),
    )
  )
    throw new AuthError("permission_denied", 403);
}
export async function roleView(db: pg.PoolClient, id: string) {
  const r = (
    await db.query(
      `SELECT r.*,ARRAY(SELECT permission_code FROM role_permission WHERE role_id=r.id AND permission_code=ANY($2::text[]) ORDER BY permission_code) AS permissions,(SELECT count(*)::text FROM admin WHERE role_id=r.id) AS user_count FROM role r WHERE id=$1 AND enabled`,
      [id, permissionCodes],
    )
  ).rows[0];
  if (!r) throw new AuthError("not_found", 404);
  return roleSummarySchema.parse({
    id: r.id,
    name: r.name,
    version: r.version,
    isOwner: r.is_owner,
    permissions: r.permissions,
    userCount: r.user_count,
  });
}
export async function userView(db: pg.PoolClient, id: string) {
  const r = (
    await db.query(
      `SELECT a.*,u.display_name,u.username,u.enabled,u.must_change_password,u.last_sign_in_at,c.id AS creator_id,c.admin_code AS creator_code,cu.display_name AS creator_name FROM admin a JOIN auth_user u ON u.id=a.user_id LEFT JOIN admin c ON c.user_id=u.created_by_user_id LEFT JOIN auth_user cu ON cu.id=c.user_id WHERE a.id=$1`,
      [id],
    )
  ).rows[0];
  if (!r) throw new AuthError("not_found", 404);
  return adminUserSchema.parse({
    id: r.id,
    accountId: r.user_id,
    adminCode: r.admin_code,
    name: r.display_name,
    username: r.username,
    email: r.email_normalized,
    emailVerified: !!r.email_verified_at,
    emailVerifiedAt: r.email_verified_at?.toISOString() ?? null,
    enabled: r.enabled,
    mustChangePassword: r.must_change_password,
    role: await roleView(db, r.role_id),
    version: r.version,
    createdAt: r.created_at.toISOString(),
    createdBy: r.creator_id
      ? { id: r.creator_id, code: r.creator_code, name: r.creator_name }
      : null,
    lastSignInAt: r.last_sign_in_at?.toISOString() ?? null,
  });
}
export async function sessionView(db: pg.PoolClient, s: LiveAdmin) {
  const u = await userView(db, s.admin_id);
  if (s.access_scope === "first_password" || s.must_change_password)
    return {
      state: "password_change_required" as const,
      account: {
        id: s.user_id,
        adminCode: u.adminCode,
        name: u.name,
        username: u.username,
        roleName: u.role.name,
      },
      expiresAt: s.expires_at.toISOString(),
    };
  const st = (
    await db.query(
      "SELECT id,name,timezone FROM station ORDER BY created_at,id LIMIT 1",
    )
  ).rows[0];
  if (!st) throw new AuthError("temporarily_unavailable", 503);
  return {
    state: "ready" as const,
    account: {
      id: s.user_id,
      adminId: s.admin_id,
      adminCode: u.adminCode,
      name: u.name,
      username: u.username,
    },
    role: u.role,
    permissions: s.permissions,
    station: st,
    signedInAt: s.created_at.toISOString(),
    expiresAt: s.expires_at.toISOString(),
    landing: s.permissions.includes("overview")
      ? "overview"
      : s.permissions.length
        ? "first_permitted"
        : "no_access",
  };
}
export async function audit(
  db: pg.PoolClient,
  actor: string | null,
  type: "admin" | "role",
  target: string,
  action: string,
  reason: string,
  before: unknown,
  after: unknown,
) {
  const clean = (value: unknown) => {
    if (value === null) return null;
    const parsed = accessValuesSchema.parse(value);
    if (parsed.roleName) parsed.roleName = auditText(parsed.roleName);
    return parsed;
  };
  const a = clean(before),
    b = clean(after);
  reason = auditText(reason);
  await db.query(
    `INSERT INTO audit_event(id,actor_user_id,actor_kind,action,target_type,target_id,"before","after",reason,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,clock_timestamp())`,
    [
      newId(),
      actor,
      actor ? "user" : "system",
      action,
      type,
      target,
      JSON.stringify(a),
      JSON.stringify(b),
      reason,
    ],
  );
  await db.query(
    "INSERT INTO admin_access_event(id,actor_user_id,target_type,target_id,action,reason,before_values,after_values) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [newId(), actor, type, target, action, reason, a, b],
  );
}
export async function revoke(db: pg.PoolClient, userId: string) {
  await db.query(
    "UPDATE auth_user SET auth_version=auth_version+1,updated_at=clock_timestamp() WHERE id=$1",
    [userId],
  );
  await db.query(
    "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE user_id=$1 AND revoked_at IS NULL",
    [userId],
  );
}
export async function receipt<T>(
  db: pg.PoolClient,
  config: AdminConfig,
  actor: Pick<LiveAdmin, "user_id">,
  kind: string,
  input: { operationId: string; [key: string]: unknown },
  run: () => Promise<T>,
): Promise<T> {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, v]) => [
                key,
                key === "permissions" && Array.isArray(v)
                  ? [...v].sort()
                  : canonical(v),
              ]),
          )
        : value;
  const payload = JSON.stringify(canonical(input));
  const version = config.receiptKeyVersion ?? "v1";
  const keys = config.receiptKeys ?? { v1: config.secret };
  const hashFor = (v: string) => {
    const key = keys[v];
    if (!key) throw new AuthError("temporarily_unavailable", 503);
    return hmac(key, "admin-receipt-v1", payload);
  };
  const old = (
    await db.query(
      "SELECT request_digest,digest_key_version,result_snapshot FROM mutation_receipt WHERE actor_user_id=$1 AND operation_kind=$2 AND operation_id=$3",
      [actor.user_id, kind, input.operationId],
    )
  ).rows[0];
  if (old) {
    if (old.request_digest !== hashFor(old.digest_key_version))
      throw new AuthError("operation_conflict", 409);
    return old.result_snapshot as T;
  }
  const result = await run();
  await db.query(
    "INSERT INTO mutation_receipt(actor_user_id,operation_kind,operation_id,request_digest,digest_key_version,result_snapshot) VALUES($1,$2,$3,$4,$5,$6)",
    [actor.user_id, kind, input.operationId, hashFor(version), version, result],
  );
  return result;
}

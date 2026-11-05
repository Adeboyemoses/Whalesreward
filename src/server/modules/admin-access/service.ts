import type pg from "pg";
import { newId } from "../../lib/ids";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { hmac } from "../auth/crypto";
import { AuthError } from "../auth/errors";
import { hashPassword } from "better-auth/crypto";
import {
  dependencies,
  permissionCodes,
  permissionLabels,
  sensitiveDefaults,
  roleInputSchema,
  roleEditSchema,
  createUserSchema,
  accessSchema,
  verifyRequestSchema,
  type PermissionCode,
  type RoleSummary,
} from "../../../shared/contracts/admin";
import { ADMIN_POLICY, requirePolicy, type AdminConfig } from "./config";
import {
  transaction,
  roleView,
  userView,
  audit,
  revoke,
  receipt,
  type LiveAdmin,
} from "./repo";
import { enqueue, deliveryConfigured, invalidateMail } from "./mail";
export { signIn, getSession, signOut, firstPassword } from "./sessions";
export function validPermissions(codes: PermissionCode[]) {
  for (const code of codes) {
    const parent = dependencies[code];
    if (parent && !codes.includes(parent))
      throw new AuthError("permission_dependency", 422);
  }
}
function delegable(
  actor: LiveAdmin,
  role: Pick<RoleSummary, "isOwner" | "permissions">,
) {
  return (
    (!role.isOwner || actor.is_owner) &&
    role.permissions.every(
      (p) =>
        actor.permissions.includes(p) && ADMIN_POLICY.delegable.includes(p),
    )
  );
}
function delegation(
  config: AdminConfig,
  actor: LiveAdmin,
  ...roles: Pick<RoleSummary, "isOwner" | "permissions">[]
) {
  requirePolicy(config, true);
  if (roles.some((r) => !delegable(actor, r)))
    throw new AuthError("delegation_denied", 403);
}
const checkVersion = (got: number, expected: number) => {
  if (got !== expected) throw new AuthError("version_conflict", 409);
};
function values(user: Awaited<ReturnType<typeof userView>>) {
  return {
    roleId: user.role.id,
    roleName: user.role.name,
    enabled: user.enabled,
    emailVerified: user.emailVerified,
  };
}
const readPermission = (action: string) =>
  action.startsWith("roles-") ? "roles" : "users";
export async function adminWrite(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  action: string,
  input: unknown,
  targetId?: string,
) {
  requirePolicy(config);
  try {
    return await transaction(pool, async (db) => {
      await securityLock(db);
      const actor = await requireAdminSession(db, token);
      requirePermission(actor, action.startsWith("roles-") ? "roles" : "users");
      await db.query(
        "UPDATE auth_session SET last_activity_at=clock_timestamp() WHERE id=$1",
        [actor.id],
      );
      if (action === "roles-create" || action === "roles-edit") {
        const parsed =
          action === "roles-edit"
            ? roleEditSchema.parse(input)
            : roleInputSchema.parse(input);
        validPermissions(parsed.permissions);
        const old =
          action === "roles-edit" ? await roleView(db, targetId!) : null;
        if (old?.isOwner) throw new AuthError("protected_owner", 409);
        delegation(config, actor, ...(old ? [old] : []), {
          isOwner: false,
          permissions: parsed.permissions,
        });
        return receipt(
          db,
          config,
          actor,
          action,
          { ...parsed, ...(targetId ? { targetId } : {}) },
          async () => {
            if (old) {
              checkVersion(
                old.version,
                "expectedVersion" in parsed
                  ? Number(parsed.expectedVersion)
                  : 0,
              );
              if (
                old.name === parsed.name &&
                JSON.stringify([...old.permissions].sort()) ===
                  JSON.stringify([...parsed.permissions].sort())
              )
                throw new AuthError("no_change", 409);
            }
            const id = old?.id ?? newId();
            if (old)
              await db.query(
                "UPDATE role SET name=$2,version=version+1 WHERE id=$1 AND version=$3",
                [id, parsed.name, old.version],
              );
            else
              await db.query(
                "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,false,true,1)",
                [id, parsed.name],
              );
            await db.query("DELETE FROM role_permission WHERE role_id=$1", [
              id,
            ]);
            for (const p of parsed.permissions)
              await db.query(
                "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
                [id, p],
              );
            if (old) {
              const members = (
                await db.query(
                  "SELECT user_id FROM admin WHERE role_id=$1 ORDER BY user_id",
                  [id],
                )
              ).rows;
              for (const member of members) await revoke(db, member.user_id);
            }
            const result = await roleView(db, id);
            await audit(
              db,
              actor.user_id,
              "role",
              id,
              old ? "role_changed" : "role_created",
              parsed.reason,
              old ? { roleName: old.name, permissions: old.permissions } : null,
              { roleName: result.name, permissions: result.permissions },
            );
            return result;
          },
        );
      }
      if (action === "users-create") {
        const p = createUserSchema.parse(input);
        const role = await roleView(db, p.roleId);
        delegation(config, actor, role);
        return receipt(db, config, actor, action, p, async () => {
          checkVersion(role.version, p.expectedRoleVersion);
          if (p.temporaryPassword.length < 12)
            throw new AuthError("password_policy", 422);
          const uid = newId(),
            aid = newId();
          const hash = await hashPassword(p.temporaryPassword);
          await db.query(
            "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at,created_by_user_id) VALUES($1,'admin',$2,$2,$3,true,1,true,clock_timestamp(),$4)",
            [uid, p.username, p.name, actor.user_id],
          );
          await db.query(
            "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2::uuid,'credential',$2::text,$3,clock_timestamp())",
            [newId(), uid, hash],
          );
          await db.query(
            "INSERT INTO admin(id,user_id,admin_code,email_normalized,role_id,version) VALUES($1,$2,$3,$4,$5,1)",
            [aid, uid, `ADMIN-${aid}`, p.email, role.id],
          );
          const delivery = deliveryConfigured(config);
          if (delivery)
            await enqueue(db, config, aid, "verify_email", p.operationId);
          const user = await userView(db, aid);
          await audit(
            db,
            actor.user_id,
            "admin",
            aid,
            "user_created",
            p.reason,
            null,
            values(user),
          );
          return {
            user,
            verificationDelivery: delivery ? "queued" : "unconfigured",
          };
        });
      }
      if (action === "users-access") {
        const p = accessSchema.parse(input);
        const old = await userView(db, targetId!);
        const role = await roleView(db, p.roleId);
        delegation(config, actor, old.role, role);
        return receipt(
          db,
          config,
          actor,
          action,
          { ...p, targetId },
          async () => {
            checkVersion(old.version, p.expectedVersion);
            checkVersion(role.version, p.expectedRoleVersion);
            if (old.role.id === p.roleId && old.enabled === p.enabled)
              throw new AuthError("no_change", 409);
            if (
              old.role.isOwner &&
              old.enabled &&
              (!role.isOwner || !p.enabled)
            ) {
              const count = (
                await db.query(
                  "SELECT count(*)::integer AS n FROM admin a JOIN auth_user u ON u.id=a.user_id JOIN role r ON r.id=a.role_id WHERE r.is_owner AND r.enabled AND u.enabled",
                )
              ).rows[0].n;
              if (count <= 1) throw new AuthError("last_owner", 409);
            }
            await db.query(
              "UPDATE admin SET role_id=$2,version=version+1,verification_generation=verification_generation+CASE WHEN $4 THEN 0 ELSE 1 END,reset_generation=reset_generation+CASE WHEN $4 THEN 0 ELSE 1 END WHERE id=$1 AND version=$3",
              [old.id, p.roleId, p.expectedVersion, p.enabled],
            );
            await db.query(
              "UPDATE auth_user SET enabled=$2,updated_at=clock_timestamp() WHERE id=$1",
              [old.accountId, p.enabled],
            );
            await revoke(db, old.accountId);
            if (!p.enabled) await invalidateMail(db, old.accountId, false);
            const user = await userView(db, old.id);
            await audit(
              db,
              actor.user_id,
              "admin",
              old.id,
              "user_access_changed",
              p.reason,
              values(old),
              values(user),
            );
            return user;
          },
        );
      }
      if (action === "verification-requests") {
        const p = verifyRequestSchema.parse(input);
        const user = await userView(db, targetId!);
        delegation(config, actor, user.role);
        if (!deliveryConfigured(config))
          throw new AuthError("delivery_unconfigured", 503);
        return receipt(
          db,
          config,
          actor,
          action,
          { ...p, targetId },
          async () => {
            checkVersion(user.version, p.expectedVersion);
            await enqueue(db, config, user.id, "verify_email", p.operationId);
            await audit(
              db,
              actor.user_id,
              "admin",
              user.id,
              "verification_requested",
              "Verification requested",
              null,
              { emailVerified: false },
            );
            return { delivery: "queued", emailVerified: false };
          },
        );
      }
      throw new AuthError("not_found", 404);
    });
  } catch (e) {
    const error = e as { code?: string; constraint?: string };
    if (error.code === "23505") {
      const c = error.constraint ?? "";
      throw new AuthError(
        c.includes("username")
          ? "username_in_use"
          : c.includes("email")
            ? "email_in_use"
            : "role_name_in_use",
        409,
      );
    }
    throw e;
  }
}
function cursorOffset(
  config: AdminConfig,
  actor: LiveAdmin,
  action: string,
  input: Record<string, unknown>,
) {
  const { cursor, ...filters } = input;
  const binding = JSON.stringify([actor.user_id, action, filters]);
  if (!cursor) return { offset: 0, binding };
  const parts = String(cursor).split(".");
  if (
    parts.length !== 2 ||
    !/^\d{1,7}$/.test(parts[0]!) ||
    parts[1] !== hmac(config.secret, "admin-cursor", binding + ":" + parts[0])
  )
    throw new AuthError("invalid_request", 400);
  return { offset: Number(parts[0]), binding };
}
export async function adminRead(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  action: string,
  input: Record<string, unknown> = {},
  targetId?: string,
) {
  requirePolicy(config);
  return transaction(pool, async (db) => {
    await securityLock(db);
    const actor = await requireAdminSession(db, token);
    if (action === "permissions") requirePermission(actor, "users", "roles");
    else if (action === "access-history") {
      if (input.targetType === "admin") requirePermission(actor, "users");
      else if (input.targetType === "role") requirePermission(actor, "roles");
      else requirePermission(actor, "users", "roles");
    } else requirePermission(actor, readPermission(action));
    await db.query(
      "UPDATE auth_session SET last_activity_at=clock_timestamp() WHERE id=$1",
      [actor.id],
    );
    if (action === "permissions")
      return {
        items: permissionCodes.map((code) => ({
          code,
          label: permissionLabels[code],
          requiredView: dependencies[code] ?? null,
          sensitiveOwnerDefault: sensitiveDefaults.includes(code),
        })),
      };
    if (action === "users-get") return userView(db, targetId!);
    if (action === "roles-get") return roleView(db, targetId!);
    const { offset, binding } = cursorOffset(config, actor, action, input),
      limit = Number(input.limit ?? 25);
    let items: unknown[] = [];
    if (action === "roles-list" || action === "assignable-roles") {
      if (action === "assignable-roles") requirePolicy(config, true);
      const ids = (
        await db.query(
          `SELECT r.id FROM role r WHERE r.enabled AND ($1::boolean=false OR (NOT r.is_owner OR $2) AND NOT EXISTS(SELECT 1 FROM role_permission rp WHERE rp.role_id=r.id AND rp.permission_code=ANY($3::text[]) AND NOT(rp.permission_code=ANY($4::text[])))) ORDER BY r.created_at DESC,r.id DESC LIMIT $5 OFFSET $6`,
          [
            action === "assignable-roles",
            actor.is_owner,
            permissionCodes,
            actor.permissions.filter((p) => ADMIN_POLICY.delegable.includes(p)),
            limit + 1,
            offset,
          ],
        )
      ).rows;
      items = await Promise.all(ids.map((r) => roleView(db, r.id)));
    } else if (action === "users-search") {
      const ids = (
        await db.query(
          `SELECT a.id FROM admin a JOIN auth_user u ON u.id=a.user_id WHERE ($1::text IS NULL OR strpos(lower(u.display_name),lower($1))>0 OR strpos(u.username_normalized,lower($1))>0) AND ($2::boolean IS NULL OR u.enabled=$2) AND ($3::uuid IS NULL OR a.role_id=$3) ORDER BY a.created_at DESC,a.id DESC LIMIT $4 OFFSET $5`,
          [
            input.query ?? null,
            input.enabled ?? null,
            input.roleId ?? null,
            limit + 1,
            offset,
          ],
        )
      ).rows;
      items = await Promise.all(ids.map((r) => userView(db, r.id)));
    } else if (action === "access-history") {
      const types = ["admin", "role"].filter((t) =>
        actor.permissions.includes(t === "admin" ? "users" : "roles"),
      );
      const events = (
        await db.query(
          `SELECT e.*,a.id AS actor_id,a.admin_code,u.display_name FROM admin_access_event e LEFT JOIN admin a ON a.user_id=e.actor_user_id LEFT JOIN auth_user u ON u.id=e.actor_user_id WHERE e.target_type=ANY($1::text[]) AND ($2::text IS NULL OR e.target_type=$2) AND ($3::uuid IS NULL OR e.target_id=$3) ORDER BY e.created_at DESC,e.id DESC LIMIT $4 OFFSET $5`,
          [
            types,
            input.targetType ?? null,
            input.targetId ?? null,
            limit + 1,
            offset,
          ],
        )
      ).rows;
      items = events.map((e) => ({
        id: e.id,
        targetType: e.target_type,
        targetId: e.target_id,
        action: e.action,
        actor: e.actor_id
          ? { id: e.actor_id, code: e.admin_code, name: e.display_name }
          : null,
        occurredAt: e.created_at.toISOString(),
        reason: e.reason,
        before: e.before_values,
        after: e.after_values,
      }));
    } else throw new AuthError("not_found", 404);
    const next = offset + limit;
    return {
      items: items.slice(0, limit),
      nextCursor:
        items.length > limit
          ? `${next}.${hmac(config.secret, "admin-cursor", binding + ":" + next)}`
          : null,
    };
  });
}

import type pg from "pg";
import type { AdminConfig } from "../admin-access/config";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { firstAttendantPasswordSchema } from "../../../shared/contracts/station";
import { requireSession, securityLock } from "../../lib/authz";
import { transaction, receipt, revoke } from "../admin-access/repo";
import { audit } from "../station/repo";
import { digest } from "./crypto";
import { AuthError } from "./errors";
import { consumeLimits } from "./rate-limit";
export async function firstPassword(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  input: unknown,
  ip: string,
) {
  const parsed = firstAttendantPasswordSchema.parse(input);
  await consumeLimits(pool, config.secret, [
    { key: `attendant-first-password-ip:${ip}`, capacity: 30 },
    {
      key: `attendant-first-password-session:${digest(token ?? "")}`,
      capacity: 5,
    },
  ]);
  return transaction(pool, async (db) => {
    await securityLock(db);
    const session = await requireSession(db, digest(token ?? ""), true);
    return receipt(
      db,
      config,
      { user_id: session.user_id },
      "attendant-first-password",
      parsed,
      async () => {
        if (
          !session.must_change_password ||
          session.access_scope !== "first_password"
        )
          throw new AuthError("password_change_required", 403);
        if (
          parsed.newPassword.length < 12 ||
          parsed.newPassword !== parsed.confirmPassword ||
          parsed.newPassword === parsed.currentPassword
        )
          throw new AuthError("password_policy", 422);
        const credential = (
          await db.query(
            "SELECT id,password_hash FROM auth_credential WHERE user_id=$1 AND provider='credential' AND provider_account_id=$1::text FOR UPDATE",
            [session.user_id],
          )
        ).rows[0];
        if (
          !credential?.password_hash ||
          !(await verifyPassword({
            hash: credential.password_hash,
            password: parsed.currentPassword,
          }))
        )
          throw new AuthError("invalid_credentials", 401);
        const hash = await hashPassword(parsed.newPassword);
        await db.query(
          "UPDATE auth_credential SET password_hash=$2,updated_at=clock_timestamp() WHERE id=$1",
          [credential.id, hash],
        );
        await db.query(
          "UPDATE auth_user SET must_change_password=false,updated_at=clock_timestamp() WHERE id=$1",
          [session.user_id],
        );
        await revoke(db, session.user_id);
        const attendant = (
          await db.query("SELECT id FROM attendant WHERE user_id=$1", [
            session.user_id,
          ])
        ).rows[0];
        await audit(
          db,
          session.user_id,
          "attendant",
          attendant.id,
          "password_changed",
          "First password changed",
          null,
          null,
          { operationId: parsed.operationId },
        );
        return { signInRequired: true };
      },
    );
  });
}

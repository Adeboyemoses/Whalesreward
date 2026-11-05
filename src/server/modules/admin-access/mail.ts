import type pg from "pg";
import { randomBytes } from "node:crypto";
import { sendEmail, type EmailMessage } from "../../adapters/email";
import { newId } from "../../lib/ids";
import { securityLock } from "../../lib/authz";
import { digest, hmac } from "../auth/crypto";
import { consumeLimits } from "../auth/rate-limit";
import { AuthError } from "../auth/errors";
import { resetMessage } from "../../../shared/contracts/admin";
import { ADMIN_POLICY, type AdminConfig } from "./config";
import { transaction, audit, revoke } from "./repo";
import { validatePassword } from "./sessions";
type Purpose = "verify_email" | "reset_password";
export const targetDigest = (config: AdminConfig, email: string) =>
  hmac(config.secret, "admin-email-v1", email);
export function deliveryConfigured(config: AdminConfig) {
  return !config.production && config.delivery !== "noop";
}
export async function invalidateMail(db: pg.PoolClient, userId: string) {
  await db.query(
    "UPDATE verification_challenge SET revoked_at=clock_timestamp(),version=version+1 WHERE user_id=$1 AND purpose IN ('verify_email','reset_password') AND consumed_at IS NULL AND revoked_at IS NULL",
    [userId],
  );
  await db.query(
    "UPDATE mail_request SET status='superseded',fencing_version=fencing_version+1 WHERE admin_id=(SELECT id FROM admin WHERE user_id=$1) AND purpose<>'reset_notice' AND status IN ('pending','sending')",
    [userId],
  );
  await db.query(
    "UPDATE admin SET verification_generation=verification_generation+1,reset_generation=reset_generation+1,version=version+1 WHERE user_id=$1",
    [userId],
  );
}
export async function enqueue(
  db: pg.PoolClient,
  config: AdminConfig,
  adminId: string,
  purpose: Purpose,
  operationId: string,
) {
  const a = (
    await db.query(
      "SELECT a.*,u.enabled FROM admin a JOIN auth_user u ON u.id=a.user_id WHERE a.id=$1 FOR UPDATE OF a,u",
      [adminId],
    )
  ).rows[0];
  if (
    !a ||
    !a.enabled ||
    !a.email_normalized ||
    (purpose === "reset_password"
      ? !a.email_verified_at
      : !!a.email_verified_at)
  )
    throw new AuthError("verification_not_available", 409);
  const column =
    purpose === "verify_email" ? "verification_generation" : "reset_generation";
  const generation = (
    await db.query(
      `UPDATE admin SET ${column}=${column}+1,version=version+1 WHERE id=$1 RETURNING ${column}::text AS n`,
      [adminId],
    )
  ).rows[0].n;
  await db.query(
    "UPDATE verification_challenge SET revoked_at=clock_timestamp(),version=version+1 WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL AND revoked_at IS NULL",
    [a.user_id, purpose],
  );
  await db.query(
    "UPDATE mail_request SET status='superseded',fencing_version=fencing_version+1 WHERE admin_id=$1 AND purpose=$2 AND status IN ('pending','sending')",
    [adminId, purpose],
  );
  await db.query(
    "INSERT INTO mail_request(id,admin_id,purpose,generation,operation_id,target_digest,target_key_version,destination_email) VALUES($1,$2,$3,$4,$5,$6,'v1',$7)",
    [
      newId(),
      adminId,
      purpose,
      generation,
      operationId,
      targetDigest(config, a.email_normalized),
      a.email_normalized,
    ],
  );
}
export async function requestReset(
  pool: pg.Pool,
  config: AdminConfig,
  email: string,
  key: string,
  ip: string,
) {
  await consumeLimits(pool, config.secret, [
    { key: `admin-reset-ip:${ip}`, capacity: 20 },
  ]);
  let suppressed = false;
  try {
    await consumeLimits(pool, config.secret, [
      { key: `admin-reset-email:${email}`, capacity: 3 },
    ]);
  } catch (e) {
    if (e instanceof AuthError && e.code === "rate_limited") suppressed = true;
    else throw e;
  }
  await transaction(pool, async (db) => {
    const scope = hmac(config.secret, "reset-scope", ip),
      hash = targetDigest(config, email);
    const inserted = await db.query(
      "INSERT INTO auth_request_dedup VALUES($1,'reset_request',$2,$3,'v1',NULL,clock_timestamp()+interval '24 hours',clock_timestamp()+interval '24 hours') ON CONFLICT DO NOTHING RETURNING request_key",
      [scope, key, hash],
    );
    if (inserted.rowCount && !suppressed && deliveryConfigured(config))
      await db.query(
        "INSERT INTO admin_reset_work(id,target_digest) VALUES($1,$2)",
        [newId(), hash],
      );
  });
  return { message: resetMessage };
}
/** Uniform public request path never looks up an account. Resolve its HMAC in
 * bounded worker pages, keeping raw email out of public dedup/work records. */
async function resolveResetWork(db: pg.PoolClient, config: AdminConfig) {
  const work = (
    await db.query(
      "SELECT * FROM admin_reset_work WHERE NOT completed ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
    )
  ).rows[0];
  if (!work) return;
  const rows = (
    await db.query(
      "SELECT a.*,u.enabled FROM admin a JOIN auth_user u ON u.id=a.user_id WHERE ($1::uuid IS NULL OR a.id>$1) ORDER BY a.id LIMIT 100",
      [work.cursor_id],
    )
  ).rows;
  const found = rows.find(
    (a) =>
      a.email_normalized &&
      targetDigest(config, a.email_normalized) === work.target_digest,
  );
  if (found) {
    if (found.enabled && found.email_verified_at && deliveryConfigured(config))
      await enqueue(db, config, found.id, "reset_password", work.id);
    await db.query("UPDATE admin_reset_work SET completed=true WHERE id=$1", [
      work.id,
    ]);
  } else
    await db.query(
      "UPDATE admin_reset_work SET completed=$2,cursor_id=$3 WHERE id=$1",
      [work.id, rows.length < 100, rows.at(-1)?.id ?? work.cursor_id],
    );
}
export async function processMail(
  pool: pg.Pool,
  config: AdminConfig,
  send: (message: EmailMessage) => Promise<{ delivered: boolean }> = (
    message,
  ) =>
    sendEmail(message, {
      adapter: config.delivery ?? "mailpit",
      mailpitUrl: config.mailpitUrl,
    }),
) {
  const task = await transaction(pool, async (db) => {
    await securityLock(db);
    await resolveResetWork(db, config);
    // An interrupted sender cannot recover or reconstruct its raw token.
    const stale = (
      await db.query(
        "SELECT challenge_id FROM mail_request WHERE status='sending' AND lease_until<=clock_timestamp() FOR UPDATE",
      )
    ).rows;
    for (const r of stale)
      if (r.challenge_id)
        await db.query(
          "UPDATE verification_challenge SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1 AND consumed_at IS NULL AND revoked_at IS NULL",
          [r.challenge_id],
        );
    await db.query(
      "UPDATE mail_request SET status='failed',failure_code='delivery_uncertain',fencing_version=fencing_version+1 WHERE status='sending' AND lease_until<=clock_timestamp()",
    );
    const m = (
      await db.query(
        "SELECT m.*,a.user_id,a.email_normalized,a.email_verified_at,a.verification_generation::text,a.reset_generation::text,u.enabled FROM mail_request m JOIN admin a ON a.id=m.admin_id JOIN auth_user u ON u.id=a.user_id WHERE m.status='pending' ORDER BY m.created_at,m.id LIMIT 1 FOR UPDATE OF m,a,u",
      )
    ).rows[0];
    if (!m) return null;
    const current =
      m.purpose === "verify_email"
        ? m.verification_generation
        : m.reset_generation;
    if (
      !deliveryConfigured(config) ||
      !m.enabled ||
      m.destination_email !== m.email_normalized ||
      m.target_digest !== targetDigest(config, m.email_normalized) ||
      (m.purpose !== "reset_notice" &&
        (String(m.generation) !== current ||
          (m.purpose === "reset_password"
            ? !m.email_verified_at
            : !!m.email_verified_at)))
    ) {
      await db.query(
        "UPDATE mail_request SET status='superseded' WHERE id=$1",
        [m.id],
      );
      return null;
    }
    const nonce = randomBytes(32).toString("hex");
    let token: string | undefined;
    let challenge: string | null = null;
    if (m.purpose !== "reset_notice") {
      token = randomBytes(32).toString("hex");
      challenge = newId();
      const ms =
        m.purpose === "verify_email"
          ? ADMIN_POLICY.verificationMs
          : ADMIN_POLICY.resetMs;
      await db.query(
        `INSERT INTO verification_challenge(id,user_id,purpose,target_digest,secret_hash,expires_at,attempts,max_attempts,operation_id,version,issuance_generation,mail_request_id,target_key_version) VALUES($1,$2,$3,$4,$5,clock_timestamp()+($6::bigint*interval '1 millisecond'),0,$7,$8,1,$9,$10,'v1')`,
        [
          challenge,
          m.user_id,
          m.purpose,
          m.target_digest,
          digest(token),
          ms,
          ADMIN_POLICY.maxAttempts,
          newId(),
          m.generation,
          m.id,
        ],
      );
    }
    await db.query(
      "UPDATE mail_request SET status='sending',challenge_id=$2,lease_nonce=$3,lease_until=clock_timestamp()+interval '2 minutes',fencing_version=fencing_version+1,attempts=attempts+1 WHERE id=$1",
      [m.id, challenge, nonce],
    );
    return {
      id: m.id,
      nonce,
      challenge,
      purpose: m.purpose,
      email: m.destination_email,
      token,
    };
  });
  if (!task) return { processed: false };
  let delivered = false;
  try {
    const path =
      task.purpose === "verify_email" ? "verify-email" : "reset-password";
    delivered = (
      await send({
        to: task.email,
        subject:
          task.purpose === "reset_notice"
            ? "Your password was changed"
            : task.purpose === "verify_email"
              ? "Verify your email"
              : "Reset your password",
        text:
          task.purpose === "reset_notice"
            ? "Your Whales Rewards password was changed. Contact your station owner if you did not make this change."
            : `${config.origin}/admin/${path}#token=${task.token}`,
      })
    ).delivered;
  } catch {
    /* Provider details never enter logs/audit. */
  }
  await transaction(pool, async (db) => {
    await securityLock(db);
    const changed = await db.query(
      "UPDATE mail_request SET status=$3,sent_at=CASE WHEN $3='sent' THEN clock_timestamp() ELSE NULL END,failure_code=CASE WHEN $3='failed' THEN 'delivery_failed' ELSE NULL END WHERE id=$1 AND status='sending' AND lease_nonce=$2 RETURNING id",
      [task.id, task.nonce, delivered ? "sent" : "failed"],
    );
    if (!delivered && changed.rowCount && task.challenge)
      await db.query(
        "UPDATE verification_challenge SET revoked_at=clock_timestamp(),version=version+1 WHERE id=$1 AND consumed_at IS NULL AND revoked_at IS NULL",
        [task.challenge],
      );
  });
  return { processed: true, delivered };
}
async function challenge(
  db: pg.PoolClient,
  config: AdminConfig,
  token: string,
  purpose: Purpose,
) {
  const c = (
    await db.query(
      `SELECT c.*,a.id AS admin_id,a.email_normalized,a.email_verified_at FROM verification_challenge c JOIN auth_user u ON u.id=c.user_id JOIN admin a ON a.user_id=u.id JOIN mail_request m ON m.id=c.mail_request_id WHERE c.secret_hash=$1 AND c.purpose=$2 AND u.enabled AND u.kind='admin' AND c.consumed_at IS NULL AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND c.attempts<c.max_attempts AND c.issuance_generation=CASE WHEN c.purpose='verify_email' THEN a.verification_generation ELSE a.reset_generation END AND m.challenge_id=c.id AND m.status IN ('sending','sent') FOR UPDATE OF c,a,u`,
      [digest(token), purpose],
    )
  ).rows[0];
  if (
    !c ||
    !c.email_normalized ||
    c.target_digest !== targetDigest(config, c.email_normalized) ||
    (purpose === "reset_password"
      ? !c.email_verified_at
      : !!c.email_verified_at)
  )
    throw new AuthError("link_unavailable", 422);
  return c;
}
export async function inspectToken(
  pool: pg.Pool,
  config: AdminConfig,
  token: string,
  purpose: Purpose,
) {
  return transaction(pool, async (db) => {
    await securityLock(db);
    const c = await challenge(db, config, token, purpose);
    return { email: c.email_normalized, expiresAt: c.expires_at.toISOString() };
  });
}
export async function confirmToken(
  pool: pg.Pool,
  config: AdminConfig,
  token: string,
  purpose: Purpose,
  password?: { newPassword: string; confirmPassword: string },
) {
  return transaction(pool, async (db) => {
    await securityLock(db);
    const c = await challenge(db, config, token, purpose);
    if (purpose === "reset_password") {
      if (!password) throw new AuthError("invalid_request", 400);
      const hash = await validatePassword(
        db,
        c.user_id,
        password.newPassword,
        password.confirmPassword,
      );
      await db.query(
        "UPDATE auth_credential SET password_hash=$2,updated_at=clock_timestamp() WHERE user_id=$1 AND provider='credential'",
        [c.user_id, hash],
      );
      await db.query(
        "UPDATE auth_user SET must_change_password=false,updated_at=clock_timestamp() WHERE id=$1",
        [c.user_id],
      );
      await revoke(db, c.user_id);
      await db.query(
        "UPDATE verification_challenge SET revoked_at=clock_timestamp(),version=version+1 WHERE user_id=$1 AND purpose='reset_password' AND id<>$2 AND consumed_at IS NULL AND revoked_at IS NULL",
        [c.user_id, c.id],
      );
      await db.query(
        "INSERT INTO mail_request(id,admin_id,purpose,operation_id,target_digest,target_key_version,destination_email) VALUES($1,$2,'reset_notice',$3,$4,'v1',$5)",
        [newId(), c.admin_id, newId(), c.target_digest, c.email_normalized],
      );
      await audit(
        db,
        null,
        "admin",
        c.admin_id,
        "password_reset",
        "Verified-email password reset",
        null,
        null,
      );
    } else {
      await db.query(
        "UPDATE admin SET email_verified_at=clock_timestamp(),version=version+1 WHERE id=$1",
        [c.admin_id],
      );
      await audit(
        db,
        null,
        "admin",
        c.admin_id,
        "email_verified",
        "Recipient confirmed email ownership",
        { emailVerified: false },
        { emailVerified: true },
      );
    }
    await db.query(
      "UPDATE verification_challenge SET consumed_at=clock_timestamp(),version=version+1 WHERE id=$1",
      [c.id],
    );
    return purpose === "reset_password"
      ? { reset: true, returnTo: "/admin/sign-in" }
      : {
          verified: true,
          email: c.email_normalized,
          returnTo: "/admin/sign-in",
        };
  });
}

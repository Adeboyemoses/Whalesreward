import { z } from "zod";
import { hashPassword } from "better-auth/crypto";
import { v7 } from "uuid";

/** Local fixtures only by default. Staging requires a separately supplied secret;
 * the deploy seed never installs a public/default password or resets credentials. */
/** @param {import("pg").Client} db @param {Record<string, string | undefined>} env */
export async function seedAttendantCredentials(db, env = process.env) {
  if (env.WHR_ENV === "production")
    throw new Error("Fictional credentials are unavailable in production");
  const local = !env.WHR_ENV && env.NODE_ENV !== "production";
  const password =
    env.WHR_SEED_ATTENDANT_PASSWORD ??
    (local ? "Fictional-local-attendant-2026!" : undefined);
  if (!password) return;
  if (
    password.length < 16 ||
    password.length > 1024 ||
    (!local && password === "Fictional-local-attendant-2026!")
  )
    throw new Error(
      "A distinct fixture password of at least 16 characters is required",
    );
  const hash = await hashPassword(password);
  for (const suffix of ["003", "004"]) {
    const userId = `019a5000-0000-7000-8000-000000000${suffix}`;
    await db.query(
      `INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at)
   VALUES($1,$2::uuid,'credential',$2::text,$3,now()) ON CONFLICT(provider,provider_account_id) DO NOTHING`,
      [v7(), userId, hash],
    );
  }
}

/** Insert-only fictional admin credential; staging data changes require Earl. */
/** @param {import("pg").Client} db @param {Record<string, string | undefined>} env */
export async function seedAdminCredentials(db, env = process.env) {
  if (env.WHR_ENV === "production")
    throw new Error("Fictional credentials are unavailable in production");
  const password = env.WHR_SEED_ADMIN_PASSWORD;
  if (!password) return;
  if (password.length < 16 || password.length > 1024)
    throw new Error(
      "An explicit fixture password of at least 16 characters is required",
    );
  await db.query(
    "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2::uuid,'credential',$2::text,$3,clock_timestamp()) ON CONFLICT(provider,provider_account_id) DO NOTHING",
    [
      v7(),
      "019a5000-0000-7000-8000-000000000002",
      await hashPassword(password),
    ],
  );
}

/** Configure only the initial INSERT, never an UPDATE of an existing admin.
 * Call inside the seed transaction; the private setting expires on commit/rollback.
 * @param {import("pg").Client} db
 * @param {Record<string, string | undefined>} env
 */
export async function configureAdminSeedEmail(db, env = process.env) {
  const raw = env.WHR_SEED_ADMIN_EMAIL;
  const email = raw?.trim().toLowerCase();
  if (
    raw !== undefined &&
    (env.WHR_ENV !== "staging" || !z.email().max(254).safeParse(email).success)
  )
    throw new Error("Staging admin email configuration is invalid");
  await db.query("SELECT set_config('whr.seed_admin_email',$1,true)", [
    email ?? "",
  ]);
}

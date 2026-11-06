import pg from "pg";
import { readFile } from "node:fs/promises";
import { v7 } from "uuid";
import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
export async function fixture() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(
    await readFile(
      new URL("../../prisma/fixtures.sql", import.meta.url),
      "utf8",
    ),
  );
  const userId = v7(),
    adminId = v7(),
    username = `browser.${userId.slice(-12)}`,
    password = randomBytes(24).toString("hex");
  const owner = (
    await db.query("SELECT id FROM role WHERE is_owner=true LIMIT 1")
  ).rows[0].id;
  await db.query(
    "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'admin',$2,$2,'Ada Williams',true,1,true,now())",
    [userId, username],
  );
  await db.query(
    "INSERT INTO admin(id,user_id,admin_code,email_normalized,role_id,version) VALUES($1,$2,$3,$4,$5,1)",
    [adminId, userId, `TEST-${adminId}`, `${username}@example.com`, owner],
  );
  await db.query(
    "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2::uuid,'credential',$2::text,$3,now())",
    [v7(), userId, await hashPassword(password)],
  );
  return { db, userId, adminId, username, password, owner };
}
export async function signIn(page: Page, username: string, password: string) {
  await page.goto("/admin/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
export async function mailLink(email: string, subject: string) {
  execFileSync(
    "pnpm",
    [
      "exec",
      "esbuild",
      "jobs/admin-mail.ts",
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--packages=external",
      "--outfile=jobs/.admin-mail.browser.mjs",
    ],
    { stdio: "pipe" },
  );
  execFileSync("node", ["jobs/.admin-mail.browser.mjs"], {
    stdio: "pipe",
    env: process.env,
  });
  const messages = await (
    await fetch(
      `${process.env.MAILPIT_URL ?? "http://127.0.0.1:8025"}/api/v1/messages`,
    )
  ).json();
  const item = messages.messages.find(
    (m: { To: { Address: string }[]; Subject: string }) =>
      m.To.some((t) => t.Address === email) && m.Subject.includes(subject),
  );
  if (!item) throw new Error("Expected fictional local message absent");
  const full = await (
    await fetch(
      `${process.env.MAILPIT_URL ?? "http://127.0.0.1:8025"}/api/v1/message/${item.ID}`,
    )
  ).json();
  const link = full.Text.match(
    /http:\/\/127\.0\.0\.1:3104\/admin\/(?:verify-email|reset-password)#token=[a-zA-Z0-9_-]+/,
  )?.[0];
  if (!link) throw new Error("Expected local link absent");
  return { link, html: full.HTML as string };
}

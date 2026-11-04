import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";
import { v7 } from "uuid";

async function authFixture() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const userId = v7(),
    attendantId = v7(),
    username = `browser.${userId}`,
    password = randomBytes(24).toString("hex");
  try {
    await db.query(
      await readFile(
        new URL("../../prisma/fixtures.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.query(
      "INSERT INTO auth_user(id,kind,username,username_normalized,display_name,enabled,auth_version,must_change_password,updated_at) VALUES($1,'attendant',$2,$2,'Grace Browser',true,1,false,now())",
      [userId, username],
    );
    await db.query(
      "INSERT INTO attendant(id,user_id,staff_code,version) VALUES($1,$2,$3,1)",
      [attendantId, userId, `TEST-${attendantId}`],
    );
    await db.query(
      "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2::uuid,'credential',$2::text,$3,now())",
      [v7(), userId, await hashPassword(password)],
    );
    await db.query(
      "INSERT INTO assignment(id,attendant_id,pump_id,assignment_version,effective_from,changed_by,reason) VALUES($1,$2,'019a5000-0000-7000-8000-000000000014',1,now(),'019a5000-0000-7000-8000-000000000005','Fictional browser auth test')",
      [v7(), attendantId],
    );
    return { db, userId, attendantId, username, password };
  } catch (error) {
    await db.end();
    throw error;
  }
}

// This test uses the real API and database. Never retain credential-entry traces.
test.use({ trace: "off", video: "off", screenshot: "off" });
test("real attendant sign-in, browser cookie, account and server revocation", async ({
  page,
  context,
}) => {
  const { db, userId, username, password } = await authFixture();
  try {
    const signup = await page.request.post("/api/auth/sign-up/email", {
      data: {},
    });
    expect(signup.status()).toBe(404);
    await page.goto("/attendant/sign-in");
    await page.getByLabel("Username", { exact: true }).fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/attendant\/sale$/);
    const attributes = (await context.cookies()).map(
      ({ name, httpOnly, secure, sameSite }) => ({
        name,
        httpOnly,
        secure,
        sameSite,
      }),
    );
    expect(attributes).toContainEqual({
      name: "__Host-whr-session",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
    await page.goto("/attendant/account");
    await expect(
      page.getByText("Grace Browser", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Sign out / hand over device", exact: true })
      .click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/attendant\/sign-in$/);
    expect(
      await page.evaluate(
        async () => (await fetch("/api/attendant/session")).status,
      ),
    ).toBe(401);
    const session = await db.query(
      "SELECT revoked_at FROM auth_session WHERE user_id=$1",
      [userId],
    );
    expect(session.rows).toHaveLength(1);
    expect(session.rows[0].revoked_at).not.toBeNull();
  } finally {
    await db.end();
  }
});

test("real HTTP auth routes reject public signup and revoke cookie sessions", async ({
  request,
}) => {
  const { db, userId, attendantId, username, password } = await authFixture();
  try {
    expect(
      (await request.post("/api/auth/sign-up/email", { data: {} })).status(),
    ).toBe(404);
    const headers = {
      Origin: "http://127.0.0.1:3000",
      "Idempotency-Key": v7(),
    };
    const login = await request.post("/api/attendant/sign-in", {
      headers,
      data: { username, password, deviceId: v7() },
    });
    expect(login.status()).toBe(200);
    const data = await login.json();
    expect(data.data.account.id).toBe(attendantId);
    expect(data.data.token).toBeUndefined();
    expect(login.headers()["cache-control"]).toBe("no-store");
    expect((await request.get("/api/attendant/session")).status()).toBe(200);
    expect(
      (
        await request.post("/api/attendant/sign-out", { headers, data: {} })
      ).status(),
    ).toBe(204);
    expect((await request.get("/api/attendant/session")).status()).toBe(401);
    const revoked = await db.query(
      "SELECT revoked_at FROM auth_session WHERE user_id=$1",
      [userId],
    );
    expect(revoked.rows[0].revoked_at).not.toBeNull();
  } finally {
    await db.end();
  }
});

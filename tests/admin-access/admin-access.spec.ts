import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { v7 } from "uuid";
import { fixture, signIn, mailLink } from "./admin-access.fixtures";
// Secrets and recipient links must never enter retained browser artifacts.
test.use({ trace: "off", video: "off", screenshot: "off" });
test("I-07 I-09 I-12 I-13 named admin first-password, users, verification, recovery and revocation on real Postgres and Mailpit", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180000);
  const f = await fixture();
  const next = randomBytes(24).toString("hex");
  const secondName = `grace.${v7().slice(-12)}`,
    email = `${secondName}@example.com`,
    temporary = randomBytes(24).toString("hex");
  try {
    await signIn(page, f.username, f.password);
    await expect(page).toHaveURL(/first-password/);
    expect(
      (
        await page.request.post("/api/admin/users/search", {
          headers: { Origin: "http://127.0.0.1:3104" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    await page.getByLabel("New password", { exact: true }).fill(next);
    await page.getByLabel("Confirm new password", { exact: true }).fill(next);
    await page
      .getByRole("button", { name: "Save and continue", exact: true })
      .click();
    await page.goto("/admin/users");
    await expect(
      page.getByRole("heading", { name: "Admin users & roles", exact: true }),
    ).toBeVisible();
    await page.goto("/admin/roles/new");
    await page
      .getByLabel("Role name", { exact: true })
      .fill(`Smoke ${secondName}`);
    const reports = page.getByRole("checkbox", {
      name: "View reports",
      exact: true,
    });
    await reports.check();
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Fictional browser verification");
    await page
      .getByRole("button", { name: "Review role", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review role", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/roles/);
    const role = (
      await f.db.query("SELECT id FROM role WHERE name=$1", [
        `Smoke ${secondName}`,
      ])
    ).rows[0];
    expect(role).toBeTruthy();
    await page.goto("/admin/users/new");
    await page.getByLabel("Full name", { exact: true }).fill("Grace Okon");
    await page.getByLabel("Username", { exact: true }).fill(secondName);
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page
      .getByLabel("Temporary password", { exact: true })
      .fill(temporary);
    await page.getByLabel("Role", { exact: true }).selectOption(role.id);
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Fictional reporting assistant");
    await page
      .getByRole("button", { name: "Review user", exact: true })
      .click();
    expect(await page.getByText(temporary, { exact: true }).count()).toBe(0);
    await page
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    const account = (
      await f.db.query(
        "SELECT a.id,a.user_id,a.email_verified_at FROM admin a WHERE email_normalized=$1",
        [email],
      )
    ).rows[0];
    expect(account.email_verified_at).toBeNull();
    const verification = await mailLink(email, "Verify");
    const recipient = await browser.newContext({
      baseURL: "http://127.0.0.1:3104",
      trace: "off",
    } as never);
    const landing = await recipient.newPage();
    await landing.goto(verification.link);
    await expect(landing).not.toHaveURL(/token=/);
    expect(
      (
        await f.db.query("SELECT email_verified_at FROM admin WHERE id=$1", [
          account.id,
        ])
      ).rows[0].email_verified_at,
    ).toBeNull();
    await landing
      .getByRole("button", { name: "Verify email address", exact: true })
      .click();
    await expect(
      landing.getByRole("heading", { name: "Email verified", exact: true }),
    ).toBeVisible();
    await landing.goto(verification.link);
    await expect(
      landing.getByRole("heading", {
        name: "This verification link is unavailable",
        exact: true,
      }),
    ).toBeVisible();
    await signIn(landing, secondName, temporary);
    await expect(landing).toHaveURL(/first-password/);
    const secondPassword = randomBytes(24).toString("hex");
    await landing
      .getByLabel("New password", { exact: true })
      .fill(secondPassword);
    await landing
      .getByLabel("Confirm new password", { exact: true })
      .fill(secondPassword);
    await landing
      .getByRole("button", { name: "Save and continue", exact: true })
      .click();
    expect(
      (
        await landing.request.post("/api/admin/users/search", {
          headers: { Origin: "http://127.0.0.1:3104" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    await page.goto("/admin/forgot-password");
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page
      .getByRole("button", { name: "Send reset link", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Check your email", exact: true }),
    ).toBeVisible();
    const reset = await mailLink(email, "Reset");
    await page.goto(reset.link);
    await expect(page).not.toHaveURL(/token=/);
    const resetPassword = randomBytes(24).toString("hex");
    await page.getByLabel("New password", { exact: true }).fill(resetPassword);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill(resetPassword);
    await page
      .getByRole("button", { name: "Reset password", exact: true })
      .click();
    await expect(page).toHaveURL(/sign-in/);
    expect((await landing.request.get("/api/admin/session")).status()).toBe(
      401,
    );
    await page.goto(reset.link);
    await expect(
      page.getByRole("heading", {
        name: "This link is unavailable",
        exact: true,
      }),
    ).toBeVisible();
    await signIn(page, secondName, resetPassword);
    await expect(page).not.toHaveURL(/sign-in/);
    await page.goto("/admin/sign-out");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/signed-out/);
    expect((await page.request.get("/api/admin/session")).status()).toBe(401);
    expect(await context.storageState()).toMatchObject({ origins: [] });
    await recipient.close();
  } finally {
    await f.db.end();
  }
});

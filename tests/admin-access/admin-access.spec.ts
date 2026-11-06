import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { v7 } from "uuid";
import { fixture, signIn, mailLink } from "./admin-access.fixtures";

async function shot(page: Page, board: string) {
  expect(
    await page
      .locator('input[type="password"]')
      .evaluateAll((nodes) =>
        nodes.every((node) => (node as HTMLInputElement).value === ""),
      ),
  ).toBe(true);
  const heights: Record<string, number> = {
    "H02-CreateUser": 1070,
    "H09-ReviewUserChange": 965,
    "H03-ManageUser": 1215,
    "H04-UnverifiedUser": 1137,
    "H06-CreateRole": 1496,
    "H08-SensitivePermissions": 1637,
    "M01-VerificationEmail": 983,
    "M02-PasswordResetEmail": 967,
  };
  if (!board.startsWith("mobile-"))
    await page.setViewportSize({
      width: board.startsWith("M0") ? 760 : 1440,
      height: heights[board] ?? 900,
    });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await mkdir("tests/design-parity/admin-access/screenshots", {
    recursive: true,
  });
  await page.screenshot({
    path: `tests/design-parity/admin-access/screenshots/${board}.built.png`,
    fullPage: true,
  });
}

async function phoneCheck(page: Page, slug: string) {
  const original = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const button of await page.getByRole("button").all()) {
    const box = await button.boundingBox();
    if (box) expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await shot(page, `mobile-${slug}`);
  await page.setViewportSize(original);
}
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
    await page.goto("/admin/sign-in");
    await shot(page, "B01-AdminSignIn");
    await signIn(page, f.username, f.password);
    await expect(page).toHaveURL(/first-password/);
    await shot(page, "B08-FirstPassword");
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
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/users");
    await expect(
      page.getByRole("heading", { name: "Admin users & roles", exact: true }),
    ).toBeVisible();
    await page.goto("/admin/roles");
    await shot(page, "H05-Roles");
    await page.goto("/admin/roles/owner");
    await shot(page, "H08-SensitivePermissions");
    await page.goto("/admin/roles/new");
    await shot(page, "H06-CreateRole");
    await phoneCheck(page, "role-editor");
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
    await shot(page, "H10-ReviewRoleChange");
    await phoneCheck(page, "role-review");
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review role", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/roles\/[0-9a-f-]+$/);
    const role = (
      await f.db.query("SELECT id FROM role WHERE name=$1", [
        `Smoke ${secondName}`,
      ])
    ).rows[0];
    expect(role).toBeTruthy();
    await page.goto("/admin/users");
    await shot(page, "H01-Users");
    await phoneCheck(page, "users");
    await page.goto("/admin/users/new");
    await shot(page, "H02-CreateUser");
    await phoneCheck(page, "create-user");
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
    await shot(page, "H09-ReviewUserChange");
    await page
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]+$/);
    const account = (
      await f.db.query(
        "SELECT a.id,a.user_id,a.email_verified_at FROM admin a WHERE email_normalized=$1",
        [email],
      )
    ).rows[0];
    expect(account.email_verified_at).toBeNull();
    await page.goto(`/admin/users/${account.id}`);
    await shot(page, "H04-UnverifiedUser");
    await page
      .getByRole("button", { name: "Send verification link", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Verification link queued",
        exact: true,
      }),
    ).toBeVisible();
    await shot(page, "B14-VerificationSent");
    const verification = await mailLink(email, "Verify");
    const recipient = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 2,
      baseURL: "http://127.0.0.1:3104",
      trace: "off",
    } as never);
    const landing = await recipient.newPage();
    await landing.setContent(
      verification.html.replace(/#token=[a-zA-Z0-9_-]+/g, "#token=[redacted]"),
    );
    await shot(landing, "M01-VerificationEmail");
    await landing.goto(verification.link);
    await expect(landing).not.toHaveURL(/token=/);
    await expect(
      landing.getByRole("button", {
        name: "Verify email address",
        exact: true,
      }),
    ).toBeEnabled();
    await shot(landing, "B15-EmailVerification");
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
    await shot(landing, "B16-VerificationComplete");
    await landing.goto(verification.link);
    await expect(
      landing.getByRole("heading", {
        name: "This verification link is unavailable",
        exact: true,
      }),
    ).toBeVisible();
    await shot(landing, "B17-VerificationExpired");
    await page.goto(`/admin/users/${account.id}`);
    await shot(page, "H03-ManageUser");
    await page.goto(`/admin/roles/${role.id}`);
    await page
      .getByRole("checkbox", { name: "Export reports", exact: true })
      .check();
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Fictional export grant review");
    await page
      .getByRole("button", { name: "Review role", exact: true })
      .click();
    await expect(
      page.getByText("Affected users", { exact: true }),
    ).toBeVisible();
    const review = page
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: /Review access change/ }),
      })
      .first();
    await expect(
      review.getByText("View reports", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      review.getByText("Export reports", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page
        .locator("dt")
        .filter({ hasText: "Affected users" })
        .locator("xpath=following-sibling::dd[1]"),
    ).toHaveText("1");
    await shot(page, "H10-ReviewRoleChange");
    await phoneCheck(page, "role-review");

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
    await expect(landing).not.toHaveURL(/first-password/);
    expect(
      (
        await landing.request.post("/api/admin/users/search", {
          headers: { Origin: "http://127.0.0.1:3104" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    await page.goto("/admin/forgot-password");
    await shot(page, "B10-PasswordRecovery");
    await page.getByLabel("Email address", { exact: true }).fill(email);
    await page
      .getByRole("button", { name: "Send reset link", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Check your email", exact: true }),
    ).toBeVisible();
    await shot(page, "B11-RecoveryEmailSent");
    const reset = await mailLink(email, "Reset");
    await landing.setContent(
      reset.html.replace(/#token=[a-zA-Z0-9_-]+/g, "#token=[redacted]"),
    );
    await shot(landing, "M02-PasswordResetEmail");
    await page.goto(reset.link);
    await expect(page).not.toHaveURL(/token=/);
    await expect(
      page.getByLabel("New password", { exact: true }),
    ).toBeVisible();
    await shot(page, "B12-ResetPassword");
    await page.request.post("/api/admin/password-reset-requests", {
      headers: { Origin: "http://127.0.0.1:3104", "Idempotency-Key": v7() },
      data: { email },
    });
    const freshReset = await mailLink(email, "Reset", reset.link);
    await page.goto(reset.link);
    await expect(
      page.getByRole("heading", {
        name: "This link is unavailable",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(freshReset.link);
    await expect(
      page.getByLabel("New password", { exact: true }),
    ).toBeVisible();
    await page.goBack();
    await page.goForward();
    await expect(
      page.getByRole("heading", {
        name: "This link is unavailable",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto(freshReset.link);
    await expect(
      page.getByLabel("New password", { exact: true }),
    ).toBeVisible();

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
    await page.goto(freshReset.link);
    await expect(
      page.getByRole("heading", {
        name: "This link is unavailable",
        exact: true,
      }),
    ).toBeVisible();
    await shot(page, "B13-ResetLinkUnavailable");
    await signIn(page, secondName, resetPassword);
    await expect(page).not.toHaveURL(/sign-in/);
    await page.goto("/admin/sign-out");
    await shot(page, "B09-SignOut");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/signed-out/);
    await shot(page, "B18-SignedOut");
    expect((await page.request.get("/api/admin/session")).status()).toBe(401);
    expect(await context.storageState()).toMatchObject({ origins: [] });
    await recipient.close();
  } finally {
    await f.db.end();
  }
});

test("admin access remains usable at 390px without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of [
    "sign-in",
    "forgot-password",
    "reset-password",
    "verify-email",
    "signed-out",
  ]) {
    await page.goto(`/admin/${route}`);
    await page.waitForLoadState("networkidle");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const buttons = await page.getByRole("button").all();
    for (const button of buttons) {
      const box = await button.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await shot(page, `mobile-${route}`);
  }
});

test("I-07 I-08 I-10 server refusals survive user confirmation: last Owner, stale version and delegation", async ({
  page,
}) => {
  test.setTimeout(120000);
  const f = await fixture();
  async function first(username: string, password: string) {
    await signIn(page, username, password);
    await expect(page).toHaveURL(/first-password/);
    const next = randomBytes(24).toString("hex");
    await page.getByLabel("New password", { exact: true }).fill(next);
    await page.getByLabel("Confirm new password", { exact: true }).fill(next);
    await page
      .getByRole("button", { name: "Save and continue", exact: true })
      .click();
    await expect(page).not.toHaveURL(/first-password/);
  }
  try {
    await first(f.username, f.password);
    await f.db.query(
      "UPDATE auth_user SET enabled=false WHERE id<>$1 AND id IN (SELECT a.user_id FROM admin a JOIN role r ON r.id=a.role_id WHERE r.is_owner=true)",
      [f.userId],
    );
    await page.goto(`/admin/users/${f.adminId}`);
    await page
      .getByLabel("Account status", { exact: true })
      .selectOption("false");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Fictional last Owner refusal");
    await page
      .getByRole("button", { name: "Review user", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "At least one active Owner must remain." }),
    ).toBeVisible();
    expect(
      (
        await f.db.query("SELECT enabled FROM auth_user WHERE id=$1", [
          f.userId,
        ])
      ).rows[0].enabled,
    ).toBe(true);
    await page.reload();
    await page
      .getByLabel("Account status", { exact: true })
      .selectOption("false");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Fictional stale confirmation");
    await page
      .getByRole("button", { name: "Review user", exact: true })
      .click();
    await f.db.query("UPDATE admin SET version=version+1 WHERE id=$1", [
      f.adminId,
    ]);
    await page
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({
        hasText: "This record changed. Reload and review the latest version.",
      }),
    ).toBeVisible();
    const limitedRole = v7();
    await f.db.query(
      "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,false,true,1)",
      [limitedRole, `Users ${limitedRole}`],
    );
    await f.db.query(
      "INSERT INTO role_permission(role_id,permission_code) VALUES($1,'users')",
      [limitedRole],
    );
    const limited = await fixture(limitedRole);
    try {
      await page.goto("/admin/sign-out");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page).toHaveURL(/signed-out/);
      await first(limited.username, limited.password);
      await page.goto(`/admin/users/${f.adminId}`);
      await page
        .getByLabel("Account status", { exact: true })
        .selectOption("false");
      await page
        .getByLabel("Reason", { exact: true })
        .fill("Fictional delegation refusal");
      await page
        .getByRole("button", { name: "Review user", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Confirm change", exact: true })
        .click();
      await expect(
        page.getByRole("alert").filter({
          hasText:
            "You cannot grant or change access beyond your own authority.",
        }),
      ).toBeVisible();
      expect((await page.request.get("/api/admin/roles")).status()).toBe(403);
    } finally {
      await limited.db.end();
    }
  } finally {
    await f.db.end();
  }
});

test("I-13 restricted first-password session can sign out without entering portal", async ({
  page,
}) => {
  const f = await fixture();
  try {
    await signIn(page, f.username, f.password);
    await expect(page).toHaveURL(/first-password/);
    await page.goto("/admin/sign-out");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/signed-out/);
    expect((await page.request.get("/api/admin/session")).status()).toBe(401);
  } finally {
    await f.db.end();
  }
});

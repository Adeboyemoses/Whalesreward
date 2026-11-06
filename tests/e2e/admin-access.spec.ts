import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { fixture, signIn } from "../admin-access/admin-access.fixtures";
test.use({ trace: "off", video: "off", screenshot: "off" });
test("I-07 I-09 I-13 admin browser restriction, role dependency, confirmed access and revoked session", async ({
  page,
}) => {
  const f = await fixture();
  const password = randomBytes(24).toString("hex");
  try {
    await signIn(page, f.username, f.password);
    await expect(page).toHaveURL(/first-password/);
    expect(
      (
        await page.request.post("/api/admin/users/search", {
          headers: { Origin: "http://127.0.0.1:3000" },
          data: {},
        })
      ).status(),
    ).toBe(403);
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill(password);
    await page
      .getByRole("button", { name: "Save and continue", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin$/);
    await page.goto("/admin/roles/new");
    await page
      .getByLabel("Role name", { exact: true })
      .fill(`Reporting ${f.username}`);
    await page
      .getByRole("checkbox", { name: "Export reports", exact: true })
      .check();
    await expect(
      page.getByRole("checkbox", { name: "View reports", exact: true }),
    ).toBeChecked();
    await page
      .getByRole("checkbox", { name: "View reports", exact: true })
      .uncheck();
    await expect(
      page.getByRole("checkbox", { name: "Export reports", exact: true }),
    ).not.toBeChecked();
    await page
      .getByRole("checkbox", { name: "View reports", exact: true })
      .check();
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Fictional reporting test");
    await page
      .getByRole("button", { name: "Review role", exact: true })
      .click();
    expect(
      (
        await f.db.query("SELECT id FROM role WHERE name=$1", [
          `Reporting ${f.username}`,
        ])
      ).rowCount,
    ).toBe(0);
    await page
      .getByRole("button", { name: "Confirm change", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await f.db.query("SELECT id FROM role WHERE name=$1", [
              `Reporting ${f.username}`,
            ])
          ).rowCount,
      )
      .toBe(1);
    await page.goto("/admin/users");
    await expect(
      page.getByRole("heading", { name: "Admin users & roles", exact: true }),
    ).toBeVisible();
    await f.db.query(
      "UPDATE auth_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
      [f.userId],
    );
    await page.reload();
    await expect(page).toHaveURL(/sign-in/);
    expect(
      (
        await page.request.post("/api/admin/users/search", {
          headers: { Origin: "http://127.0.0.1:3000" },
          data: {},
        })
      ).status(),
    ).toBe(401);
  } finally {
    await f.db.end();
  }
});

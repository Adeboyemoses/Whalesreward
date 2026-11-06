import { test, expect } from "@playwright/test";
import { fixture, signIn } from "../../admin-access/admin-access.fixtures";
import { mkdir } from "node:fs/promises";
test.use({ trace: "off", video: "off", screenshot: "off" });
for (const width of [1440, 390])
  test(`admin navigation fidelity at ${width}px`, async ({ page }) => {
    const f = await fixture();
    try {
      await page.setViewportSize({ width, height: 1000 });
      await f.db.query(
        "UPDATE auth_user SET must_change_password=false WHERE id=$1",
        [f.userId],
      );
      await signIn(page, f.username, f.password);
      await expect(page).toHaveURL(/\/admin$/);
      await page
        .getByRole("link", { name: "Admin users", exact: true })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Portal users", exact: true }),
      ).toBeVisible();
      await mkdir("tests/design-parity/admin-navigation/screenshots", {
        recursive: true,
      });
      async function capture(board: string) {
        expect(
          await page
            .locator('input[type="password"]')
            .evaluateAll((inputs) =>
              inputs.every((input) => (input as HTMLInputElement).value === ""),
            ),
        ).toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `tests/design-parity/admin-navigation/screenshots/${board}-${width}.built.png`,
          fullPage: true,
        });
      }
      await capture("H01-Users");
      await page
        .getByRole("row")
        .filter({ hasText: f.username })
        .getByRole("link", { name: "Manage", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: /^Manage admin user/ }),
      ).toBeVisible();
      await capture("H04-UnverifiedUser");
      await page
        .getByRole("link", { name: "Roles & permissions", exact: true })
        .first()
        .click();
      await expect(
        page.getByRole("heading", { name: "Roles & permissions", exact: true }),
      ).toBeVisible();
      await capture("H05-Roles");
      await page
        .getByRole("row")
        .filter({ hasText: "Protected Owner" })
        .getByRole("link", { name: "View permissions", exact: true })
        .click();
      await expect(page.getByRole("checkbox")).toHaveCount(28);
      await capture("H08-SensitivePermissions");
    } finally {
      await f.db.end();
    }
  });

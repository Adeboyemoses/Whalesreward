import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { v7 } from "uuid";
import { stationFixture, seedId, attendantSignIn } from "../../station/helpers";
import { fillSale, save, waitForWorker } from "../../fixtures/offline-browser";

async function shot(page: Page, id: string, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  expect(
    await page
      .locator('input[type="password"]')
      .evaluateAll((nodes) =>
        nodes.every((n) => (n as HTMLInputElement).value === ""),
      ),
  ).toBe(true);
  await mkdir("tests/design-parity/station/screenshots", { recursive: true });
  await page.screenshot({
    path: `tests/design-parity/station/screenshots/${id}-${width}.built.png`,
    fullPage: true,
  });
}
for (const width of [1440, 390])
  test(`F01–F10 D01–D04 station boards and A17 responsive at ${width}`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(120000);
    const f = await stationFixture(page);
    const accountPassword = randomBytes(20).toString("hex");
    const phone = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      permissions: ["camera"],
    });
    const p = await phone.newPage();
    try {
      await f.db.query(
        "UPDATE auth_user SET must_change_password=false WHERE id=$1",
        [seedId(3)],
      );
      await f.db.query(
        "INSERT INTO auth_credential(id,user_id,provider,provider_account_id,password_hash,updated_at) VALUES($1,$2,'credential',$2::text,$3,now()) ON CONFLICT(provider,provider_account_id) DO UPDATE SET password_hash=excluded.password_hash,updated_at=now()",
        [v7(), seedId(3), await hashPassword(accountPassword)],
      );
      await p.route("**/api/sync/**", (route) =>
        route.fulfill({
          status: 503,
          json: {
            error: {
              code: "temporarily_unavailable",
              message: "Fixture upload interrupted",
              retryable: true,
            },
            serverTime: new Date().toISOString(),
            requestId: v7(),
          },
        }),
      );
      await attendantSignIn(p, "grace.okon", accountPassword);
      await expect(p).toHaveURL(/\/attendant\/sale$/);
      await waitForWorker(p);
      await fillSale(p, { value: "20000.00" });
      await phone.setOffline(true);
      await save(p);
      await page.goto("/admin/pumps");
      await expect(
        page.getByRole("heading", { name: "Station pumps", exact: true }),
      ).toBeVisible();
      await shot(page, "F01-StationPumps", width);
      await page.goto("/admin/pumps/new");
      await page
        .getByLabel("Pump name", { exact: true })
        .fill(`Pump ${width === 1440 ? "06" : "07"}`);
      await page
        .getByLabel("Product", { exact: true })
        .selectOption("kerosene");
      await shot(page, "F02-AddPump", width);
      await page.getByRole("button", { name: "Add pump", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/pumps\/[0-9a-f-]+$/);
      await expect(
        page.getByRole("heading", { name: "Pump details", exact: true }),
      ).toBeVisible();
      await shot(page, "F03-PumpDetails", width);
      await page.goto("/admin/prices");
      await expect(
        page.getByRole("heading", { name: "Product prices", exact: true }),
      ).toBeVisible();
      await shot(page, "F05-ProductPrices", width);
      await page.goto("/admin/prices/pms/edit");
      await page
        .getByLabel(/New price/)
        .fill(width === 1440 ? "1050.00" : "1051.00");
      await page
        .getByLabel("Quantity decimal places", { exact: true })
        .selectOption("3");
      await page
        .getByLabel("Reason for change", { exact: true })
        .fill("Align with fictional pump rate");
      await shot(page, "F06-UpdatePrice", width);
      await page
        .getByRole("button", { name: "Review price change", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Confirm new price", exact: true }),
      ).toBeVisible();
      await shot(page, "F07-PriceActivation", width);
      await page
        .getByRole("button", { name: "Confirm new price", exact: true })
        .click();
      await expect(page).toHaveURL(/\/admin\/prices$/);
      await expect(
        page.getByText("Price activated.", { exact: true }),
      ).toBeVisible();
      await shot(page, "F08-PriceActivated", width);
      await page.goto("/admin/attendants");
      await expect(
        page.getByRole("heading", { name: "Attendants", exact: true }),
      ).toBeVisible();
      await shot(page, "D01-Attendants", width);
      await page.goto("/admin/attendants/new");
      await page.getByLabel("Full name", { exact: true }).fill("Favour James");
      const username = `parity.favour.${v7().slice(-8)}`;
      await page.getByLabel("Username", { exact: true }).fill(username);
      await page
        .getByLabel("Assign pump", { exact: true })
        .selectOption(seedId(17));
      await shot(page, "D02-CreateAttendant", width);
      await page
        .getByLabel("Password", { exact: true })
        .fill(randomBytes(20).toString("hex"));
      await page
        .getByRole("button", { name: "Create account", exact: true })
        .click();
      await expect(page).toHaveURL(/\/admin\/attendants\/[0-9a-f-]+$/);
      await expect(
        page.getByText("Attendant created.", { exact: true }),
      ).toBeVisible();
      await shot(page, "D04-AttendantCreated", width);
      await page.goto(`/admin/attendants/${seedId(6)}`);
      await expect(
        page.getByRole("heading", { name: "Grace Okon", exact: true }),
      ).toBeVisible();
      await shot(page, "D03-AttendantProfile", width);
      await page.goto(`/admin/pumps/${seedId(16)}/assign`);
      await page
        .getByLabel("Attendant account", { exact: true })
        .selectOption(seedId(6));
      await page
        .getByLabel("Reason for assignment", { exact: true })
        .fill("Pump 02 under fictional maintenance; Grace covers kerosene.");
      await shot(page, "F04-PumpAssignment", width);
      await page
        .getByRole("button", { name: "Review assignment", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Confirm assignment", exact: true }),
      ).toBeVisible();
      await shot(page, "F09-AssignmentConfirm", width);
      await page
        .getByRole("button", { name: "Confirm assignment", exact: true })
        .click();
      await expect(
        page.getByText("Assignment recorded.", { exact: true }),
      ).toBeVisible();
      await shot(page, "F10-AssignmentRecorded", width);
      await phone.setOffline(false);
      await p.goto("/attendant/account");
      await expect(
        p.getByRole("button", { name: "Sign out to switch pump", exact: true }),
      ).toBeVisible();
      await shot(p, "A17-PumpChange", width === 1440 ? 390 : 360);
    } finally {
      await phone.close();
      await f.db.end();
    }
  });

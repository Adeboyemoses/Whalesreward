import { test, expect, type Page } from "@playwright/test";
import { permissionCodes } from "../../../src/shared/contracts/admin";
import { mkdir, writeFile } from "node:fs/promises";
import {
  recoveryFixture,
  fillPhone,
  fillIntake,
  verificationBridge,
} from "../../customer-changes/helpers";
const directory = "tests/design-parity/customer-changes/screenshots";
async function capture(page: Page, id: string, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByText(/^Loading(?:…|\.\.\.)$/)).toHaveCount(0);
  const metrics = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    forms: [...document.querySelectorAll("input,textarea,button,a.wr-btn")].map(
      (element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          type: element.getAttribute("type"),
          width: rect.width,
          height: rect.height,
        };
      },
    ),
  }));
  await page.screenshot({
    path: `${directory}/${id}-${width}.built.png`,
    fullPage: true,
  });
  await writeFile(
    `${directory}/${id}-${width}.metrics.json`,
    JSON.stringify(metrics, null, 2),
  );
  expect(metrics.document).toBeLessThanOrEqual(width);
}
for (const width of [1440, 390])
  test(`C02-C05 designed states at ${width}px`, async ({ page }) => {
    await mkdir(directory, { recursive: true });
    const f = await recoveryFixture(page, [...permissionCodes]);
    const bridge = await verificationBridge(page, f.customerId);
    try {
      await page.goto(`${f.root}/phone`);
      await fillPhone(page);
      await capture(page, "C02-PhoneChange-edit", width);
      await page.getByLabel("New phone number", { exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(
        page.getByLabel(
          "I checked the customer's active loyalty card in person.",
          { exact: true },
        ),
      ).toBeFocused();
      await page
        .getByRole("button", { name: "Review phone update", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: /^Confirm account change/,
        }),
      ).toBeVisible();
      await capture(page, "C02-PhoneChange-review", width);
      await page.goto(`${f.root}/replace-card`);
      await page
        .getByRole("button", { name: "Send verification code", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Check verification status", exact: true })
        .click();
      await bridge.enterCode();
      await page
        .getByRole("button", { name: "Verify code", exact: true })
        .click();
      await expect(
        page.getByText("Phone verified", { exact: true }).first(),
      ).toBeVisible();
      // No capture is allowed while the ephemeral verification input is present.
      expect(
        (await page
          .getByLabel("Verification code", { exact: true })
          .count()) === 0 ||
          (await page
            .getByLabel("Verification code", { exact: true })
            .inputValue()) === "",
      ).toBe(true);
      await page
        .getByLabel("Unused card number", { exact: true })
        .fill(f.newCard);
      await page
        .getByLabel("Reason for replacement", { exact: true })
        .fill("Card lost; customer reported at the station in person.");
      await capture(page, "C03-CardReplacement-link", width);
      await page.getByLabel("Unused card number", { exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Scan", exact: true }),
      ).toBeFocused();
      await page
        .getByRole("button", { name: "Review replacement", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: /^Confirm account change/,
        }),
      ).toBeVisible();
      await capture(page, "C03-CardReplacement-review", width);
      await page
        .getByRole("button", { name: "Confirm change", exact: true })
        .click();
      await expect(page.getByText(/Change applied/).first()).toBeVisible();
      await expect(
        page
          .getByRole("heading", {
            name: "Account change history",
            exact: true,
          })
          .first(),
      ).toBeVisible();
      await capture(page, "C05-AccountChangeApplied", width);
      await page.goto(`${f.root}/recovery`);
      await fillIntake(page);
      await capture(page, "C04-RecoveryReview", width);
      await page.getByLabel("Review notes", { exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(
        page.getByLabel("Why the code cannot be used", { exact: true }),
      ).toBeFocused();
    } finally {
      await bridge.close();
      await f.db.end();
    }
  });

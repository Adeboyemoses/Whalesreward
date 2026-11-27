import { test, expect, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  settingsFixture,
  saveIntent,
  editIntent,
  reviewIntent,
  daysLabel,
} from "../../settings/helpers";
import { instantToWallClock } from "../../../src/ui/pickers";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.setTimeout(60000);
const destination = fileURLToPath(new URL("./", import.meta.url));
async function capture(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  if (name.startsWith("B07"))
    await expect(
      page.getByRole("heading", { name: /^Photo retention/ }),
    ).toBeVisible();
  const metrics = await page.evaluate(() => {
    const brand = document.querySelector(".wr-brand-name");
    const text =
      brand &&
      [...brand.childNodes].find(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
      );
    const range = document.createRange();
    if (text) range.selectNodeContents(text);
    return {
      overflow: [...document.querySelectorAll<HTMLElement>("main *")]
        .map((el) => ({
          tag: el.tagName,
          class: el.className,
          text: el.textContent?.slice(0, 80),
          rect: el.getBoundingClientRect().toJSON(),
        }))
        .filter((el) => el.rect.right > innerWidth + 1),
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      brandLines: text ? range.getClientRects().length : null,
      controls: [
        ...document.querySelectorAll<HTMLElement>(
          "main input, main textarea, main button, main a",
        ),
      ]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => ({
          label:
            el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.id,
          rect: el.getBoundingClientRect().toJSON(),
        })),
      sheets: [...document.querySelectorAll(".wr-sheet")].map((el) =>
        el.getBoundingClientRect().toJSON(),
      ),
      tables: [...document.querySelectorAll(".wr-table-wrap")].map((el) => ({
        width: el.clientWidth,
        scrollWidth: el.scrollWidth,
      })),
    };
  });
  await writeFile(
    destination + name + ".metrics.json",
    JSON.stringify(metrics, null, 2),
  );
  await page.screenshot({
    path: destination + name + ".built.png",
    fullPage: true,
  });
  expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
  if (name.startsWith("T03"))
    for (const table of metrics.tables)
      expect(table.scrollWidth).toBeLessThanOrEqual(table.width + 1);
  if (metrics.brandLines !== null) expect(metrics.brandLines).toBe(1);
  if (metrics.viewport < 900) {
    for (const control of metrics.controls)
      expect(
        control.rect.height,
        control.label ?? "control",
      ).toBeGreaterThanOrEqual(48);
  }
}
test("B07 T01 T03 T02 T04 independent 1440px settings fidelity and phone layout", async ({
  page,
}) => {
  const f = await settingsFixture(page, null);
  try {
    await saveIntent(page, null, "Fictional unset evidence period");
    await page.goto("/admin/settings");
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await capture(page, "B07-1440");
    await page.goto("/admin/settings/giveaway");
    // Confirms the form rendered for a brand-new campaign before driving it.
    await expect(
      page.getByLabel("Launch date", { exact: true }),
    ).toBeVisible();
    const zone = "Africa/Lagos";
    // The timezone must be committed before the date/time pairs: each pair
    // is interpreted as wall-clock time in whichever zone is currently
    // selected (see editTiming in tests/e2e/campaign-timing-real.spec.ts).
    const tzInput = page.getByRole("combobox", { name: "Campaign timezone" });
    await tzInput.click();
    await tzInput.fill(zone);
    await page.getByRole("option", { name: zone, exact: true }).click();
    await expect(tzInput).toHaveValue(zone);
    for (const [label, instant] of [
      ["Launch", "2035-03-01T00:00:00Z"],
      ["Purchase start", "2035-03-02T00:00:00Z"],
      ["Purchase cutoff", "2035-03-09T01:59:59Z"],
    ] as const) {
      const wall = instantToWallClock(instant, zone)!;
      await page.getByLabel(`${label} date`, { exact: true }).fill(wall.date);
      await page.getByLabel(`${label} time`, { exact: true }).fill(wall.time);
    }
    await page
      .getByLabel("Upload grace period (hours)", { exact: true })
      .fill("0");
    await page
      .getByLabel("Reason for change", { exact: true })
      .fill("Fictional campaign timing discussion");
    await capture(page, "T01-1440");
    const review = page.waitForResponse((r) =>
      r.url().endsWith("/settings/giveaway/review"),
    );
    await page
      .getByRole("button", { name: "Review changes", exact: true })
      .click();
    expect((await review).status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Confirm changes", exact: true }),
    ).toBeVisible();
    await capture(page, "T03-1440");
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await capture(page, `T03-${width}`);
      await page
        .getByRole("button", { name: "Keep editing", exact: true })
        .click();
      await capture(page, `T01-${width}`);
      const response = page.waitForResponse((r) =>
        r.url().endsWith("/settings/giveaway/review"),
      );
      await page
        .getByRole("button", { name: "Review changes", exact: true })
        .click();
      expect((await response).status()).toBe(200);
      await expect(
        page.getByRole("button", { name: "Confirm changes", exact: true }),
      ).toBeVisible();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await editIntent(page, 37, "Fictional evidence retention discussion");
    await capture(page, "T02-1440");
    expect((await reviewIntent(page)).status()).toBe(200);
    await expect(
      page.getByRole("heading", {
        name: /^Confirm settings change/,
      }),
    ).toBeVisible();
    await capture(page, "T04-1440");
    await page
      .getByRole("button", { name: "Confirm changes", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const style = getComputedStyle(document.activeElement!);
      return {
        label: document.activeElement?.textContent,
        width: style.outlineWidth,
        style: style.outlineStyle,
      };
    });
    expect(focus).toMatchObject({
      label: "Keep editing",
      width: "2px",
      style: "solid",
    });
    await capture(page, "T04-focus-1440");
    for (const width of [390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      await capture(page, `T04-${width}`);
      await page
        .getByRole("button", { name: "Keep editing", exact: true })
        .click();
      await expect(page.getByLabel(daysLabel, { exact: true })).toHaveValue(
        "37",
      );
      await capture(page, `T02-${width}`);
      await page.goto("/admin/settings");
      await expect(
        page.getByRole("heading", { name: "Settings", exact: true }),
      ).toBeVisible();
      await capture(page, `B07-${width}`);
      await editIntent(page, 37, "Fictional evidence retention discussion");
      expect((await reviewIntent(page)).status()).toBe(200);
    }
  } finally {
    await f.close();
  }
});

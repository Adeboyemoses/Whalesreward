import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { reviewFixture, heldSale, explain } from "../../reviews/helpers";
import { installBrowserMeter } from "../../reviews/meter-helpers";
test.use({ trace: "off", screenshot: "off", video: "off" });
test("S04 independent meter editor at 1440 px", async ({ page, browser }) => {
  const f = await reviewFixture(page, browser);
  try {
    await installBrowserMeter(f.db);
    const sale = await heldSale(f, ["price"], "1000000", "before", {
      amount: "11000.00",
      quantity: "11.00",
    });
    await page.goto(`/admin/sales/${sale.id}/price-review/correct`);
    await page.getByLabel("Meter amount (₦)", { exact: true }).fill("11000.00");
    await page
      .getByLabel("Meter quantity (litres)", { exact: true })
      .fill("11.00");
    await explain(page);
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() =>
        page
          .locator('img[alt="Validated meter photo"]')
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    const metrics = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      inputs: [...document.querySelectorAll("input")].map((el) => ({
        label: el.id,
        rect: el.getBoundingClientRect().toJSON(),
      })),
    }));
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.width);
    const destination = fileURLToPath(new URL("./", import.meta.url));
    await writeFile(
      destination + "S04-1440.metrics.json",
      JSON.stringify(metrics, null, 2),
    );
    await page.screenshot({
      path: destination + "S04-1440.built.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Review correction", exact: true })
      .click();
    await page.screenshot({
      path: destination + "S04-review-1440.built.png",
      fullPage: true,
    });
  } finally {
    await f.close();
  }
});

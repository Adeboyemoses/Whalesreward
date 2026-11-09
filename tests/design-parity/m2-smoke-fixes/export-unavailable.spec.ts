import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { v7 } from "uuid";
import { stationFixture, api } from "../../customers-cards/helpers";
import { ensureLocalCardBucket } from "../../customers-cards/storage";

test("s02 unavailable PDF preparation notice at390", async ({ page }) => {
  await ensureLocalCardBucket();
  const f = await stationFixture(page);
  try {
    const batch = await api<{ id: string }>(
      page.request,
      "card-batches",
      {
        operationId: v7(),
        name: "Fictional export notice fixture",
        count: 10,
      },
      201,
    );
    await page.route(
      `**/api/admin/card-batches/${batch.id}/exports`,
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const response = await route.fetch();
        expect(response.status()).toBe(202);
        expect(
          (
            await f.db.query(
              "SELECT count(*)::int n FROM card_export WHERE batch_id=$1",
              [batch.id],
            )
          ).rows[0].n,
        ).toBe(1);
        await route.fulfill({
          status: 502,
          headers: { "content-type": "text/html", "cache-control": "no-store" },
          body: "<!doctype html><title>Bad gateway</title><p>Fictional local gateway unavailable</p>",
        });
      },
    );
    await page.goto(`/admin/cards/${batch.id}`);
    await page
      .getByRole("button", { name: "Export PDF print sheet", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review export preparation", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm export preparation", exact: true })
      .click();
    const sheet = page
      .locator("section.wr-sheet")
      .filter({
        has: page.getByRole("heading", {
          name: "PDF print sheet preparation",
          exact: true,
        }),
      });
    await expect(sheet.getByRole("alert")).toHaveText(
      "The service is unavailable. Retry the same request; do not assume it failed.",
    );
    await expect(
      sheet.getByRole("button", {
        name: "Retry same confirmation",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    await expect(
      sheet.getByRole("button", { name: "Review a new export", exact: true }),
    ).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await sheet.evaluate((node) => node.scrollIntoView({ block: "start" }));
    const metrics = await sheet.evaluate((node) => ({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      sheetWidth: node.getBoundingClientRect().width,
      notices: Array.from(node.querySelectorAll(".wr-notice")).map(
        (notice) => ({
          text: notice.textContent,
          width: notice.getBoundingClientRect().width,
          background: getComputedStyle(notice).backgroundColor,
        }),
      ),
      targets: Array.from(node.querySelectorAll("button")).map((button) => ({
        text: button.textContent,
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
        disabled: button.disabled,
      })),
    }));
    const output = "tests/design-parity/m2-smoke-fixes/screenshots";
    await mkdir(output, { recursive: true });
    await writeFile(
      `${output}/s02-ExportUnavailable-390.metrics.json`,
      JSON.stringify(metrics, null, 2) + "\n",
    );
    await page.screenshot({
      path: `${output}/s02-ExportUnavailable-390.built.png`,
    });
    expect(metrics.viewport).toBe(390);
    expect(metrics.documentWidth).toBeLessThanOrEqual(390);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.db.end();
  }
});

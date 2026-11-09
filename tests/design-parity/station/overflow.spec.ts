import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { stationFixture } from "../../station/helpers";

test("F01 mobile table scrolling stays inside the document viewport", async ({
  page,
}) => {
  const f = await stationFixture(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/pumps");
    await expect(page.getByRole("table")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      boxes: [
        ...document.querySelectorAll(
          ".wr-admin-shell,.wr-main,.wr-station,.wr-table-wrap,.wr-table,.wr-section",
        ),
      ].map((node) => {
        const r = node.getBoundingClientRect();
        return {
          tag: node.tagName,
          class: node.className,
          left: r.left,
          right: r.right,
          width: r.width,
          scroll: node.scrollWidth,
          client: node.clientWidth,
        };
      }),
    }));
    await mkdir("tests/design-parity/station/screenshots", { recursive: true });
    await writeFile(
      "tests/design-parity/station/screenshots/F01-overflow-390.metrics.json",
      JSON.stringify(geometry, null, 2) + "\n",
    );
    // Nonsecret geometry and a fixture-only list screenshot make a failure actionable.
    if (geometry.document > geometry.viewport)
      await page.screenshot({
        path: "/tmp/whr-station-f01-overflow.png",
        fullPage: true,
      });
    expect(geometry.document, JSON.stringify(geometry)).toBeLessThanOrEqual(
      geometry.viewport,
    );
  } finally {
    await f.db.end();
  }
});

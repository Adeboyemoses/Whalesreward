import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { v7 } from "uuid";
import {
  reviewFixture,
  heldSale,
  openReview,
  explain,
  confirm,
} from "../../reviews/helpers";
import { acceptedSale } from "../../sales-history/helpers";
const destination = fileURLToPath(new URL("./", import.meta.url));
test.use({ trace: "off", video: "off", screenshot: "off" });
async function capture(page: Page, id: string) {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page
        .locator("img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  const metrics = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    wordmarkLineBoxes: [...document.querySelectorAll(".wr-brand-name")].map(
      (el) => {
        const range = document.createRange();
        range.selectNodeContents(el.firstChild!);
        return [...range.getClientRects()].map((r) => ({
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
        }));
      },
    ),
    loyaltyFooters: document.querySelectorAll(".wr-loyalty-foot").length,
    controls: [...document.querySelectorAll("button,a,input,textarea,select")]
      .map((el) => ({
        name: el.textContent?.trim(),
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
      }))
      .filter((e) => e.width > 0 && e.height > 0),
  }));
  expect(metrics.scroll, id + " fits").toBeLessThanOrEqual(metrics.width);
  if (id.startsWith("A14")) {
    expect(metrics.wordmarkLineBoxes).toHaveLength(1);
    expect(metrics.wordmarkLineBoxes[0]).toHaveLength(1);
  }
  if (id.startsWith("A14"))
    expect(
      metrics.controls.filter((c) => c.height < 48),
      id + " phone targets",
    ).toEqual([]);
  await writeFile(
    destination + id + ".metrics.json",
    JSON.stringify(metrics, null, 2),
  );
  const viewport = page.viewportSize()!;
  if (id.startsWith("A14"))
    await page.setViewportSize({
      width: viewport.width,
      height: await page.evaluate(() => document.documentElement.scrollHeight),
    });
  await page.screenshot({
    path: destination + id + ".built.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize(viewport);
}
test("S02 duplicate pair at 1440px", async ({ page, browser }) => {
  test.setTimeout(90000);
  await mkdir(destination, { recursive: true });
  const f = await reviewFixture(page, browser);
  try {
    const a = await acceptedSale(f.phone, "amount", "1500000", f.cardCode),
      b = await acceptedSale(f.phone, "amount", "1500000", f.cardCode);
    await f.db.query(
      "INSERT INTO duplicate_flag(id,purchase_id,other_purchase_id,reason,state,version) VALUES($1,$2,$3,'Fictional possible repeated purchase','open',1) ON CONFLICT DO NOTHING",
      [v7(), ...[a.detail.id, b.detail.id].sort()],
    );
    await openReview(page, a.detail.id, "duplicate");
    await capture(page, "S02-1440");
  } finally {
    await f.close();
  }
});
test("S03 S04 S09 and A14 at 1440px 390px 360px", async ({ page, browser }) => {
  test.setTimeout(90000);
  const f = await reviewFixture(page, browser);
  try {
    const sale = await heldSale(f, ["price"]);
    await openReview(page, sale.id, "price");
    await capture(page, "S03-1440");
    await page.goto(`/admin/sales/${sale.id}/price-review/correct`);
    await expect(page.getByText(/Not available yet/).first()).toBeVisible();
    await capture(page, "S04-1440");
    for (const width of [390, 360]) {
      await f.phone.setViewportSize({ width, height: 844 });
      await f.phone.goto(`/attendant/history/${sale.id}`);
      await expect(
        f.phone.getByText("Awaiting price review", { exact: true }).first(),
      ).toBeVisible();
      await capture(f.phone, `A14-${width}`);
    }
    await openReview(page, sale.id, "price");
    await explain(page);
    await confirm(page, "Confirm captured values");
    await expect(
      page.getByText(/Decision recorded|Recorded decision/i).first(),
    ).toBeVisible();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByText("Not credited", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText("Awaiting price review", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Decision reason", { exact: true }),
    ).toHaveCount(0);
    await capture(page, "S09-1440");
  } finally {
    await f.close();
  }
});
for (const [kind, board] of [
  ["card", "S06"],
  ["date", "S07"],
  ["capture", "Capture"],
] as const) {
  test(board + " review at 1440px", async ({ page, browser }) => {
    test.setTimeout(90000);
    const f = await reviewFixture(page, browser);
    try {
      const sale = await heldSale(f, [kind]);
      await openReview(page, sale.id, kind);
      await capture(page, board + "-1440");
    } finally {
      await f.close();
    }
  });
}

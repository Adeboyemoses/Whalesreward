import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import {
  priceFixture,
  lookup,
  value,
  photo,
} from "../../price-adoption/helpers";
const directory = import.meta.dirname;
async function capture(page: Page, id: string, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await page.evaluate(() => document.fonts.ready);
  const metrics = await page.evaluate(() => {
    const lines = (el: Element | null) => {
      if (!el) return [];
      const r = document.createRange();
      r.selectNodeContents(
        el.classList.contains("wr-brand-name") ? el.firstChild! : el,
      );
      return [...r.getClientRects()].map((b) => ({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      }));
    };
    return {
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      wordmark: lines(document.querySelector(".wr-brand-name")),
      footer: [...document.querySelectorAll(".wr-caption")]
        .filter((el) => /loyalty|saved price/.test(el.textContent ?? ""))
        .map((el) => ({ text: el.textContent, boxes: lines(el) })),
      controls: [...document.querySelectorAll("button,input,a")]
        .map((el) => ({
          name: el.textContent,
          width: el.getBoundingClientRect().width,
          height: el.getBoundingClientRect().height,
        }))
        .filter((x) => x.width && x.height),
    };
  });
  expect(metrics.scrollWidth).toBe(width);
  expect(metrics.wordmark).toHaveLength(1);
  expect(metrics.controls.filter((x) => x.height < 48)).toEqual([]);
  await mkdir(directory, { recursive: true });
  await writeFile(
    `${directory}/${id}-${width}.metrics.json`,
    JSON.stringify(metrics, null, 2),
  );
  await page.setViewportSize({
    width,
    height: await page.evaluate(() => document.documentElement.scrollHeight),
  });
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: `${directory}/${id}-${width}.built.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width, height: 844 });
}
for (const width of [390, 360])
  test(`P-27 liquid sale base, kept-price and offline fidelity at ${width}`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(90000);
    const f = await priceFixture(page, browser);
    try {
      await capture(f.phone, "A02-Sale", width);
      await lookup(f.phone, f.codes[0]!);
      await value(f.phone, "20000");
      await f.phone
        .getByRole("button", { name: "Vehicle", exact: true })
        .click();
      await photo(f.phone);
      await capture(f.phone, "A03-SaleFilled", width);
      const other = await f.context.newPage();
      await other.goto("/attendant/sale");
      await f.activate("120000", 3);
      await lookup(other, f.codes[0]!);
      await expect(
        f.phone.getByText(/This sale keeps ₦1,000.00 per litre/),
      ).toBeVisible();
      await capture(f.phone, "P27-KeptPrice", width);
      await f.context.setOffline(true);
      await expect(
        f.phone.getByText(/You can keep recording sales/),
      ).toBeVisible();
      await capture(f.phone, "A27-SaleOffline", width);
    } finally {
      await f.close();
    }
  });
for (const width of [390, 360])
  test(`P-27 gas precision fidelity at ${width}`, async ({ page, browser }) => {
    test.setTimeout(90000);
    const f = await priceFixture(page, browser, true);
    try {
      await lookup(f.phone, f.codes[0]!);
      await value(f.phone, "15000");
      await photo(f.phone);
      await capture(f.phone, "A15-GasSale", width);
      const other = await f.context.newPage();
      await other.goto("/attendant/sale");
      await f.activate("150000", 3);
      await lookup(other, f.codes[0]!);
      await expect(
        f.phone.getByText(/This sale keeps its original quantity precision/),
      ).toBeVisible();
      await capture(f.phone, "P27-KeptPrecision", width);
    } finally {
      await f.close();
    }
  });

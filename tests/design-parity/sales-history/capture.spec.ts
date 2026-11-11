import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { v7 } from "uuid";
import type pg from "pg";
import {
  salesFixture,
  acceptedSale,
  submitCorrection,
} from "../../sales-history/helpers";
import { seedId } from "../../station/helpers";
const destination = fileURLToPath(new URL("./", import.meta.url));
test.use({ trace: "off", video: "off", screenshot: "off" });
async function ready(page: Page, title: string) {
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
async function image(page: Page, id: string) {
  const metrics = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(metrics.scroll, `${id} fits viewport`).toBeLessThanOrEqual(
    metrics.width,
  );
  await page.screenshot({
    path: `${destination}${id}.built.png`,
    fullPage: true,
    animations: "disabled",
  });
}
/** Fictional board-named identity/card fixtures; no change to a seeded customer's identity. */
async function boardCard(db: pg.Client, name: string, category: string) {
  const id = v7(),
    cardId = v7(),
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
    code = Array.from(
      randomBytes(7),
      (b) => alphabet[b % alphabet.length],
    ).join("");
  const phone = `+23480${String(BigInt("0x" + randomBytes(6).toString("hex")) % 100000000n).padStart(8, "0")}`;
  await db.query(
    "INSERT INTO customer(id,customer_code,name,phone_normalized,category,version) VALUES($1,$2,$3,$4,$5,1)",
    [id, `QA-${id}`, name, phone, category],
  );
  await db.query(
    "INSERT INTO card(id,batch_id,code,qr_payload,state,version) VALUES($1,$2,$3,$3,'unassigned',1)",
    [cardId, seedId(28), code],
  );
  await db.query(
    "INSERT INTO card_customer_link(id,card_id,customer_id,linked_at,actor_user_id,reason) VALUES($1,$2,$3,clock_timestamp(),$4,'Fictional fidelity card')",
    [v7(), cardId, id, seedId(2)],
  );
  await db.query("UPDATE card SET state='linked',version=2 WHERE id=$1", [
    cardId,
  ]);
  return code;
}
test("WO-app-7 independent phone fidelity A09 A10 A11 at390/360", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await mkdir(destination, { recursive: true });
  const f = await salesFixture(page, browser);
  try {
    const tunde = await boardCard(f.db, "Tunde Adebayo", "keg_buyer"),
      chidi = await boardCard(f.db, "Chidi Okafor", "bike_user");
    await acceptedSale(f.phone, "amount", "1500000", chidi, "bike");
    await acceptedSale(f.phone, "amount", "1000000", tunde, "keg");
    const main = await acceptedSale(f.phone);
    for (const width of [390, 360]) {
      await f.phone.setViewportSize({ width, height: 844 });
      await f.phone.goto("/attendant/history");
      await ready(f.phone, "Sales history");
      await expect(
        f.phone.getByText("Amina Bello", { exact: true }),
      ).toBeVisible();
      await expect(
        f.phone.getByText("Tunde Adebayo", { exact: true }),
      ).toBeVisible();
      await expect(
        f.phone.getByText("Chidi Okafor", { exact: true }),
      ).toBeVisible();
      await image(f.phone, `A09-${width}`);
      await f.phone.goto(`/attendant/history/${main.detail.id}`);
      await ready(f.phone, "Sale details");
      await expect(f.phone.getByAltText("Validated meter photo")).toBeVisible();
      await image(f.phone, `A10-${width}`);
      await f.phone.goto(`/attendant/history/${main.detail.id}/correct`);
      await ready(f.phone, "Correct sale");
      await expect(f.phone.getByLabel("Reason", { exact: true })).toBeVisible();
      await image(f.phone, `A11-${width}`);
    }
  } finally {
    await f.close();
  }
});
test("WO-app-7 independent admin fidelity B03 B04 S01 at1440", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await mkdir(destination, { recursive: true });
  const f = await salesFixture(page, browser);
  try {
    const tunde = await boardCard(f.db, "Tunde Adebayo", "keg_buyer"),
      chidi = await boardCard(f.db, "Chidi Okafor", "bike_user");
    const main = await acceptedSale(f.phone),
      other = await acceptedSale(f.phone, "amount", "1000000", tunde, "keg");
    await acceptedSale(f.phone, "amount", "1500000", chidi, "bike");
    await submitCorrection(f.phone, other, "1200000", true, f.db);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/sales");
    await ready(page, "Sales");
    await page.getByLabel("Search sales", { exact: true }).fill(f.username);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "View", exact: true }),
    ).toHaveCount(3);
    const searchBox = await page
        .getByLabel("Search sales", { exact: true })
        .boundingBox(),
      statusBox = await page
        .getByLabel("Record status", { exact: true })
        .boundingBox();
    expect(searchBox!.width).toBeGreaterThan(statusBox!.width * 2);
    await image(page, "B03-1440");
    await page.goto(`/admin/sales/${main.detail.id}`);
    await expect(
      page.getByRole("heading", { name: "Purchase details", exact: false }),
    ).toBeVisible();
    await expect(page.getByAltText("Validated meter photo")).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByAltText("Validated meter photo")
          .evaluate(
            (el) =>
              (el as HTMLImageElement).complete &&
              (el as HTMLImageElement).naturalWidth > 0,
          ),
      )
      .toBe(true);
    expect(
      await page
        .locator(".wr-photo")
        .first()
        .evaluate((el) => getComputedStyle(el).borderStyle),
    ).toBe("solid");
    await image(page, "B04-1440");
    await page.goto(`/admin/sales/${other.detail.id}/late-correction`);
    await expect(
      page.getByRole("heading", { name: /^Late correction request/ }),
    ).toBeVisible();
    await page
      .getByLabel("Decision reason", { exact: true })
      .fill("Meter photo confirms the numeric correction.");
    await expect(page.getByAltText("Validated meter photo")).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByAltText("Validated meter photo")
          .evaluate(
            (el) =>
              (el as HTMLImageElement).complete &&
              (el as HTMLImageElement).naturalWidth > 0,
          ),
      )
      .toBe(true);
    await expect(
      page
        .locator(".wr-notice")
        .filter({ hasText: "Late correction awaiting review" }),
    ).not.toHaveClass(/wr-success/);
    await image(page, "S01-1440");
  } finally {
    await f.close();
  }
});

import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { installAttendantFake } from "../../fixtures/attendant-http-fake";
import { fillSale, save, signIn } from "../../fixtures/offline-browser";

async function capture(page: Page, board: string, width: number) {
  await page.setViewportSize({ width, height: 1100 });
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
  });
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  await page.setViewportSize({ width, height });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const small = await page.locator("button, input, a").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const r = element.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.height < 48;
      })
      .map((element) => ({
        text: element.textContent,
        height: element.getBoundingClientRect().height,
      })),
  );
  expect(small).toEqual([]);
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(
      import.meta.dirname,
      "screenshots",
      `${board}-${width}.built.png`,
    ),
    fullPage: true,
    animations: "disabled",
  });
}
for (const width of [390, 360]) {
  for (const state of ["credited", "held", "gas", "pending"] as const) {
    test(`upload ${state} boards at ${width}px`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 844 });
      const fake = await installAttendantFake(context, { sync: true });
      if (state === "held") fake.sync.setOutcome("held");
      if (state === "pending") fake.sync.setPutFailure(true);
      await signIn(page, state === "gas" ? "favour.james" : "grace.okon");
      await fillSale(page, {
        gas: state === "gas",
        value:
          state === "gas"
            ? "15000.00"
            : state === "held"
              ? "10000.00"
              : "20000.00",
      });
      fake.setOffline(true);
      await context.setOffline(true);
      await save(page);
      fake.setOffline(false);
      await context.setOffline(false);
      if (state === "pending") {
        await page.goto("/attendant/uploads");
        await expect(
          page.getByText("Photo upload failed", { exact: true }),
        ).toBeVisible();
        await capture(page, "A08-PendingUploads", width);
      } else {
        await expect(
          page.getByRole("heading", {
            name: state === "held" ? "Awaiting price review" : "Sale synced",
            exact: true,
          }),
        ).toBeVisible({ timeout: 20000 });
        await capture(
          page,
          state === "held"
            ? "A14-PriceReview"
            : state === "gas"
              ? "A16-GasSynced"
              : "A04-SaleSynced",
          width,
        );
        if (state === "credited") {
          await page.goto("/attendant/uploads");
          await expect(
            page.getByRole("heading", {
              name: "All uploads complete",
              exact: true,
            }),
          ).toBeVisible();
          await capture(page, "A23-PendingUploadsEmpty", width);
        }
      }
    });
  }
}

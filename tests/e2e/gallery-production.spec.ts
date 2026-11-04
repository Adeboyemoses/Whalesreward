import { expect, test } from "@playwright/test";

test("development gallery is unavailable in the production app", async ({
  page,
}) => {
  const response = await page.goto("/dev/gallery");
  expect(response?.status()).toBe(404);
  await expect(page.locator("[data-component]")).toHaveCount(0);
});

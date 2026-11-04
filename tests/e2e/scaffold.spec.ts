import { expect, test } from "@playwright/test";

test("the production scaffold serves its generic shell", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "Whales Rewards" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Whales Rewards");
});

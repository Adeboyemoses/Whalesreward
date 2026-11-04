import { expect, test } from "@playwright/test";

test("development gallery is unavailable in the production app", async ({
  page,
}) => {
  test.skip(
    process.env.WHR_ENV === "staging" &&
      process.env.WHR_ENABLE_DEV_GALLERY === "true",
    "gallery explicitly enabled for staging",
  );
  const response = await page.goto("/dev/gallery");
  expect(response?.status()).toBe(404);
  await expect(page.locator("[data-component]")).toHaveCount(0);
});

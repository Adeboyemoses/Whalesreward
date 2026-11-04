import { expect, test } from "@playwright/test";

const staging = process.env.WHR_ENV === "staging";
const gallery = staging && process.env.WHR_ENABLE_DEV_GALLERY === "true";

test.describe("staging response headers", () => {
  test.skip(!staging, "staging environment only");
  test("marks pages, health, assets and errors as noindex", async ({
    request,
  }) => {
    for (const path of [
      "/",
      "/api/health",
      "/dev/gallery",
      "/design-system/mark.svg",
      "/not-a-real-page",
    ]) {
      const response = await request.get(path);
      expect(response.headers()["x-robots-tag"]).toBe("noindex");
    }
  });
});

test.describe("staging gallery", () => {
  test.skip(!gallery, "enabled staging gallery only");
  test("displays its fictional-data banner and enabled gallery", async ({
    page,
  }) => {
    await page.goto("/dev/gallery");
    await expect(page.getByRole("status")).toHaveText(
      "Staging · fictional data",
    );
    expect(await page.locator("[data-component]").count()).toBeGreaterThan(0);
  });
});

test.describe("production isolation", () => {
  test.skip(staging, "non-staging environment only");
  test("has no staging banner or publicly enabled gallery", async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Staging · fictional data")).toHaveCount(0);
    expect((await request.get("/dev/gallery")).status()).toBe(404);
    expect((await request.get("/")).headers()["x-robots-tag"]).toBeUndefined();
  });
});

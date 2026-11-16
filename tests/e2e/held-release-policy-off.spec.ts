import { test, expect } from "@playwright/test";
import { reviewFixture, heldSale } from "../reviews/helpers";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("WHR-171 R0 R15 R17 unconfigured v2 leaves ordinary review available and cannot enable proposals", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const f = await reviewFixture(page, browser);
  try {
    const sale = await heldSale(f, ["date"]);
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      `**/api/admin/sales/${sale.id}/release-preparation?kind=date`,
      async (route) => {
        await wait;
        const response = await route.fetch();
        expect(response.status()).toBe(409);
        expect((await response.json()).error.code).toBe(
          "release_policy_unconfigured",
        );
        await route.fulfill({ response });
      },
    );
    await page.goto(`/admin/sales/${sale.id}/date-review`);
    await expect(
      page.getByText("Loading release details…", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Propose a release with a sheet photo",
        exact: true,
      }),
    ).not.toBeEnabled();
    release();
    await expect(
      page
        .getByText(/Two-person release isn't switched on for this station\./)
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Propose a release with a sheet photo",
        exact: true,
      }),
    ).not.toBeEnabled();
    await expect(
      page.getByLabel("Decision reason", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No release proposals recorded.", { exact: true }),
    ).toBeVisible();
    expect(await page.locator('input[type="file"]').count()).toBe(0);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});

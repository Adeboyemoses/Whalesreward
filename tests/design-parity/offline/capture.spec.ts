import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { installAttendantFake } from "../../fixtures/attendant-http-fake";
import { fillSale, save, signIn } from "../../fixtures/offline-browser";

async function capture(page: Page, id: string, width: number) {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: path.join(
      import.meta.dirname,
      "screenshots",
      `${id}-${width}.built.png`,
    ),
    fullPage: true,
    animations: "disabled",
  });
}

for (const width of [390, 360]) {
  test(`offline capture boards at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 844 });
    const now = new Date("2026-11-04T09:42:00.000Z").getTime();
    await page.clock.install({ time: now });
    const fake = await installAttendantFake(context, { now });
    await page.goto("/attendant/sign-in");
    await capture(page, "A01-SignIn", width);
    await page.getByLabel("Username", { exact: true }).fill("grace.okon");
    await page
      .getByLabel("Password", { exact: true })
      .fill("wrong-test-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByText("The username or password is not correct.", {
        exact: true,
      }),
    ).toBeVisible();
    fake.setOffline(true);
    await context.setOffline(true);
    await capture(page, "A26-SignInError", width);
    fake.setOffline(false);
    await context.setOffline(false);
    await signIn(page);
    await capture(page, "A02-Sale", width);
    fake.setLookupFailure("missing");
    await page
      .getByLabel("Or enter the card number", { exact: true })
      .fill("A7K3M9X");
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await expect(
      page.getByText(/No customer has (?:this )?card/),
    ).toBeVisible();
    await capture(page, "A24-SaleCustomerNotFound", width);
    fake.setLookupFailure("none");
    await fillSale(page, { value: "20000.00" });
    await capture(page, "A03-SaleFilled", width);
    await save(page);
    await capture(page, "A05-SaleSavedOnPhone", width);
    await page
      .getByRole("button", { name: "Record next sale", exact: true })
      .click();
    fake.setOffline(true);
    await context.setOffline(true);
    await fillSale(page, { value: "20000.00" });
    await capture(page, "A27-SaleOffline", width);
    await save(page);
    fake.setOffline(false);
    await context.setOffline(false);
    await page.goto("/attendant/account");
    await capture(page, "A12-Account", width);
    await page.goto("/attendant/account/hand-over");
    await capture(page, "A13-Handover", width);
    await page
      .getByRole("button", { name: "Sign out with pending sales", exact: true })
      .click();
    await signIn(page, "favour.james");
    await fillSale(page, { gas: true, value: "15000.00" });
    await capture(page, "A15-GasSale", width);
    fake.setOffline(true);
    await context.setOffline(true);
    await page.clock.fastForward(86_400_000);
    await expect(
      page.getByRole("heading", {
        name: "Offline access expired",
        exact: true,
      }),
    ).toBeVisible();
    await capture(page, "A18-OfflineExpired", width);
  });
}

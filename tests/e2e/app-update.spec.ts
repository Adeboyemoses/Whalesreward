import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { v7 } from "uuid";
import {
  installAttendantFake,
  sessionFixture,
} from "../fixtures/attendant-http-fake";
import {
  signIn,
  waitForWorker,
  fillSale,
  save,
  rows,
} from "../fixtures/offline-browser";

test.use({
  permissions: ["camera"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

async function nextWorker(page: import("@playwright/test").Page, tag: string) {
  await page.evaluate(async (tag) => {
    await navigator.serviceWorker.register(
      `/attendant/sw.js?update-regression=${tag}`,
      { scope: "/attendant/", updateViaCache: "none" },
    );
  }, tag);
}

test("safe worker handover waits for capture to end before replacing the controller", async ({
  page,
  context,
}) => {
  await installAttendantFake(context);
  await signIn(page);
  await waitForWorker(page);
  await page
    .getByLabel("Or enter the card number", { exact: true })
    .fill("A7K3M9Q");
  await page.evaluate(() => {
    (window as unknown as { oldDocument: boolean }).oldDocument = true;
  });
  const oldScript = await page.evaluate(
    () => navigator.serviceWorker.controller!.scriptURL,
  );
  await nextWorker(page, "capture");
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await navigator.serviceWorker.getRegistration("/attendant/"))
            ?.waiting?.state,
      ),
    )
    .toBe("installed");
  // A complete retry interval proves the waiting worker cannot interrupt a draft.
  await page.waitForTimeout(5500);
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller!.scriptURL),
  ).toBe(oldScript);
  await expect(
    page.getByLabel("Or enter the card number", { exact: true }),
  ).toHaveValue("A7K3M9Q");
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { oldDocument?: boolean }).oldDocument,
        ),
      { timeout: 15000 },
    )
    .toBeUndefined();
  await expect(
    page.getByRole("heading", { name: "Your account", exact: true }),
  ).toBeVisible();
});

test("API build stamp matches the compiled Next release ID", async ({
  request,
}) => {
  const response = await request.get("/api/attendant/session");
  expect(response.headers()["x-whr-build"]).toBe(
    (await readFile(".next/BUILD_ID", "utf8")).trim(),
  );
});

test("waiting worker preserves queued sale and JPEG instead of reloading", async ({
  page,
  context,
}) => {
  await installAttendantFake(context);
  await signIn(page);
  await waitForWorker(page);
  await fillSale(page);
  await save(page);
  const before = await rows(page);
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page.evaluate(() => {
    (window as unknown as { queuedDocument: boolean }).queuedDocument = true;
  });
  await nextWorker(page, "queued");
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await navigator.serviceWorker.getRegistration("/attendant/"))
            ?.waiting?.state,
      ),
    )
    .toBe("installed");
  await page.waitForTimeout(5500);
  expect(
    await page.evaluate(
      () => (window as unknown as { queuedDocument: boolean }).queuedDocument,
    ),
  ).toBe(true);
  expect(await rows(page)).toEqual(before);
});

test("upgraded worker reads newer first-password sign-in and session responses", async ({
  page,
  context,
}) => {
  await installAttendantFake(context);
  await page.goto("/attendant/sign-in");
  await waitForWorker(page);
  await page.evaluate(() => {
    (window as unknown as { oldDocument: boolean }).oldDocument = true;
  });
  await nextWorker(page, "first-password");
  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { oldDocument?: boolean }).oldDocument,
        ),
      { timeout: 15000 },
    )
    .toBeUndefined();
  const session = sessionFixture();
  const restricted = {
    state: "password_change_required",
    account: session.account,
    serverTime: session.serverTime,
    sessionExpiresAt: new Date(Date.now() + 900000).toISOString(),
  };
  for (const path of ["sign-in", "session"])
    await context.route(`**/api/attendant/${path}`, async (route) =>
      route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "x-whr-build": "newer-first-password-server",
        },
        body: JSON.stringify({
          data: restricted,
          serverTime: session.serverTime,
          requestId: v7(),
        }),
      }),
    );
  await page.getByLabel("Username", { exact: true }).fill("grace.okon");
  await page
    .getByLabel("Password", { exact: true })
    .fill("fictional-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Change your first password",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Change your first password",
      exact: true,
    }),
  ).toBeVisible();
});

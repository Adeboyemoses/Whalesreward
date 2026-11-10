import { readFile } from "node:fs/promises";
import { expect, test, type Route } from "@playwright/test";
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

async function oldDocumentGone(page: import("@playwright/test").Page) {
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(
            () =>
              (window as unknown as { oldDocument?: boolean }).oldDocument ===
              undefined,
          );
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("Execution context was destroyed")
          )
            return false;
          throw error;
        }
      },
      { timeout: 15000 },
    )
    .toBe(true);
}

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
  await expect(
    page.getByLabel("Or enter the card number", { exact: true }),
  ).toHaveValue("A7K3M9Q");
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
  await oldDocumentGone(page);
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
  const after = await rows(page);
  const originals = (records: Awaited<ReturnType<typeof rows>>) =>
    records.map((row) => ({
      originatingAccountId: row.originatingAccountId,
      operationId: row.operationId,
      original: row.original,
      photoBlob: row.photoBlob,
      photoDigest: row.photoDigest,
      captureDisplay: row.captureDisplay,
      localSavedAt: row.localSavedAt,
    }));
  // Foreground retries legitimately update attempts/backoff/leases while waiting.
  // Every saved original, seller, ID and photo must remain exactly unchanged.
  expect(originals(after)).toEqual(originals(before));
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({
    state: "saved",
    serverStatus: null,
    purchaseId: null,
  });
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
  await oldDocumentGone(page);
  // The replacement provider registers the canonical worker again. Wait for
  // that guarded handover before filling an ephemeral controlled form.
  const deadline = performance.now() + 5000;
  const remaining = () => {
    const milliseconds = Math.ceil(deadline - performance.now());
    if (milliseconds <= 0)
      throw new Error(
        "Worker handover and sign-in readiness exceeded five seconds",
      );
    return milliseconds;
  };
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(async () => {
            const registration =
              await navigator.serviceWorker.getRegistration("/attendant/");
            const controller = navigator.serviceWorker.controller;
            if (!controller) return false;
            const url = new URL(controller.scriptURL);
            return (
              url.pathname === "/attendant/sw.js" &&
              !url.search &&
              !registration?.installing &&
              !registration?.waiting &&
              !document.documentElement.inert
            );
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("Execution context was destroyed")
          )
            return false;
          throw error;
        }
      },
      { timeout: remaining() },
    )
    .toBe(true);
  const session = sessionFixture();
  const restricted = {
    state: "password_change_required",
    account: session.account,
    serverTime: session.serverTime,
    sessionExpiresAt: new Date(Date.now() + 900000).toISOString(),
  };
  const restrictedResponse = (route: Route) =>
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
    });
  let signInRequests = 0;
  await context.route("**/api/attendant/sign-in", (route) => {
    expect(route.request().method()).toBe("POST");
    signInRequests++;
    return restrictedResponse(route);
  });
  await page
    .getByLabel("Username", { exact: true })
    .fill("grace.okon", { timeout: remaining() });
  await page
    .getByLabel("Password", { exact: true })
    .fill("fictional-test-password", { timeout: remaining() });
  const signInButton = page.getByRole("button", {
    name: "Sign in",
    exact: true,
  });
  await expect(signInButton).toBeEnabled({ timeout: remaining() });
  await signInButton.click({ timeout: remaining() });
  await expect(
    page.getByRole("heading", {
      name: "Change your first password",
      exact: true,
    }),
  ).toBeVisible();
  expect(signInRequests).toBe(1);
  // Initial background refresh must remain signed out. Only the explicit
  // reload after the sign-in response replays this restricted session.
  await context.route("**/api/attendant/session", restrictedResponse);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Change your first password",
      exact: true,
    }),
  ).toBeVisible();
});

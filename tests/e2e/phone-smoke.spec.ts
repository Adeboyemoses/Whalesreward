import { createServer, request as httpRequest } from "node:http";
import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { ids, installAttendantFake } from "../fixtures/attendant-http-fake";
import {
  fillSale,
  rows,
  save,
  signIn,
  waitForWorker,
} from "../fixtures/offline-browser";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const form = (page: Page) =>
  page.getByLabel("Amount in naira", { exact: true });
const receipt = (page: Page) =>
  page.getByRole("heading", {
    name: /^(Saved on phone|Upload pending|Sale synced)$/,
  });
const expired = (page: Page) =>
  page.getByRole("heading", { name: "Offline access expired", exact: true });

test.use({
  permissions: ["camera"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

async function holdSession(
  context: BrowserContext,
  response: unknown,
  status = 200,
  reloadingPage?: Page,
) {
  let armed = !reloadingPage;
  reloadingPage?.once("framenavigated", (frame) => {
    if (frame === reloadingPage.mainFrame()) armed = true;
  });
  const entered = deferred(),
    release = deferred(),
    completed = deferred();
  let claimed = false;
  await context.route("**/api/attendant/session", async (route) => {
    if (claimed || !armed) return route.fallback();
    claimed = true;
    entered.resolve();
    await release.promise;
    try {
      await route.fulfill({
        status,
        contentType: "application/json",
        json:
          status === 200
            ? {
                data: response,
                serverTime: new Date().toISOString(),
                requestId: ids.request,
              }
            : {
                error: {
                  code: "unauthenticated",
                  message: "Sign in again",
                  retryable: false,
                },
                serverTime: new Date().toISOString(),
                requestId: ids.request,
              },
      });
    } finally {
      completed.resolve();
    }
  });
  return { entered, release, completed };
}

test("I-03 I-09 valid local capture renders before slow revalidation and a delayed revocation still locks", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context);
  await signIn(page);
  await expect(form(page)).toBeVisible();
  await waitForWorker(page);
  const held = await holdSession(context, null, 401, page);
  try {
    await page.reload();
    await held.entered.promise;
    await expect(form(page)).toBeVisible({ timeout: 2000 });
    held.release.resolve();
    await held.completed.promise;
    await expect(expired(page)).toBeVisible({ timeout: 2000 });
    expect(fake.activeSession()).not.toBeNull();
    await page.reload();
    await expect(expired(page)).toBeVisible();
  } finally {
    held.release.resolve();
  }
});

test("I-03 an expired local window locks while successful session revalidation is still pending", async ({
  page,
  context,
}) => {
  const now = Date.parse("2026-11-05T10:00:00.000Z");
  await page.clock.install({ time: now });
  const fake = await installAttendantFake(context, {
    now,
    signInAgeMs: 86_340_000,
  });
  await signIn(page);
  await expect(form(page)).toBeVisible();
  const old = structuredClone(fake.activeSession());
  const held = await holdSession(context, old, 200, page);
  try {
    await page.clock.fastForward(60_000);
    await expect(expired(page)).toBeVisible();
    await page.reload();
    await held.entered.promise;
    await expect(expired(page)).toBeVisible({ timeout: 2000 });
    held.release.resolve();
    await held.completed.promise;
    await expect(expired(page)).toBeVisible();
    await expect(form(page)).toHaveCount(0);
  } finally {
    held.release.resolve();
  }
});

test("I-06 a delayed successful old-account revalidation cannot restore that account after handover", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context);
  await signIn(page);
  await expect(form(page)).toBeVisible();
  const held = await holdSession(
    context,
    structuredClone(fake.activeSession()),
    200,
    page,
  );
  try {
    await page.reload();
    await held.entered.promise;
    await expect(form(page)).toBeVisible({ timeout: 2000 });
    const other = await context.newPage();
    await other.goto("/attendant/account/hand-over");
    await other.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(other).toHaveURL(/\/sign-in$/);
    await signIn(other, "favour.james");
    await expect(
      other.getByText("Favour James", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Grace Okon", { exact: true })).toHaveCount(0);
    held.release.resolve();
    await held.completed.promise;
    await page.goto("/attendant/sale");
    await expect(page.getByText("Favour James", { exact: true })).toBeVisible();
    await expect(page.getByText("Grace Okon", { exact: true })).toHaveCount(0);
    await expect(form(page)).toBeVisible();
  } finally {
    held.release.resolve();
  }
});

for (const mode of ["3G", "offline"] as const) {
  test(`I-23 Save and Record next sale finish within two seconds on ${mode} without waiting for uploads`, async ({
    page,
    context,
  }) => {
    const fake = await installAttendantFake(context, { sync: true });
    fake.sync.setPutPaused(true);
    await signIn(page);
    await waitForWorker(page);
    await fillSale(page);
    if (mode === "offline") {
      fake.setOffline(true);
      await context.setOffline(true);
    } else {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 400,
        downloadThroughput: 50_000,
        uploadThroughput: 50_000,
        connectionType: "cellular3g",
      });
    }
    try {
      const start = performance.now();
      await page
        .getByRole("button", { name: /^Save sale(?: on phone)?$/ })
        .click({ noWaitAfter: true });
      await expect(receipt(page)).toBeVisible({ timeout: 2000 });
      expect(performance.now() - start).toBeLessThanOrEqual(2000);
      const original = (await rows(page))[0]!;
      expect(original.photoBlob.size).toBeGreaterThan(0);
      const next = performance.now();
      await page
        .getByRole("button", { name: "Record next sale", exact: true })
        .click({ noWaitAfter: true });
      await expect(form(page)).toBeVisible({ timeout: 2000 });
      await expect(form(page)).toHaveValue("");
      expect(performance.now() - next).toBeLessThanOrEqual(2000);
      expect((await rows(page))[0]!.original).toEqual(original.original);
      expect((await rows(page))[0]!.photoBlob).toEqual(original.photoBlob);
    } finally {
      fake.sync.setPutPaused(false);
    }
  });
}

test("I-23 resolved capture saves and resets within two seconds even when every later lookup stalls", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context, { sync: true });
  fake.sync.setPutPaused(true);
  const release = deferred();
  await signIn(page);
  await waitForWorker(page);
  await fillSale(page, { value: "20000.01" });
  await expect(page.getByText("Amina Bello", { exact: true })).toBeVisible();
  const session = structuredClone(fake.activeSession())!;
  await context.route("**/api/attendant/cards/lookup", async (route) => {
    await release.promise;
    await route.fallback();
  });
  try {
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    const started = performance.now();
    await page
      .getByRole("button", { name: /^Save sale(?: on phone)?$/ })
      .click({ noWaitAfter: true });
    // Do not await a lookup request: the fixed implementation need not send one.
    await expect(receipt(page)).toBeVisible({ timeout: 2000 });
    expect(performance.now() - started).toBeLessThanOrEqual(2000);
    const saved = await rows(page);
    expect(saved).toHaveLength(1);
    const original = saved[0]!;
    expect(original.originatingAccountId).toBe(session.account.id);
    expect(original.original).toMatchObject({
      cardCode: "A7K3M9Q",
      captureContextId: session.captureContextId,
      assignmentId: session.assignment.id,
      medium: "vehicle",
      entry: {
        basis: "amount",
        enteredAmountKobo: "2000001",
        amountKobo: "2000001",
      },
    });
    expect(original.customerCache?.customer.name).toBe("Amina Bello");
    expect(original.photoBlob.size).toBeGreaterThan(0);
    expect(original.photoBlob.digest).toBe(original.original.photo.sha256);
    await expect(
      page.getByRole("heading", { name: "Sale synced", exact: true }),
    ).toHaveCount(0);
    expect(
      [...fake.sync.records.values()].every(
        (record) => !record.status.credited && record.credits === 0,
      ),
    ).toBe(true);
    const next = performance.now();
    await page
      .getByRole("button", { name: "Record next sale", exact: true })
      .click({ noWaitAfter: true });
    await expect(form(page)).toBeVisible({ timeout: 2000 });
    await expect(form(page)).toHaveValue("");
    expect(performance.now() - next).toBeLessThanOrEqual(2000);
    const remaining = (await rows(page))[0]!;
    expect(remaining.original).toEqual(original.original);
    expect(remaining.photoBlob).toEqual(original.photoBlob);
  } finally {
    release.resolve();
    fake.sync.setPutPaused(false);
  }
});

test("I-23 capture navigation never waits for a stalled RSC request", async ({
  page,
  context,
}) => {
  await installAttendantFake(context);
  await signIn(page);
  await waitForWorker(page);
  await fillSale(page);
  const release = deferred();
  await context.route("**/attendant/**", async (route) => {
    if (
      route.request().headers().rsc === "1" ||
      new URL(route.request().url()).searchParams.has("_rsc")
    ) {
      await release.promise;
    }
    await route.fallback();
  });
  try {
    await page
      .getByRole("button", { name: /^Save sale(?: on phone)?$/ })
      .click({ noWaitAfter: true });
    await expect(receipt(page)).toBeVisible({ timeout: 2000 });
    await page
      .getByRole("button", { name: "Record next sale", exact: true })
      .click({ noWaitAfter: true });
    await expect(form(page)).toBeVisible({ timeout: 2000 });
    expect(await rows(page)).toHaveLength(1);
  } finally {
    release.resolve();
  }
});

for (const phase of ["headers", "body"] as const) {
  test(`I-49 navigation with stalled ${phase} falls back to the precached receipt shell within two seconds`, async ({
    page,
    context,
    baseURL,
  }) => {
    const entered = deferred(),
      release = deferred();
    let held = false;
    const upstream = new URL(baseURL!);
    const server = createServer(async (req, res) => {
      const shouldHold = !!(
        held &&
        /^\/attendant\/sale\/[^/]+\/recorded/.test(req.url ?? "") &&
        req.headers.accept?.includes("text/html")
      );
      if (shouldHold && phase === "headers") {
        entered.resolve();
        await release.promise;
      }
      if (res.destroyed) return;
      const target = httpRequest(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: upstream.host },
        },
        async (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          if (shouldHold && phase === "body") {
            response.pause();
            res.flushHeaders();
            entered.resolve();
            await release.promise;
          }
          response.pipe(res);
        },
      );
      target.on("error", () => {
        if (!res.destroyed) res.end();
      });
      req.pipe(target);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing local proxy address");
    const origin = `http://127.0.0.1:${address.port}`;
    const fake = await installAttendantFake(context);
    try {
      await page.goto(`${origin}/attendant/sign-in`);
      await page.getByLabel("Username", { exact: true }).fill("grace.okon");
      await page
        .getByLabel("Password", { exact: true })
        .fill("fictional-test-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(form(page)).toBeVisible();
      await waitForWorker(page);
      await fillSale(page);
      await save(page);
      const receiptUrl = page.url();
      expect(new URL(receiptUrl).origin).toBe(origin);
      await page
        .getByRole("button", { name: "Record next sale", exact: true })
        .click();
      await expect(form(page)).toBeVisible();
      held = true;
      const start = performance.now();
      const navigation = page.goto(receiptUrl, {
        waitUntil: "commit",
        timeout: 2000,
      });
      void navigation.catch(() => {});
      await entered.promise;
      await navigation;
      expect(performance.now() - start).toBeLessThanOrEqual(2000);
      await expect(receipt(page)).toBeVisible({ timeout: 2000 });
      expect(await rows(page)).toHaveLength(1);
      expect(
        fake.calls.some((call) => call.path === "/api/attendant/session"),
      ).toBe(true);
    } finally {
      release.resolve();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

test("connection pill responds to network events and failed requests without treating HTTP rejection as offline", async ({
  page,
  context,
}) => {
  await installAttendantFake(context);
  await signIn(page);
  await expect(form(page)).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText("Offline", { exact: true }).first()).toBeVisible({
    timeout: 2000,
  });
  await context.setOffline(false);
  await expect(page.getByText("Online", { exact: true }).first()).toBeVisible({
    timeout: 2000,
  });
  await context.route("**/api/attendant/session", (route) =>
    route.abort("failed"),
  );
  await page.reload();
  await expect(form(page)).toBeVisible({ timeout: 2000 });
  await expect(page.getByText("Offline", { exact: true }).first()).toBeVisible({
    timeout: 2000,
  });
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  await context.unroute("**/api/attendant/session");
  const denial = await holdSession(context, null, 401);
  denial.release.resolve();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await denial.completed.promise;
  await expect(expired(page)).toBeVisible({ timeout: 2000 });
  await expect(page.getByText("Online", { exact: true }).first()).toBeVisible({
    timeout: 2000,
  });
});

for (const gas of [false, true]) {
  test(`I-29 amount blur preserves exact spend and server references are shown for ${gas ? "gas" : "PMS"}`, async ({
    page,
    context,
  }) => {
    const fake = await installAttendantFake(context, { sync: true });
    fake.sync.setPutFailure(true);
    await signIn(page, gas ? "favour.james" : "grace.okon");
    await waitForWorker(page);
    await form(page).fill("20000");
    await form(page).blur();
    await expect(form(page)).toHaveValue("20,000.00");
    await form(page).focus();
    await expect(form(page)).toHaveValue("20000");
    await form(page).blur();
    await fillSale(page, { gas, value: "20000.01" });
    await expect(form(page)).toHaveValue("20,000.01");
    try {
      fake.setOffline(true);
      await context.setOffline(true);
      await save(page);
      await expect(
        page.getByText("Reference after upload", { exact: true }),
      ).toBeVisible();
      const original = (await rows(page))[0]!;
      expect(original.original.entry).toMatchObject({
        basis: "amount",
        enteredAmountKobo: "2000001",
        amountKobo: "2000001",
      });
      fake.setOffline(false);
      await context.setOffline(false);
      await expect.poll(() => [...fake.sync.records.values()].length).toBe(1);
      const code = [...fake.sync.records.values()][0]!.status.saleCode;
      await expect
        .poll(async () => {
          const row = (await rows(page))[0]!;
          return { error: row.lastErrorCode, lease: row.syncLease };
        })
        .toEqual({ error: "photo_upload_failed", lease: null });
      await page.goto("/attendant/uploads");
      await expect(page.getByText(new RegExp(code))).toBeVisible();
      fake.sync.setPutFailure(false);
      await page
        .getByRole("button", { name: "Retry uploads", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "All uploads complete",
          exact: true,
        }),
      ).toBeVisible({ timeout: 20_000 });
      await page.goto(`/attendant/sale/${original.operationId}/recorded`);
      await expect(
        page.getByRole("heading", { name: "Sale synced", exact: true }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(code, { exact: true })).toBeVisible();
    } finally {
      fake.sync.setPutFailure(false);
    }
  });
}

test("I-29 excess money precision is rejected without rounding and quantity entry stays unchanged", async ({
  page,
  context,
}) => {
  await installAttendantFake(context);
  await signIn(page);
  await form(page).fill("100.001");
  await form(page).blur();
  await expect(form(page)).toHaveValue("100.001");
  await expect(
    page.getByText(
      "Enter a positive amount with no more than two decimal places.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Litres", exact: true }).click();
  const quantity = page.getByLabel("Litres", { exact: true });
  await expect(quantity).toHaveValue("");
  await quantity.fill("20.125");
  await quantity.blur();
  await expect(quantity).toHaveValue("20.125");
  await page.getByRole("button", { name: "Amount (₦)", exact: true }).click();
  await expect(form(page)).toHaveValue("");
});

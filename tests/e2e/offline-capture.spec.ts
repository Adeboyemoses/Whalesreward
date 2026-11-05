import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";
import {
  signIn,
  fillSale,
  rows,
  save,
  waitForWorker,
} from "../fixtures/offline-browser";
import { ids, installAttendantFake } from "../fixtures/attendant-http-fake";

test.use({
  permissions: ["camera"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

test("I-23 offline save survives app restart with the same immutable original and JPEG", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context);
  await signIn(page);
  await waitForWorker(page);
  fake.setOffline(true);
  await context.setOffline(true);
  await fillSale(page, { code: "B7K3M9Q" });
  await save(page);
  const before = await rows(page);
  expect(before).toHaveLength(1);
  expect(before[0]).toMatchObject({
    originatingAccountId: ids.grace,
    state: "saved",
    customerCache: null,
    purchaseId: null,
    serverStatus: null,
    original: {
      cardCode: "B7K3M9Q",
      entry: {
        basis: "amount",
        enteredAmountKobo: "2000001",
        amountKobo: "2000001",
        quantity: "20",
      },
    },
  });
  const photo = before[0]!.photoBlob as {
    size: number;
    type: string;
    digest: string;
  };
  expect(photo.size).toBeGreaterThan(0);
  expect(photo.type).toBe("image/jpeg");
  expect(before[0]!.photoDigest).toBe(photo.digest);
  const receiptUrl = page.url();
  await page.close();
  const restarted = await context.newPage();
  await restarted.goto(receiptUrl);
  await expect(
    restarted.getByRole("heading", { name: "Saved on phone", exact: true }),
  ).toBeVisible();
  expect(await rows(restarted)).toEqual(before);
  expect(fake.calls.some((call) => call.path.startsWith("/api/sync/"))).toBe(
    false,
  );
});

test("I-06 handover hides the original account queue and restores it only after fresh same-account sign-in", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context);
  await signIn(page);
  await fillSale(page);
  await save(page);
  const original = await rows(page);
  const receiptUrl = page.url();
  await page.goto("/attendant/account/hand-over");
  await page
    .getByRole("button", { name: "Sign out with pending sales", exact: true })
    .click();
  await expect(page).toHaveURL(/\/attendant\/sign-in$/);
  await signIn(page, "favour.james");
  await page.goto("/attendant/account");
  await expect(page.getByText("Favour James", { exact: true })).toBeVisible();
  await expect(page.getByText("Grace Okon", { exact: true })).toHaveCount(0);
  await page.goto(receiptUrl);
  await expect(
    page.getByRole("heading", { name: "Saved on phone", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Amina Bello", { exact: true })).toHaveCount(0);
  await page.goto("/attendant/account/hand-over");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/attendant\/sign-in$/);
  await signIn(page);
  await page.goto(receiptUrl);
  await expect(
    page.getByRole("heading", { name: /^(Saved on phone|Upload pending)$/ }),
  ).toBeVisible();
  expect(
    (await rows(page)).map(({ original, photoBlob, originatingAccountId }) => ({
      original,
      photoBlob,
      originatingAccountId,
    })),
  ).toEqual(
    original.map(({ original, photoBlob, originatingAccountId }) => ({
      original,
      photoBlob,
      originatingAccountId,
    })),
  );
  expect(
    fake.calls.filter((call) => call.path === "/api/attendant/sign-out"),
  ).toHaveLength(2);
});

test("I-29 I-30 gas quantity capture preserves exact values and fixes Cylinder without changing customer category", async ({
  page,
  context,
}) => {
  await installAttendantFake(context);
  await signIn(page, "favour.james");
  await expect(page.getByLabel("Bought into", { exact: true })).toHaveValue(
    "Cylinder",
  );
  await expect(
    page.getByRole("button", { name: "Vehicle", exact: true }),
  ).toHaveCount(0);
  await fillSale(page, { gas: true, quantity: true, value: "10.01" });
  await save(page);
  expect(await rows(page)).toMatchObject([
    {
      original: {
        unit: "kilogram",
        medium: "cylinder",
        rateKobo: "150000",
        entry: {
          basis: "quantity",
          enteredQuantity: "10.01",
          quantity: "10.01",
          amountKobo: "1501500",
        },
      },
      customerCache: { customer: { category: "car_owner" } },
    },
  ]);
});

test("I-23 quota failure keeps the draft and photo without a partial saved sale", async ({
  page,
  context,
}) => {
  await installAttendantFake(context);
  await signIn(page);
  await fillSale(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (
      ...args: Parameters<IDBObjectStore["add"]>
    ) {
      if (this.name === "outbox")
        throw new DOMException(
          "Disposable test quota failure",
          "QuotaExceededError",
        );
      return original.apply(this, args);
    };
  });
  await page.getByRole("button", { name: "Save sale", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Saved on phone", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/storage|space|save failed|could not save/i).first(),
  ).toBeVisible();
  await expect(page.getByLabel("Amount in naira", { exact: true })).toHaveValue(
    "20,000.01",
  );
  await expect(
    page.getByRole("button", { name: "Retake", exact: true }),
  ).toBeVisible();
  expect(await rows(page)).toEqual([]);
});

test("I-03 the 24-hour boundary blocks an in-progress capture and reconnect does not renew access", async ({
  page,
  context,
}) => {
  const now = new Date("2026-11-04T10:00:00.000Z").getTime();
  await page.clock.install({ time: now });
  const fake = await installAttendantFake(context, {
    now,
    signInAgeMs: 86_340_000,
  });
  await signIn(page);
  await waitForWorker(page);
  fake.setOffline(true);
  await context.setOffline(true);
  await page.clock.fastForward(60_000);
  await expect(
    page.getByRole("heading", { name: "Offline access expired", exact: true }),
  ).toBeVisible();
  fake.setOffline(false);
  await context.setOffline(false);
  await expect(
    page.getByRole("heading", { name: "Offline access expired", exact: true }),
  ).toBeVisible();
  expect(await rows(page)).toEqual([]);
});

test("I-03 rolling the wall clock backwards locks capture without discarding the saved queue", async ({
  page,
  context,
}) => {
  const now = new Date("2026-11-04T10:00:00.000Z").getTime();
  await page.clock.install({ time: now });
  const fake = await installAttendantFake(context, { now });
  await signIn(page);
  await fillSale(page);
  await save(page);
  const original = await rows(page);
  await waitForWorker(page);
  fake.setOffline(true);
  await context.setOffline(true);
  await page.clock.setSystemTime(now - 60_000);
  await page.clock.runFor(1000);
  await expect(
    page.getByRole("heading", { name: "Offline access expired", exact: true }),
  ).toBeVisible();
  expect(
    (await rows(page)).map(({ original, photoBlob, originatingAccountId }) => ({
      original,
      photoBlob,
      originatingAccountId,
    })),
  ).toEqual(
    original.map(({ original, photoBlob, originatingAccountId }) => ({
      original,
      photoBlob,
      originatingAccountId,
    })),
  );
});

test("I-49 service-worker cache contains generic assets only and never customer or auth responses", async ({
  page,
  context,
}) => {
  await installAttendantFake(context);
  await signIn(page);
  await waitForWorker(page);
  await fillSale(page);
  await save(page);
  const entries = await page.evaluate(async () => {
    const result: Array<{ url: string; text: string }> = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const key of await cache.keys()) {
        const response = await cache.match(key);
        const type = response?.headers.get("content-type") ?? "";
        result.push({
          url: key.url,
          text: /html|json/.test(type) ? await response!.text() : "",
        });
      }
    }
    return result;
  });
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    expect(entry.url).not.toMatch(/\/api\/|\/admin\/|blob:/);
    expect(entry.text).not.toMatch(
      /Grace Okon|Amina Bello|fictional-test-password|A7K3M9Q/,
    );
  }
  const scopes = await page.evaluate(async () =>
    (await navigator.serviceWorker.getRegistrations()).map(
      (registration) => new URL(registration.scope).pathname,
    ),
  );
  expect(scopes).toEqual(["/attendant/"]);
});

test("I-17 QR and typed code resolve the same customer without following URLs", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context);
  await page.addInitScript(() => {
    Object.defineProperty(window, "BarcodeDetector", {
      configurable: true,
      value: class {
        async detect() {
          return [{ rawValue: "A7K3M9Q" }];
        }
      },
    });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Scan QR card", exact: true }).click();
  await page.getByRole("button", { name: "Read QR card", exact: true }).click();
  await expect(page.getByText("Amina Bello", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page
    .getByLabel("Or enter the card number", { exact: true })
    .fill(" a7k3m9q ");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByText("Amina Bello", { exact: true })).toBeVisible();
  expect(
    fake.calls
      .filter((call) => call.path.endsWith("/lookup"))
      .map((call) => call.source),
  ).toEqual(["qr", "code"]);
});

test("I-24 denied camera keeps the form and cannot claim a saved photo or sale", async ({
  page,
  context,
}) => {
  await installAttendantFake(context);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException(
        "Test camera permission denied",
        "NotAllowedError",
      );
    };
  });
  await signIn(page);
  await page.getByLabel("Amount in naira", { exact: true }).fill("20000.01");
  await page.getByRole("button", { name: /^Take meter photo/ }).click();
  await expect(
    page
      .getByText(
        /camera.*permission|allow.*camera|camera.*blocked|camera.*denied/i,
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel("Amount in naira", { exact: true })).toHaveValue(
    "20,000.01",
  );
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  expect(await rows(page)).toEqual([]);
});

test("I-27 lookup service failure is not customer-not-found and never enables online save", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context);
  await signIn(page);
  fake.setLookupFailure("missing");
  await page
    .getByLabel("Or enter the card number", { exact: true })
    .fill("A7K3M9Q");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByText(/No customer has (?:this )?card/)).toBeVisible();
  fake.setLookupFailure("unavailable");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByText(/No customer has (?:this )?card/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Save sale", exact: true }),
  ).toBeDisabled();
  expect(await rows(page)).toEqual([]);
});

test("I-06 another tab cannot retain the old account view after handover", async ({
  page,
  context,
}) => {
  await installAttendantFake(context);
  await signIn(page);
  await fillSale(page);
  const other = await context.newPage();
  await other.goto("/attendant/account/hand-over");
  await other.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(other).toHaveURL(/\/attendant\/sign-in$/);
  await signIn(other, "favour.james");
  await expect(page.getByText("Grace Okon", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Amina Bello", { exact: true })).toHaveCount(0);
  expect(await rows(other)).toEqual([]);
});

test("I-23 a full browser restart retains offline receipt and photo without network", async ({
  baseURL,
}) => {
  const profile = await mkdtemp(path.join(tmpdir(), "whales-offline-test-"));
  const options = {
    baseURL,
    headless: true,
    viewport: { width: 390, height: 844 },
    permissions: ["camera"],
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  };
  let persistent = await chromium.launchPersistentContext(profile, options);
  try {
    const fake = await installAttendantFake(persistent);
    const page = await persistent.newPage();
    await signIn(page);
    await waitForWorker(page);
    fake.setOffline(true);
    await persistent.setOffline(true);
    await fillSale(page, { code: "B7K3M9Q" });
    await save(page);
    const original = await rows(page);
    const url = page.url();
    await persistent.close();
    persistent = await chromium.launchPersistentContext(profile, options);
    await persistent.setOffline(true);
    const reopened = await persistent.newPage();
    await reopened.goto(url);
    await expect(
      reopened.getByRole("heading", { name: "Saved on phone", exact: true }),
    ).toBeVisible();
    expect(await rows(reopened)).toEqual(original);
  } finally {
    await persistent.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("I-09 online app reload revalidates the session and revocation locks capture without losing the queue", async ({
  page,
  context,
}) => {
  const fake = await installAttendantFake(context);
  await signIn(page);
  await fillSale(page);
  await save(page);
  const saved = await rows(page);
  const anchor = fake.activeSession()!.lastOnlineSignInAt;
  const reads = fake.calls.filter(
    (call) => call.path === "/api/attendant/session",
  ).length;
  await page.reload();
  await expect
    .poll(
      () =>
        fake.calls.filter((call) => call.path === "/api/attendant/session")
          .length,
    )
    .toBeGreaterThan(reads);
  expect(fake.activeSession()!.lastOnlineSignInAt).toBe(anchor);
  fake.revoke();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Offline access expired", exact: true }),
  ).toBeVisible();
  expect(
    (await rows(page)).map(({ original, photoBlob, originatingAccountId }) => ({
      original,
      photoBlob,
      originatingAccountId,
    })),
  ).toEqual(
    saved.map(({ original, photoBlob, originatingAccountId }) => ({
      original,
      photoBlob,
      originatingAccountId,
    })),
  );
});

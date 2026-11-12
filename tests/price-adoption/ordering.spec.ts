import { expect, test } from "@playwright/test";
import { priceFixture, lookup, value, photo, stored } from "./helpers";
import { rows, save } from "../fixtures/offline-browser";
import { fillRegistration } from "../customers-cards/helpers";
import type { OfflineWindow } from "../../src/client/types";

const current = async (page: import("@playwright/test").Page) =>
  (await stored(page)).windows[0] as unknown as OfflineWindow;

test("P-27 PR-T1-04/06 delayed older session cannot roll back a newer lookup across tabs", async ({
  page,
  browser,
}) => {
  const f = await priceFixture(page, browser);
  let release = () => {};
  try {
    await f.activate("120000", 4);
    const other = await f.context.newPage();
    let got = () => {};
    const received = new Promise<void>((r) => (got = r)),
      gate = new Promise<void>((r) => (release = r));
    await other.route(
      "**/api/attendant/session",
      async (route) => {
        const response = await route.fetch();
        got();
        await gate;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    await other.goto("/attendant/sale");
    await received;
    await f.activate("130000", 5);
    await lookup(f.phone, f.codes[0]!);
    const latest = (await current(f.phone)).session.price;
    release();
    await expect(
      other.getByRole("heading", { name: "Record sale", exact: true }),
    ).toBeVisible();
    await lookup(other, f.codes[0]!);
    await value(other, "13000");
    await other.getByRole("button", { name: "Vehicle", exact: true }).click();
    await photo(other);
    await f.context.setOffline(true);
    await save(other);
    expect((await rows(other))[0]!.original).toMatchObject({
      rateKobo: "130000",
      priceVersionId: latest.priceVersionId,
      quantityPrecision: 5,
      entry: { amountKobo: "1300000", quantity: "10" },
    });
    expect((await current(f.phone)).session.price).toMatchObject(latest);
  } finally {
    release();
    await f.close();
  }
});

test("P-27 PR-T1-06 registration handoff uses the ordinary current lookup before composition", async ({
  page,
  browser,
}) => {
  const f = await priceFixture(page, browser);
  try {
    await f.phone.goto("/attendant/register");
    await fillRegistration(f.phone, f.codes[1]!);
    await f.phone
      .getByRole("button", { name: "Register and link card", exact: true })
      .click();
    await expect(
      f.phone.getByRole("button", {
        name: "Record a sale for Amina",
        exact: true,
      }),
    ).toBeVisible();
    await f.activate("125000", 4);
    await f.phone
      .getByRole("button", { name: "Record a sale for Amina", exact: true })
      .click();
    await expect(f.phone).toHaveURL(/\/attendant\/sale$/);
    await expect(
      f.phone.getByText("Amina Bello", { exact: true }),
    ).toBeVisible();
    await value(f.phone, "12500");
    await f.phone.getByRole("button", { name: "Vehicle", exact: true }).click();
    await photo(f.phone);
    await f.context.setOffline(true);
    await save(f.phone);
    expect((await rows(f.phone))[0]!.original).toMatchObject({
      cardCode: f.codes[1],
      rateKobo: "125000",
      quantityPrecision: 4,
      entry: { amountKobo: "1250000", quantity: "10" },
    });
  } finally {
    await f.close();
  }
});

test("P-27 PR-T1-07/10 save racing a refresh keeps its captured payload and later receipt cannot backfill it", async ({
  page,
  browser,
}) => {
  const f = await priceFixture(page, browser);
  let release = () => {};
  try {
    await f.context.route("**/api/sync/**", (route) => route.abort("failed"));
    await lookup(f.phone, f.codes[0]!);
    await value(f.phone, "10000");
    await f.phone.getByRole("button", { name: "Vehicle", exact: true }).click();
    await photo(f.phone);
    const other = await f.context.newPage();
    await other.goto("/attendant/sale");
    await f.activate("140000", 4);
    let got = () => {};
    const arrived = new Promise<void>((r) => (got = r)),
      gate = new Promise<void>((r) => (release = r));
    await other.route(
      "**/api/attendant/cards/lookup",
      async (route) => {
        const response = await route.fetch();
        got();
        await gate;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    await other
      .getByLabel("Or enter the card number", { exact: true })
      .fill(f.codes[0]!);
    await other.getByRole("button", { name: "Find", exact: true }).click();
    await arrived;
    const saving = save(f.phone);
    release();
    await saving;
    const before = (await rows(f.phone))[0]!;
    expect(before.original).toMatchObject({
      rateKobo: "100000",
      quantityPrecision: 3,
      entry: { amountKobo: "1000000", quantity: "10" },
    });
    await expect
      .poll(async () => (await current(other)).session.price.rateKobo)
      .toBe("140000");
    const after = (await rows(f.phone))[0]!;
    expect({ original: after.original, photo: after.photoBlob }).toEqual({
      original: before.original,
      photo: before.photoBlob,
    });
    expect(JSON.stringify(after.original)).not.toMatch(
      /priceRefresh|fetchedAt|effectiveFrom/,
    );
  } finally {
    release();
    await f.close();
  }
});

test("P-27 PR-T1-09/12 idle and reconnect add no price fetches and preserve expiry and API cache exclusions", async ({
  page,
  browser,
}) => {
  const f = await priceFixture(page, browser);
  try {
    await lookup(f.phone, f.codes[0]!);
    const before = await current(f.phone),
      requests: string[] = [];
    f.context.on("request", (r) => {
      const p = new URL(r.url()).pathname;
      if (p.startsWith("/api/attendant")) requests.push(p);
    });
    await f.phone.clock.install();
    await f.phone.clock.runFor(5000);
    await f.context.setOffline(true);
    await f.phone.clock.runFor(2000);
    await f.context.setOffline(false);
    await f.phone.clock.runFor(2000);
    expect(requests).toEqual([]);
    const after = await current(f.phone);
    expect(after.offlineExpiresAt).toBe(before.offlineExpiresAt);
    expect(after.lastOnlineSignInAt).toBe(before.lastOnlineSignInAt);
    const cached = await f.phone.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys())
        for (const r of await (await caches.open(name)).keys())
          urls.push(r.url);
      return urls;
    });
    expect(
      cached.filter((url) => new URL(url).pathname.startsWith("/api/")),
    ).toEqual([]);
    expect(JSON.stringify((await stored(f.phone)).customers)).not.toMatch(
      /priceRefresh|priceVersionId|rateKobo/,
    );
  } finally {
    await f.close();
  }
});

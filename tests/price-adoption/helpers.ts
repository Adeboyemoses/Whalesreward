import { expect, type Browser, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { v7 } from "uuid";
import { stationFixture, api, attendantSignIn } from "../station/helpers";
import { data } from "../sales-history/helpers";
import { phoneNumber } from "../customers-cards/helpers";
import { installLocalStorageBridge } from "../fixtures/local-storage-bridge";
import type { Session } from "../../src/client/types";

export async function priceFixture(
  admin: Page,
  browser: Browser,
  gas = false,
  realActivation = true,
) {
  const f = await stationFixture(admin);
  const product = gas ? "cooking_gas" : "pms";
  const activateReal = async (
    rateKobo: string,
    quantityPrecision = gas ? 2 : 3,
  ) => {
    if (
      !/^whr128_price_[a-z0-9_]+$/.test(
        new URL(process.env.DATABASE_URL!).pathname.slice(1),
      )
    )
      throw new Error(
        "Real price activation requires dedicated whr128_price_* database",
      );
    const current = (
      await f.db.query(
        "SELECT p.version FROM product_price_version p JOIN product x ON x.id=p.product_id WHERE x.code=$1 ORDER BY p.version DESC LIMIT 1",
        [product],
      )
    ).rows[0];
    return api(
      admin.request,
      `prices/${product}/activate`,
      {
        operationId: v7(),
        expectedVersion: current?.version ?? null,
        rateKobo,
        currency: "NGN",
        quantityPrecision,
        reason: "Fictional P-27 dedicated-database activation",
      },
      201,
    );
  };
  if (realActivation) await activateReal(gas ? "150000" : "100000");
  const pump = await api<{ id: string; version: number }>(
    admin.request,
    "pumps",
    { operationId: v7(), name: `P27 ${v7().slice(-8)}`, productCode: product },
    201,
  );
  const username = `price.${v7().slice(-12)}`,
    password = randomBytes(24).toString("hex");
  const attendant = await api<{ id: string; accountId: string }>(
    admin.request,
    "attendants",
    {
      operationId: v7(),
      name: "Grace Okon",
      username,
      password,
      pumpId: pump.id,
      expectedPumpVersion: pump.version,
    },
    201,
  );
  await f.db.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [attendant.accountId],
  );
  let batch = await api<{ id: string; version: number }>(
    admin.request,
    "card-batches",
    { operationId: v7(), name: "Fictional price adoption stock", count: 3 },
    201,
  );
  for (const action of ["mark-printed", "activate"])
    batch = await api(admin.request, `card-batches/${batch.id}/${action}`, {
      operationId: v7(),
      expectedVersion: batch.version,
      reason: "Fictional fixture stock",
    });
  const cards = await api<{ items: { code: string }[] }>(
    admin.request,
    `card-batches/${batch.id}/cards`,
  );
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    permissions: ["camera"],
  });
  const suffix = v7().replaceAll("-", "").slice(-12).match(/.{4}/g)!.join(":");
  await context.setExtraHTTPHeaders({ "x-test-ip": `2001:db8::${suffix}` });
  await context.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const unique = crypto.randomUUID();
      const draw = () => {
        const c = canvas.getContext("2d")!;
        c.fillStyle = "white";
        c.fillRect(0, 0, 640, 480);
        c.fillStyle = "black";
        c.font = "28px monospace";
        c.fillText("FICTIONAL TEST METER", 20, 140);
        c.fillText(unique, 20, 220);
      };
      draw();
      const timer = setInterval(draw, 50);
      const stream = canvas.captureStream(20);
      stream
        .getVideoTracks()[0]!
        .addEventListener("ended", () => clearInterval(timer));
      return stream;
    };
  });
  const phone = await context.newPage();
  await installLocalStorageBridge(phone);
  await attendantSignIn(phone, username, password);
  await expect(phone).toHaveURL(/\/attendant\/sale$/);
  const codes = cards.items.map((c) => c.code);
  const registered = await phone.request.post("/api/attendant/customers", {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: {
      operationId: v7(),
      name: "Amina Bello",
      phone: phoneNumber(),
      category: gas ? "cooking_gas_customer" : "car_owner",
      card: { source: "code", code: codes[0] },
    },
  });
  expect(registered.status()).toBe(201);
  const initial = await data<Session>(phone.request, "/api/attendant/session");
  let projected = initial.price;
  if (!realActivation)
    await context.route("**/api/attendant/cards/lookup", async (route) => {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      const body = await response.json();
      expect(route.request().headers()["x-wr-price-refresh"]).toBe("1");
      body.data.priceRefresh = {
        captureContextId: initial.captureContextId,
        originatingAccountId: initial.account.id,
        stationId: initial.station.id,
        assignmentId: initial.assignment.id,
        pumpId: initial.pump.id,
        productId: initial.product.id,
        price: { ...projected, fetchedAt: body.data.lookedUpAt },
      };
      await route.fulfill({ response, json: body });
    });
  const activate = realActivation
    ? activateReal
    : async (
        rateKobo: string,
        quantityPrecision = initial.price.quantityPrecision,
      ) => {
        projected = {
          ...projected,
          priceVersionId: v7(),
          version: projected.version + 1,
          rateKobo,
          quantityPrecision,
          effectiveFrom: new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
        };
      };
  return {
    ...f,
    phone,
    context,
    codes,
    initial,
    activate,
    gas,
    username,
    password,
    async close() {
      await context.close();
      await f.db.end();
    },
  };
}
export async function lookup(page: Page, code: string) {
  await page.getByLabel("Or enter the card number", { exact: true }).fill(code);
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(page.getByText("Amina Bello", { exact: true })).toBeVisible();
}
export async function photo(page: Page) {
  await page.getByRole("button", { name: /^Take meter photo/ }).click();
  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retake", exact: true }),
  ).toBeVisible();
}
export async function value(
  page: Page,
  amount: string,
  label = "Amount in naira",
) {
  const input = page.getByLabel(label, { exact: true });
  await input.focus();
  await expect(input).not.toHaveValue(/,/);
  await input.fill(amount);
}
export async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const q = indexedDB.open("whales-capture-v1");
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    const read = (name: string) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const q = db.transaction(name).objectStore(name).getAll();
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
    const windows = await read("windows"),
      customers = await read("customers");
    db.close();
    return { windows, customers };
  });
}

import { expect, test } from "@playwright/test";
import { priceFixture, lookup, photo, value, stored } from "./helpers";
import { rows, save } from "../fixtures/offline-browser";

for (const trigger of ["amount", "medium", "photo"] as const)
  test(`P-27 PR-T1-06 lookup arriving after ${trigger} composition never reprices the draft`, async ({
    page,
    browser,
  }) => {
    const f = await priceFixture(page, browser);
    let release = () => {};
    try {
      await f.activate("120000", 4);
      let received = () => {};
      const arrived = new Promise<void>((r) => (received = r));
      const gate = new Promise<void>((r) => (release = r));
      await f.phone.route(
        "**/api/attendant/cards/lookup",
        async (route) => {
          const response = await route.fetch();
          received();
          await gate;
          await route.fulfill({ response });
        },
        { times: 1 },
      );
      await f.phone
        .getByLabel("Or enter the card number", { exact: true })
        .fill(f.codes[0]!);
      await f.phone.getByRole("button", { name: "Find", exact: true }).click();
      await arrived;
      if (trigger === "amount") await value(f.phone, "10000");
      if (trigger === "medium")
        await f.phone.getByRole("button", { name: "Keg", exact: true }).click();
      if (trigger === "photo") {
        // Release from the actual click event, before awaiting camera setup or
        // taking a picture. Waiting for photo() hid a price-adoption race here.
        await f.phone.exposeFunction("releasePriceLookup", release);
        await f.phone
          .getByRole("button", { name: /^Take meter photo/ })
          .evaluate((button) =>
            button.addEventListener(
              "click",
              () => {
                void (
                  window as unknown as {
                    releasePriceLookup: () => Promise<void>;
                  }
                ).releasePriceLookup();
              },
              { once: true },
            ),
          );
        await f.phone
          .getByRole("button", { name: /^Take meter photo/ })
          .click();
        await f.phone
          .getByRole("button", { name: "Take photo", exact: true })
          .click();
        await expect(
          f.phone.getByRole("button", { name: "Retake", exact: true }),
        ).toBeVisible();
      } else release();
      await expect(
        f.phone.getByText("Amina Bello", { exact: true }),
      ).toBeVisible();
      await expect(
        f.phone.getByText(/This sale keeps ₦1,000.00 per litre/),
      ).toBeVisible();
      if (trigger !== "medium")
        await f.phone
          .getByRole("button", { name: "Vehicle", exact: true })
          .click();
      if (trigger !== "amount") await value(f.phone, "10000");
      if (trigger !== "photo") await photo(f.phone);
      await f.context.setOffline(true);
      await save(f.phone);
      expect((await rows(f.phone))[0]!.original).toMatchObject({
        rateKobo: "100000",
        quantityPrecision: 3,
      });
      expect(
        (await rows(f.phone))[0]!.original.lookupReceipt ?? null,
      ).toBeNull();
    } finally {
      release();
      await f.close();
    }
  });

test("P-27 PR-T1-07/11 repeated cross-tab updates and failed save retain original photo and signed evidence", async ({
  page,
  browser,
}) => {
  const f = await priceFixture(page, browser);
  try {
    const lookupResponse = f.phone.waitForResponse(
      (response) =>
        response.url().endsWith("/api/attendant/cards/lookup") && response.ok(),
    );
    await lookup(f.phone, f.codes[0]!);
    const receipt = (await (await lookupResponse).json()).data.lookupReceipt;
    expect(receipt).toBeTruthy();
    await value(f.phone, "20000.01");
    await f.phone.getByRole("button", { name: "Vehicle", exact: true }).click();
    await photo(f.phone);
    const image = await f.phone.locator('img[alt*="eter"]').getAttribute("src");
    const other = await f.context.newPage();
    await other.goto("/attendant/sale");
    for (const rate of ["120000", "130000"]) {
      await f.activate(rate, 4);
      if (
        await other.getByRole("button", { name: "Change", exact: true }).count()
      )
        await other
          .getByRole("button", { name: "Change", exact: true })
          .click();
      await lookup(other, f.codes[0]!);
      await expect(
        f.phone.getByText(
          new RegExp(
            `Price updated to ₦1,${rate === "120000" ? "200" : "300"}.00 per litre for new sales`,
          ),
        ),
      ).toBeVisible();
      expect(
        await f.phone.locator('img[alt*="eter"]').getAttribute("src"),
      ).toBe(image);
    }
    await f.phone.evaluate(() => {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (
        ...args: Parameters<IDBObjectStore["add"]>
      ) {
        if (this.name === "outbox") {
          Object.assign(window, {
            attemptedOriginal: structuredClone(
              (args[0] as { original: unknown }).original,
            ),
          });
          IDBObjectStore.prototype.add = add;
          throw new DOMException(
            "Fictional quota failure",
            "QuotaExceededError",
          );
        }
        return add.apply(this, args);
      };
    });
    await f.phone
      .getByRole("button", { name: "Save sale", exact: true })
      .click();
    await expect(
      f.phone.getByText(/storage|space|save failed|could not save/i).first(),
    ).toBeVisible();
    expect(await rows(f.phone)).toEqual([]);
    const attemptedOriginal = await f.phone.evaluate(
      () =>
        (window as unknown as { attemptedOriginal: unknown }).attemptedOriginal,
    );
    expect(attemptedOriginal).toBeTruthy();
    await expect(
      f.phone.getByLabel("Amount in naira", { exact: true }),
    ).toHaveValue("20,000.01");
    expect(await f.phone.locator('img[alt*="eter"]').getAttribute("src")).toBe(
      image,
    );
    await f.context.setOffline(true);
    await save(f.phone);
    const saved = (await rows(f.phone))[0]!;
    expect(saved.original).toMatchObject({
      rateKobo: "100000",
      quantityPrecision: 3,
      lookupReceipt: receipt,
      entry: { amountKobo: "2000001", quantity: "20" },
    });
    expect(saved.original).toEqual(attemptedOriginal);
    expect(saved.photoDigest).toBe(saved.photoBlob.digest);
    const frozen = { original: saved.original, photo: saved.photoBlob };
    // Avoid upload mutation while proving a later ordinary lookup cannot rewrite saved payload bytes.
    await f.context.route("**/api/sync/**", (route) => route.abort("failed"));
    await f.context.setOffline(false);
    await f.activate("140000", 5);
    await other.getByRole("button", { name: "Change", exact: true }).click();
    await lookup(other, f.codes[0]!);
    expect(
      (await rows(f.phone)).map((r) => ({
        original: r.original,
        photo: r.photoBlob,
      })),
    ).toEqual([frozen]);
    expect(JSON.stringify((await stored(f.phone)).customers)).not.toContain(
      "priceRefresh",
    );
  } finally {
    await f.close();
  }
});

test("P-27 PR-T1-07 discard clears composition and ignores its delayed lookup before a fresh sale", async ({
  page,
  browser,
}) => {
  const f = await priceFixture(page, browser);
  let release = () => {};
  let discardedReceipt: string | null = null;
  try {
    await value(f.phone, "10000");
    await f.phone.getByRole("button", { name: "Vehicle", exact: true }).click();
    await photo(f.phone);
    await f.activate("120000", 4);
    let received = () => {};
    const arrived = new Promise<void>((r) => (received = r)),
      gate = new Promise<void>((r) => (release = r));
    await f.phone.route(
      "**/api/attendant/cards/lookup",
      async (route) => {
        const response = await route.fetch();
        discardedReceipt = (await response.json()).data.lookupReceipt;
        received();
        await gate;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    await f.phone
      .getByLabel("Or enter the card number", { exact: true })
      .fill(f.codes[0]!);
    await f.phone.getByRole("button", { name: "Find", exact: true }).click();
    await arrived;
    await f.phone
      .getByRole("button", {
        name: "Discard and start a new sale",
        exact: true,
      })
      .click();
    await f.phone
      .getByRole("button", { name: "Discard sale", exact: true })
      .click();
    release();
    await expect(
      f.phone.getByLabel("Amount in naira", { exact: true }),
    ).toHaveValue("");
    await expect(
      f.phone.getByRole("button", { name: "Retake", exact: true }),
    ).toHaveCount(0);
    await expect(f.phone.getByText("Amina Bello", { exact: true })).toHaveCount(
      0,
    );
    await lookup(f.phone, f.codes[0]!);
    await value(f.phone, "12000");
    await f.phone.getByRole("button", { name: "Vehicle", exact: true }).click();
    await photo(f.phone);
    await f.context.setOffline(true);
    await save(f.phone);
    const saved = (await rows(f.phone))[0]!;
    expect(saved.original.lookupReceipt).toBeTruthy();
    expect(saved.original.lookupReceipt).not.toBe(discardedReceipt);
    expect(saved.original).toMatchObject({
      rateKobo: "120000",
      quantityPrecision: 4,
      entry: { amountKobo: "1200000", quantity: "10" },
    });
  } finally {
    release();
    await f.close();
  }
});

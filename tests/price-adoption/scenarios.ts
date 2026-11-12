import { expect, test, type Page } from "@playwright/test";
import { amountToQuantity, quantityToAmount } from "../../src/shared/quantity";
import { priceFixture, lookup, photo, value, stored } from "./helpers";
import { rows, save } from "../fixtures/offline-browser";
import type { OfflineWindow } from "../../src/client/types";

const money = (kobo: string) =>
  new Intl.NumberFormat("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(kobo) / 100);
async function windowPrice(page: Page) {
  return (await stored(page)).windows[0] as unknown as OfflineWindow;
}
async function frozenSave(f: Awaited<ReturnType<typeof priceFixture>>) {
  await f.context.setOffline(true);
  await save(f.phone);
  const all = await rows(f.phone);
  expect(all).toHaveLength(1);
  return all[0]!;
}
export function representativeScenarios(real: boolean) {
  test(`P-27 PR-T1-03/06 ${real ? "real activation" : "controlled response"}: empty lookup adopts before composition and saves the new immutable snapshot`, async ({
    page,
    browser,
  }) => {
    const f = await priceFixture(page, browser, false, real);
    try {
      const target = (BigInt(f.initial.price.rateKobo) + 20000n).toString();
      const seen: string[] = [];
      f.phone.on("request", (r) => {
        if (r.url().includes("/api/attendant/"))
          seen.push(new URL(r.url()).pathname);
      });
      await f.activate(target, 3);
      await lookup(f.phone, f.codes[0]!);
      await expect(
        f.phone.getByText(`Price updated to ₦${money(target)} per litre`, {
          exact: true,
        }),
      ).toBeVisible();
      await f.phone
        .getByRole("button", { name: "Vehicle", exact: true })
        .click();
      await value(f.phone, "20000.01");
      await photo(f.phone);
      const adopted = await windowPrice(f.phone);
      expect(adopted.session.price.rateKobo).toBe(target);
      expect(adopted.session.offlineExpiresAt).toBe(f.initial.offlineExpiresAt);
      const sale = await frozenSave(f);
      expect(sale.original).toMatchObject({
        rateKobo: target,
        priceVersionId: adopted.session.price.priceVersionId,
        quantityPrecision: 3,
        entry: {
          basis: "amount",
          enteredAmountKobo: "2000001",
          amountKobo: "2000001",
          quantity: amountToQuantity(2000001n, BigInt(target), 3),
        },
      });
      expect(sale.original.lookupReceipt).toBeTruthy();
      expect(JSON.stringify(sale)).not.toContain("priceRefresh");
      expect(JSON.stringify((await stored(f.phone)).customers)).not.toContain(
        "priceRefresh",
      );
      expect(seen.filter((p) => p.includes("lookup"))).toHaveLength(1);
      expect(seen.filter((p) => /price|refresh/.test(p))).toEqual([]);
    } finally {
      await f.close();
    }
  });
  test(`P-27 PR-T1-06/08 ${real ? "real activation" : "controlled response"}: earlier amount freezes rate and precision while lookup adopts a lower future rate`, async ({
    page,
    browser,
  }) => {
    const f = await priceFixture(page, browser, false, real);
    try {
      await value(f.phone, "20000.01");
      const target = (BigInt(f.initial.price.rateKobo) - 10000n).toString();
      await f.activate(target, 4);
      await lookup(f.phone, f.codes[0]!);
      await expect(
        f.phone.getByText(
          `Price updated to ₦${money(target)} per litre for new sales. This sale keeps ₦${money(f.initial.price.rateKobo)} per litre. Check the meter before saving.`,
          { exact: true },
        ),
      ).toBeVisible();
      await f.phone
        .getByRole("button", { name: "Vehicle", exact: true })
        .click();
      await photo(f.phone);
      const sale = await frozenSave(f);
      expect(sale.original).toMatchObject({
        rateKobo: f.initial.price.rateKobo,
        priceVersionId: f.initial.price.priceVersionId,
        quantityPrecision: f.initial.price.quantityPrecision,
        entry: {
          amountKobo: "2000001",
          quantity: amountToQuantity(
            2000001n,
            BigInt(f.initial.price.rateKobo),
            f.initial.price.quantityPrecision,
          ),
        },
      });
      expect(sale.original.lookupReceipt ?? null).toBeNull();
      expect((await windowPrice(f.phone)).session.price.rateKobo).toBe(target);
    } finally {
      await f.close();
    }
  });
}
export function realScenarios() {
  for (const trigger of ["medium", "photo"] as const)
    test(`P-27 PR-T1-06 ${trigger} starts composition before customer lookup`, async ({
      page,
      browser,
    }) => {
      const f = await priceFixture(page, browser);
      try {
        if (trigger === "medium")
          await f.phone
            .getByRole("button", { name: "Keg", exact: true })
            .click();
        else await photo(f.phone);
        await f.activate("125000", 4);
        await lookup(f.phone, f.codes[0]!);
        await expect(
          f.phone.getByText(/This sale keeps ₦1,000.00 per litre/),
        ).toBeVisible();
        if (trigger === "photo")
          await f.phone
            .getByRole("button", { name: "Vehicle", exact: true })
            .click();
        await value(f.phone, "10000");
        if (trigger !== "photo") await photo(f.phone);
        const sale = await frozenSave(f);
        expect(sale.original.rateKobo).toBe("100000");
        expect(sale.original.quantityPrecision).toBe(3);
        expect(sale.original.lookupReceipt ?? null).toBeNull();
      } finally {
        await f.close();
      }
    });
  for (const composed of [false, true])
    test(`P-27 I-29/I-30 gas rate ${composed ? "warning preserves composed sale" : "notice adopts for new sale"} uses kilograms`, async ({
      page,
      browser,
    }) => {
      const f = await priceFixture(page, browser, true);
      try {
        if (composed) await value(f.phone, "15000");
        await f.activate("160000", 2);
        await lookup(f.phone, f.codes[0]!);
        const message = composed
          ? "Price updated to ₦1,600.00 per kilogram for new sales. This sale keeps ₦1,500.00 per kilogram. Check the meter before saving."
          : "Price updated to ₦1,600.00 per kilogram";
        await expect(f.phone.getByText(message, { exact: true })).toBeVisible();
        await expect(f.phone.getByText(/Price updated.*per litre/)).toHaveCount(
          0,
        );
        if (!composed) await value(f.phone, "16000");
        await photo(f.phone);
        const sale = await frozenSave(f);
        expect(sale.original).toMatchObject({
          unit: "kilogram",
          medium: "cylinder",
          rateKobo: composed ? "150000" : "160000",
          entry: {
            quantity: "10",
            amountKobo: composed ? "1500000" : "1600000",
          },
        });
        if (composed) expect(sale.original.lookupReceipt ?? null).toBeNull();
        else expect(sale.original.lookupReceipt).toBeTruthy();
      } finally {
        await f.close();
      }
    });
  test("P-27 PR-T1-08 gas quantity uses new precision while automatic Cylinder never starts composition", async ({
    page,
    browser,
  }) => {
    const f = await priceFixture(page, browser, true);
    try {
      await expect(
        f.phone.getByLabel("Bought into", { exact: true }),
      ).toHaveValue("Cylinder");
      await f.activate("150000", 3);
      await lookup(f.phone, f.codes[0]!);
      await expect(
        f.phone.getByText("Quantity precision updated for new sales", {
          exact: true,
        }),
      ).toBeVisible();
      await f.phone
        .getByRole("button", { name: "Kilograms", exact: true })
        .click();
      await value(f.phone, "1.235", "Kilograms");
      await photo(f.phone);
      const sale = await frozenSave(f);
      expect(sale.original).toMatchObject({
        unit: "kilogram",
        medium: "cylinder",
        quantityPrecision: 3,
        rateKobo: "150000",
        entry: {
          basis: "quantity",
          enteredQuantity: "1.235",
          quantity: "1.235",
          amountKobo: quantityToAmount("1.235", 150000n, 3).toString(),
        },
      });
    } finally {
      await f.close();
    }
  });
}

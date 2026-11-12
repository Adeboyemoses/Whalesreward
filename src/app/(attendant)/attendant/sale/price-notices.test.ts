import { describe, expect, it } from "vitest";
import { adoptedPriceNotices, retainedPriceWarnings } from "./price-notices";
import type { Session } from "@/client/types";
const price = {
  version: 1,
  rateKobo: "100000",
  quantityPrecision: 3,
} as Session["price"];
describe("P-27 price notices", () => {
  it("does not announce initial/repeat/older snapshots and distinguishes exact unit/rate decreases", () => {
    expect(adoptedPriceNotices(price, price, "litre")).toEqual([]);
    expect(
      adoptedPriceNotices(
        price,
        { ...price, version: 0, rateKobo: "90000" },
        "litre",
      ),
    ).toEqual([]);
    expect(
      adoptedPriceNotices(
        price,
        { ...price, version: 2, rateKobo: "90000" },
        "litre",
      ),
    ).toEqual(["Price updated to ₦900.00 per litre"]);
    expect(
      adoptedPriceNotices(
        price,
        { ...price, version: 2, rateKobo: "150000" },
        "kilogram",
      ),
    ).toEqual(["Price updated to ₦1,500.00 per kilogram"]);
  });
  it("keeps draft warning across repeat versions and treats precision separately", () => {
    const current = {
      ...price,
      version: 2,
      rateKobo: "150000",
      quantityPrecision: 2,
    };
    expect(retainedPriceWarnings(price, current, "kilogram")).toEqual([
      "Price updated to ₦1,500.00 per kilogram for new sales. This sale keeps ₦1,000.00 per kilogram. Check the meter before saving.",
      "Quantity precision updated for new sales. This sale keeps its original quantity precision. Check the meter before saving.",
    ]);
    expect(
      adoptedPriceNotices(
        price,
        { ...price, version: 2, quantityPrecision: 2 },
        "litre",
      ),
    ).toEqual(["Quantity precision updated for new sales"]);
    expect(
      retainedPriceWarnings(price, { ...price, version: 3 }, "litre"),
    ).toEqual([]);
  });
});

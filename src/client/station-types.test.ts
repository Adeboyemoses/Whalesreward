import { expect, it } from "vitest";
import { priceSchema } from "./station-types";
it("rejects a malformed out-of-range wire price before money reaches rendering", () => {
  const p = {
    priceVersionId: "019a5d0c-0000-7000-8000-000000000001",
    version: 1,
    rateKobo: "9223372036854775807",
    currency: "NGN",
    quantityPrecision: 3,
    effectiveFrom: "2026-11-09T00:00:00Z",
    fetchedAt: "2026-11-09T00:00:00Z",
  };
  expect(priceSchema.safeParse(p).success).toBe(true);
  expect(
    priceSchema.safeParse({ ...p, rateKobo: "9223372036854775808" }).success,
  ).toBe(false);
});

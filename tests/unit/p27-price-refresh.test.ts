import { describe, expect, it } from "vitest";
import {
  lookupWireResponseSchema,
  normalizedLookupResponseSchema,
} from "../../src/shared/contracts/sync";
import { priceSnapshotSchema } from "../../src/shared/contracts/auth";
const id = "019a5000-0000-7000-8000-000000000001";
const price = {
  priceVersionId: id,
  version: 2,
  rateKobo: "90000",
  currency: "NGN",
  quantityPrecision: 3,
  effectiveFrom: "2026-11-12T10:00:00.000Z",
  fetchedAt: "2026-11-12T10:01:00.000Z",
};
const refresh = {
  captureContextId: id,
  originatingAccountId: id,
  stationId: id,
  assignmentId: id,
  pumpId: id,
  productId: id,
  price,
};
const base = {
  cardCode: "A7K3M9Q",
  customer: { id, name: "Amina Bello", category: "car_owner" },
  lookedUpAt: "2026-11-12T10:01:00.000Z",
};
describe("P-27 strict compatibility (PR-T1-01/02)", () => {
  it.each([
    {},
    { lookupReceipt: null },
    { priceRefresh: null },
    { lookupReceipt: null, priceRefresh: refresh },
  ])("accepts and normalizes each strict shape %j", (extensions) => {
    const wire = { ...base, ...extensions };
    expect(lookupWireResponseSchema.parse(wire)).toEqual(wire);
    expect(normalizedLookupResponseSchema.parse(wire)).toEqual({
      ...wire,
      lookupReceipt: "lookupReceipt" in wire ? wire.lookupReceipt : null,
      priceRefresh: "priceRefresh" in wire ? wire.priceRefresh : null,
    });
  });
  it.each([
    { unknown: true },
    { priceRefresh: {} },
    { priceRefresh: "bad" },
    { priceRefresh: { ...refresh, unknown: true } },
    { priceRefresh: { ...refresh, pumpId: "not-an-id" } },
    { customer: { ...base.customer, category: "unknown" } },
    { customer: { ...base.customer, extra: true } },
    { lookupReceipt: "invalid" },
  ])("rejects malformed extension or unknown keys %j", (patch) => {
    expect(
      lookupWireResponseSchema.safeParse({ ...base, ...patch }).success,
    ).toBe(false);
  });
  it.each([
    { priceVersionId: "019a5000-0000-4000-8000-000000000001" },
    { priceVersionId: "019A5000-0000-7000-8000-000000000001" },
    { rateKobo: "0" },
    { rateKobo: "-1" },
    { rateKobo: "1.2" },
    { rateKobo: "01" },
    { rateKobo: "9223372036854775808" },
    { rateKobo: 100 },
    { currency: "USD" },
    { quantityPrecision: -1 },
    { quantityPrecision: 7 },
    { quantityPrecision: 1.5 },
    { version: 0 },
    { version: 2147483648 },
    { version: 1.5 },
    { effectiveFrom: "yesterday" },
    { fetchedAt: "2026-11-12T11:01:00+01:00" },
    { effectiveFrom: "2026-11-12T10:02:00.000Z" },
    { unknown: true },
  ])("rejects invalid snapshot %j", (patch) => {
    expect(priceSnapshotSchema.safeParse({ ...price, ...patch }).success).toBe(
      false,
    );
    expect(
      lookupWireResponseSchema.safeParse({
        ...base,
        priceRefresh: { ...refresh, price: { ...price, ...patch } },
      }).success,
    ).toBe(false);
  });
  it("accepts exact bounds and equal instants", () => {
    for (const quantityPrecision of [0, 6])
      expect(
        priceSnapshotSchema.safeParse({
          ...price,
          quantityPrecision,
          version: 2147483647,
          rateKobo: "9223372036854775807",
          fetchedAt: price.effectiveFrom,
        }).success,
      ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  lookupWireResponseSchema,
  lookupResponseEnvelopeSchema,
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
    { rateKobo: "1\n" },
    { rateKobo: "1\r" },
    { rateKobo: "1\r\n" },
    { rateKobo: " 1" },
    { rateKobo: "1 " },
    { rateKobo: "1\t" },
    { rateKobo: "1\u00a0" },
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
  it("compares fractional UTC instants without losing sub-millisecond order", () => {
    expect(
      priceSnapshotSchema.safeParse({
        ...price,
        effectiveFrom: "2026-11-12T10:01:00.0002Z",
        fetchedAt: "2026-11-12T10:01:00.0001Z",
      }).success,
    ).toBe(false);
    expect(
      priceSnapshotSchema.safeParse({
        ...price,
        effectiveFrom: "2026-11-12T10:01:00Z",
        fetchedAt: "2026-11-12T10:01:00.000Z",
      }).success,
    ).toBe(true);
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
  it.each([
    "captureContextId",
    "originatingAccountId",
    "stationId",
    "assignmentId",
    "pumpId",
    "productId",
  ])("requires a canonical UUIDv7 for %s", (field) => {
    for (const invalid of [
      "bad",
      "019a5000-0000-4000-8000-000000000001",
      "019A5000-0000-7000-8000-000000000001",
      null,
      1,
    ]) {
      expect(
        lookupWireResponseSchema.safeParse({
          ...base,
          priceRefresh: { ...refresh, [field]: invalid },
        }).success,
      ).toBe(false);
    }
  });
  it("keeps envelopes strict and rejects non-UTC or malformed response times", () => {
    const envelope = {
      data: { ...base, priceRefresh: refresh },
      serverTime: base.lookedUpAt,
      requestId: id,
    };
    expect(lookupResponseEnvelopeSchema.safeParse(envelope).success).toBe(true);
    for (const value of [
      { ...envelope, extra: true },
      { ...envelope, serverTime: "bad" },
      { ...envelope, requestId: "bad" },
      { ...envelope, data: { ...envelope.data, extra: true } },
      {
        ...envelope,
        data: { ...envelope.data, lookedUpAt: "2026-11-12T11:01:00+01:00" },
      },
      { ...envelope, data: { ...envelope.data, lookedUpAt: "bad" } },
      {
        ...envelope,
        data: {
          ...envelope.data,
          priceRefresh: {
            ...refresh,
            price: { ...price, effectiveFrom: "2026-11-12T11:00:00+01:00" },
          },
        },
      },
    ])
      expect(lookupResponseEnvelopeSchema.safeParse(value).success).toBe(false);
  });
});

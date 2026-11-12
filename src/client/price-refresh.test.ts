import { expect, it, vi } from "vitest";
import { v7 } from "uuid";
import { HttpAttendantApi } from "./api";
import { sessionFixture } from "../../tests/fixtures/attendant-client-fake";
const session = sessionFixture(Date.parse("2026-11-12T10:00:00Z"));
const base = {
  cardCode: "A7K3M9X",
  customer: { id: v7(), name: "Amina Bello", category: "car_owner" },
  lookedUpAt: session.serverTime,
};
const refresh = {
  captureContextId: session.captureContextId,
  originatingAccountId: session.account.id,
  stationId: session.station.id,
  assignmentId: session.assignment.id,
  pumpId: session.pump.id,
  productId: session.product.id,
  price: session.price,
};
function response(data: unknown) {
  return new Response(
    JSON.stringify({ data, serverTime: session.serverTime, requestId: v7() }),
    { status: 200 },
  );
}
it.each([
  {},
  { lookupReceipt: null },
  { priceRefresh: refresh },
  { lookupReceipt: null, priceRefresh: refresh },
])(
  "P-27 decodes strict rollout shape %j and opts into both independent capabilities",
  async (extensions) => {
    const transport = vi.fn<typeof fetch>(async () =>
      response({ ...base, ...extensions }),
    );
    const result = await new HttpAttendantApi(transport).lookup({
      source: "code",
      code: base.cardCode,
    });
    expect(result).toEqual({
      ...base,
      lookupReceipt: null,
      priceRefresh: null,
      ...extensions,
    });
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
      headers: { "X-WR-Price-Refresh": "1", "X-WR-Lookup-Receipt": "1" },
    });
  },
);
it.each([
  {
    priceRefresh: {
      ...refresh,
      price: { ...session.price, effectiveFrom: "2026-11-13T10:00:00Z" },
    },
  },
  {
    priceRefresh: {
      ...refresh,
      price: { ...session.price, fetchedAt: "2026-11-12T11:00:00+01:00" },
    },
  },
  { priceRefresh: { ...refresh, unexpected: true } },
  { priceRefresh: { ...refresh, price: { ...session.price, rateKobo: "0" } } },
  {
    priceRefresh: {
      ...refresh,
      price: { ...session.price, quantityPrecision: 7 },
    },
  },
  { priceRefresh: null, unexpected: true },
])(
  "P-27 malformed lookup extension is an invalid response without permissive stripping",
  async (extensions) => {
    await expect(
      new HttpAttendantApi(async () =>
        response({ ...base, ...extensions }),
      ).lookup({ source: "code", code: base.cardCode }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  },
);

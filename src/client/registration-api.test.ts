import { describe, expect, it, vi } from "vitest";
import { v7 } from "uuid";
import { HttpRegistrationApi, RegistrationOperation } from "./registration-api";
import { ClientError } from "./types";
const input = () => ({
  operationId: v7(),
  name: " Amina Bello ",
  phone: "08000000101",
  category: "car_owner" as const,
  card: { source: "code" as const, code: " c9p4t7m " },
});
function receipt(operationId: string) {
  return {
    operationId,
    customer: {
      id: v7(),
      customerCode: "CUST006",
      name: "Amina Bello",
      category: "car_owner",
      phone: "08000000101",
    },
    cardCode: "C9P4T7M",
    registeredAt: "2026-11-09T10:00:00Z",
    registeredAtStation: { id: v7(), name: "Station 01" },
    registeredBy: { id: v7(), code: "STAFF002", name: "Grace Okon" },
  };
}
const envelope = (data: unknown) =>
  Response.json({ data, serverTime: "2026-11-09T10:00:00Z", requestId: v7() });
describe("online memory-only registration", () => {
  it("keeps the normalized body and operation key after a lost response and coalesces double clicks", async () => {
    const original = input();
    let release!: () => void;
    let calls = 0;
    const transport = vi.fn<typeof fetch>(async () => {
      calls++;
      if (calls === 1) {
        await new Promise<void>((r) => {
          release = r;
        });
        throw new Error("lost");
      }
      return envelope(receipt(original.operationId));
    });
    const api = new HttpRegistrationApi(transport, () => () => {});
    const op = new RegistrationOperation(
      original,
      "account:session",
      () => "account:session",
    );
    const first = op.send(api);
    const second = op.send(api);
    const failed = expect(first).rejects.toMatchObject({
      code: "network_unavailable",
    });
    const failedSecond = expect(second).rejects.toMatchObject({
      code: "network_unavailable",
    });
    release();
    await failed;
    await failedSecond;
    original.name = "Other name";
    original.card.code = "A7K3M9Q";
    await op.send(api);
    expect(transport).toHaveBeenCalledTimes(2);
    const options = transport.mock.calls.map(
      (call) => (call as unknown as [string, RequestInit])[1],
    );
    expect(options[0]?.body).toBe(options[1]?.body);
    expect(JSON.parse(options[1]!.body as string)).toMatchObject({
      name: "Amina Bello",
      card: { code: "C9P4T7M" },
    });
    expect(options[1]).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      headers: { "Idempotency-Key": original.operationId },
    });
  });
  it("rejects mismatched operation receipts and strict extra response fields", async () => {
    const original = input();
    const api = new HttpRegistrationApi(
      async () => envelope(receipt(v7())),
      () => () => {},
    );
    await expect(api.register(original)).rejects.toMatchObject({
      code: "invalid_response",
    });
    const extra = new HttpRegistrationApi(
      async () =>
        envelope({
          ...receipt(original.operationId),
          phoneSearch: "sensitive",
        }),
      () => () => {},
    );
    await expect(extra.register(original)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
  it("gets existing identity only by exact-phone POST and refuses a phone-bearing lookup", async () => {
    const result = {
      customer: {
        id: v7(),
        customerCode: "CUST006",
        name: "Amina Bello",
        category: "car_owner",
      },
      cardCode: null,
      cardUsable: false,
      lookedUpAt: "2026-11-09T10:00:00Z",
    };
    const transport = vi.fn<typeof fetch>(async () => envelope(result));
    const api = new HttpRegistrationApi(transport, () => () => {});
    expect(await api.lookupPhone("08000000101")).toEqual(result);
    expect(transport.mock.calls[0]?.[0]).toBe(
      "/api/attendant/customers/lookup",
    );
    const bad = new HttpRegistrationApi(
      async () => envelope({ ...result, phone: "08000000101" }),
      () => () => {},
    );
    await expect(bad.lookupPhone("08000000101")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
  it("never authorizes a sale from the historical receipt or a different current customer", async () => {
    const customerId = v7();
    const transport = vi.fn<typeof fetch>(async () =>
      envelope({
        cardCode: "C9P4T7M",
        customer: { id: v7(), name: "Grace Okon", category: "car_owner" },
        lookedUpAt: "2026-11-09T10:00:00Z",
      }),
    );
    const api = new HttpRegistrationApi(transport, () => () => {});
    await expect(api.currentCard("C9P4T7M", customerId)).rejects.toMatchObject({
      code: "card_unavailable",
    });
    expect(transport.mock.calls[0]).toEqual([
      "/api/attendant/cards/lookup",
      expect.objectContaining({
        cache: "no-store",
        body: JSON.stringify({ source: "code", code: "C9P4T7M" }),
      }),
    ]);
  });
  it("clearing the page invalidates the pending receipt and erases the frozen phone body", async () => {
    const original = input();
    let release!: (r: Response) => void;
    const api = new HttpRegistrationApi(
      () =>
        new Promise<Response>((r) => {
          release = r;
        }),
      () => () => {},
    );
    const op = new RegistrationOperation(
      original,
      "account:session",
      () => "account:session",
    );
    const result = op.send(api);
    const rejected = expect(result).rejects.toMatchObject({
      code: "account_changed",
    });
    op.clear();
    release(envelope(receipt(original.operationId)));
    await rejected;
    expect(op.payload).toBeNull();
    await expect(op.send(api)).rejects.toMatchObject({
      code: "account_changed",
    });
  });
  it("does not expose error response PII and fences late receipts after authority change or invalidation", async () => {
    const original = input();
    let authority: string | null = "account:session";
    let release!: (r: Response) => void;
    const api = new HttpRegistrationApi(
      () =>
        new Promise<Response>((r) => {
          release = r;
        }),
      () => () => {},
    );
    const op = new RegistrationOperation(original, authority, () => authority);
    const pending = op.send(api);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "account_changed",
    });
    authority = "other:session";
    release(envelope(receipt(original.operationId)));
    await rejected;
    await expect(op.send(api)).rejects.toMatchObject({
      code: "account_changed",
    });
    const denied = new HttpRegistrationApi(
      async () =>
        Response.json(
          {
            error: {
              code: "phone_in_use",
              message: "Amina Bello 08000000101",
              retryable: false,
            },
          },
          { status: 409 },
        ),
      () => () => {},
    );
    await expect(denied.register(original)).rejects.toMatchObject({
      code: "phone_in_use",
      message: "This phone number already has an account.",
    });
    op.clear();
    expect(op.payload).toBeNull();
    expect(new ClientError("test", "safe").message).toBe("safe");
  });
});

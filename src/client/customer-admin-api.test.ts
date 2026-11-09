import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CustomerAdminApi,
  freezeCustomerChange,
  customerFile,
  pageQuery,
} from "./customer-admin-api";
import { AdminError } from "./admin-api";
afterEach(() => vi.unstubAllGlobals());
describe("customer/card protected transport", () => {
  it("rejects malformed and extra response fields", async () => {
    const request = vi.fn().mockResolvedValue({ id: "x", phone: "private" });
    await expect(
      new CustomerAdminApi(request).read(
        "customers/x",
        z.strictObject({ id: z.string() }),
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("freezes reviewed identity/body for an uncertain retry", async () => {
    const source = { name: "November", count: 4 };
    const change = freezeCustomerChange("card-batches", source);
    source.count = 8;
    const request = vi
      .fn()
      .mockRejectedValueOnce(new AdminError("network"))
      .mockResolvedValue({ ok: true });
    const api = new CustomerAdminApi(request);
    await expect(
      api.commit(change, z.strictObject({ ok: z.boolean() })),
    ).rejects.toMatchObject({ status: 0 });
    await api.commit(change, z.strictObject({ ok: z.boolean() }));
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
    expect(change.body.count).toBe(4);
    expect(Object.isFrozen(change.body)).toBe(true);
  });
  it("preserves filters and encodes opaque page cursors", () => {
    expect(pageQuery("cards", { state: "linked", cursor: "a+/=" })).toBe(
      "cards?state=linked&cursor=a%2B%2F%3D&limit=25",
    );
  });
  it("refuses JSON and wrong binary types", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{}", {
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(
      customerFile("b", "e", "pdf", () => true),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("fences bytes when the authority or route changes during fetch", async () => {
    let live = true;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        live = false;
        return new Response("%PDF-1.7", {
          headers: { "content-type": "application/pdf" },
        });
      }),
    );
    await expect(
      customerFile("b", "e", "pdf", () => live),
    ).rejects.toMatchObject({ code: "obsolete" });
  });
  it("passes safe error codes without handing out bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: "permission_denied" } }),
            { status: 403, headers: { "content-type": "application/json" } },
          ),
        ),
    );
    await expect(
      customerFile("b", "e", "pdf", () => true),
    ).rejects.toMatchObject({ code: "permission_denied", status: 403 });
  });
});
it("rejects a well-shaped receipt for a different batch or export format", async () => {
  const { cardExportSchema } =
    await import("../shared/contracts/customers-cards");
  const change = freezeCustomerChange(
    "card-batches/00000000-0000-7000-8000-000000000001/exports",
    { expectedVersion: 3, format: "pdf" },
  );
  const request = vi
    .fn()
    .mockResolvedValue({
      id: "00000000-0000-7000-8000-000000000003",
      batchId: "00000000-0000-7000-8000-000000000002",
      format: "xlsx",
      state: "pending",
      preparedAt: null,
      snapshotAt: "2026-11-09T10:00:00Z",
      batchStatus: "generated",
      batchVersion: 3,
      cardCount: "2",
      expiresAt: null,
      failure: null,
    });
  await expect(
    new CustomerAdminApi(request).commit(change, cardExportSchema),
  ).rejects.toMatchObject({ code: "invalid_response" });
});
it("rejects a binary signature masquerading as PDF and requires a final live check after body read", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("<html>private</html>", {
          headers: { "content-type": "application/pdf" },
        }),
      ),
  );
  await expect(customerFile("b", "e", "pdf", () => true)).rejects.toMatchObject(
    { code: "invalid_response" },
  );
  let live = true;
  const response = new Response("%PDF-1.7", {
    headers: { "content-type": "application/pdf" },
  });
  response.blob = async () => {
    live = false;
    return new Blob(["%PDF-1.7"]);
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  await expect(customerFile("b", "e", "pdf", () => live)).rejects.toMatchObject(
    { code: "obsolete" },
  );
});
it("validates binary bytes without inventing storage URLs and applies protected fetch options", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response("%PDF-1.7", {
        headers: { "content-type": "application/pdf" },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  expect(await (await customerFile("b", "e", "pdf", () => true)).text()).toBe(
    "%PDF-1.7",
  );
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
});
it("keeps the exact reviewed transition and export version on retries", async () => {
  for (const [path, body] of [
    [
      "card-batches/b/mark-printed",
      { expectedVersion: 2, reason: "Print job 7" },
    ],
    ["card-batches/b/exports", { expectedVersion: 2, format: "xlsx" }],
  ] as const) {
    const change = freezeCustomerChange(path, body);
    const request = vi
      .fn()
      .mockRejectedValueOnce(new AdminError("network"))
      .mockResolvedValue({ ok: true });
    const api = new CustomerAdminApi(request);
    await expect(
      api.commit(change, z.strictObject({ ok: z.boolean() })),
    ).rejects.toThrow();
    await api.commit(change, z.strictObject({ ok: z.boolean() }));
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
    expect(change.body.expectedVersion).toBe(2);
  }
});

import { describe, expect, it, vi } from "vitest";
import { AdminSalesApi, correctionDecisionRequest } from "./admin-sales-api";
import { AdminError, type adminRequest } from "./admin-api";
import { AdminSessionStore, type AdminSession } from "./admin-session";
const session: AdminSession = {
  state: "ready",
  account: {
    id: "018f0000-0000-7000-8000-000000000001",
    name: "Ada Williams",
    username: "ada",
  },
  permissions: ["sales", "corrections"],
};
describe("M3 sales transport", () => {
  it("uses exact customer filter and validates the whole filtered summary", async () => {
    const request = vi.fn(async () => ({
      items: [],
      nextCursor: null,
      asOf: "2026-11-11T00:00:00.000Z",
      summary: {
        records: "42",
        completed: "39",
        spend: [{ currency: "NGN", amountKobo: "9000000" }],
        quantities: [{ product: "pms", unit: "litre", quantity: "90" }],
      },
    }));
    const result = await new AdminSalesApi(
      request as typeof adminRequest,
    ).search({ customerId: session.account.id, status: "all", limit: 25 });
    expect(result.summary.records).toBe("42");
    expect(request).toHaveBeenCalledWith("sales/search", {
      customerId: session.account.id,
      status: "all",
      limit: 25,
    });
  });
  it("rejects malformed success instead of treating it as a failed mutation", async () => {
    const api = new AdminSalesApi(
      vi.fn(async () => ({ accepted: true })) as typeof adminRequest,
    );
    await expect(api.detail(session.account.id)).rejects.toMatchObject({
      code: "invalid_response",
      status: 200,
    });
  });
  it("rechecks a P-19 maker denial without discarding unchanged live authority", async () => {
    const store = new AdminSessionStore(
      vi.fn(async () => session) as typeof adminRequest,
    );
    store.adopt(session);
    const epoch = store.getSnapshot().epoch;
    const request = correctionDecisionRequest(
      store,
      vi.fn(async () => {
        throw new AdminError("permission_denied", 403);
      }) as typeof adminRequest,
    );
    await expect(
      request("sales/id/corrections/id/decision", {}, "POST"),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(store.getSnapshot().session).toEqual(session);
    expect(store.getSnapshot().epoch).toBe(epoch);
  });
  it("fences a maker-denied response when permissions actually changed", async () => {
    const store = new AdminSessionStore(
      vi.fn(async () => ({
        ...session,
        permissions: ["sales"],
      })) as typeof adminRequest,
    );
    store.adopt(session);
    const request = correctionDecisionRequest(
      store,
      vi.fn(async () => {
        throw new AdminError("permission_denied", 403);
      }) as typeof adminRequest,
    );
    await expect(
      request("sales/id/corrections/id/decision", {}, "POST"),
    ).rejects.toMatchObject({ code: "obsolete" });
    expect(store.getSnapshot().session?.permissions).toEqual(["sales"]);
  });
});

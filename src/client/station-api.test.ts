import { describe, expect, it, vi } from "vitest";
import {
  StationApi,
  priceInput,
  priceDisplay,
  freezeChange,
} from "./station-api";
import { z } from "zod";

describe("station client integrity", () => {
  it("uses exact positive kobo and rejects exponent, excess decimals and overflow", () => {
    expect(priceInput("1000.01")).toBe("100001");
    expect(priceDisplay("100001")).toBe("₦1,000.01");
    for (const input of ["0", "-1", "1e3", "1.001", "92233720368547758.08"])
      expect(() => priceInput(input)).toThrow();
  });
  it("freezes one operation identity and body independently of mutable editor state", () => {
    const draft = { reason: "Reviewed reason", expectedVersion: 2 };
    const receipt = freezeChange("pumps", draft);
    draft.reason = "Changed after review";
    expect(receipt.body.reason).toBe("Reviewed reason");
    expect(receipt.body.operationId).toMatch(/^[a-f0-9-]{36}$/);
    expect(Object.isFrozen(receipt.body)).toBe(true);
  });
  it("loads every picker page and refuses a repeated cursor instead of omitting choices", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: "a" }], nextCursor: "next" })
      .mockResolvedValueOnce({ items: [{ id: "b" }], nextCursor: null });
    const api = new StationApi(request);
    expect(await api.all("pumps", z.object({ id: z.string() }))).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
    expect(request.mock.calls[1]?.[0]).toBe("pumps?cursor=next&limit=100");
    request.mockResolvedValue({ items: [], nextCursor: "repeat" });
    await expect(
      api.all("pumps", z.object({ id: z.string() })),
    ).rejects.toThrow();
  });
  it("validates HTTP results and sends exactly the frozen key/body on uncertain retry", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ id: "applied" });
    const api = new StationApi(request),
      frozen = freezeChange("pumps", { name: "Pump 6", productCode: "pms" });
    const schema = z.object({ id: z.string() });
    await expect(api.commit(frozen, schema)).rejects.toThrow();
    expect(await api.commit(frozen, schema)).toEqual({ id: "applied" });
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
    request.mockResolvedValue({
      id: "applied",
      operationId: "another-operation",
    });
    await expect(
      api.commit(frozen, z.object({ id: z.string(), operationId: z.string() })),
    ).rejects.toThrow();
    request.mockResolvedValue({ wrong: "not a receipt" });
    await expect(api.read("pumps", schema)).rejects.toThrow();
  });
});

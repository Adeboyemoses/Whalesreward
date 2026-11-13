import { describe, expect, it, vi } from "vitest";
import {
  AdminAuditApi,
  auditValue,
  auditMessage,
  auditTitle,
  auditFieldLabel,
} from "./admin-audit";
import { AdminError, type adminRequest } from "./admin-api";
import type { AuditEvent } from "../shared/contracts/audit";
const event = {
  changes: [{ field: "unit", before: "litre", after: "kilogram" }],
} as AuditEvent;
describe("audit presentation boundary", () => {
  it("labels money values by display units in sentence case", () => {
    expect(auditFieldLabel("amountKobo")).toBe("Amount");
    expect(auditFieldLabel("rateKobo")).toBe("Captured unit price");
    expect(auditFieldLabel("creditedSpendKobo")).toBe("Credited spend");
    expect(auditFieldLabel("quantityPrecision")).toBe("Quantity precision");
  });
  it("preserves exact integer money beyond floating point precision", () => {
    expect(
      auditValue(
        event,
        { field: "amountKobo", before: null, after: "9007199254740993" },
        "after",
      ),
    ).toBe("₦90,071,992,547,409.93");
  });
  it("uses each historical side's unit and never guesses absent units", () => {
    const c = {
      field: "quantity",
      before: "12.345678",
      after: "12.345678",
    } as const;
    expect(auditValue(event, c, "before")).toBe("12.345678 litres");
    expect(auditValue(event, c, "after")).toBe("12.345678 kilograms");
    expect(
      auditValue({ changes: [] } as unknown as AuditEvent, c, "after"),
    ).toContain("unit not recorded");
  });
  it("formats trusted instants in Lagos and distinguishes absent from false", () => {
    expect(
      auditValue(
        event,
        { field: "effectiveFrom", before: null, after: "2026-11-12T23:42:00Z" },
        "after",
      ),
    ).toBe("13 Nov 2026 · 12:42 AM");
    expect(
      auditValue(
        event,
        { field: "phoneChanged", before: null, after: false },
        "before",
      ),
    ).toBe("Not recorded");
    expect(
      auditValue(
        event,
        { field: "phoneChanged", before: null, after: false },
        "after",
      ),
    ).toBe("No");
    expect(auditTitle({ action: "legacy_event" } as AuditEvent)).toBe(
      "older event, details not available",
    );
    expect(auditMessage(new AdminError("date_range_invalid", 422))).toContain(
      "From must be on or before To",
    );
  });
  it("validates read-only response projections before rendering", async () => {
    const request = vi.fn(async () => ({ items: [], nextCursor: null }));
    const api = new AdminAuditApi(request as typeof adminRequest);
    expect(await api.search({ limit: 6, area: "sales" })).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(request).toHaveBeenCalledWith("audit/search", {
      limit: 6,
      area: "sales",
    });
    request.mockResolvedValueOnce({
      items: [{ reason: "private raw payload" }],
      nextCursor: null,
    } as never);
    await expect(api.search({ limit: 6 })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});

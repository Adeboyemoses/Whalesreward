import { describe, expect, it, vi } from "vitest";
import {
  AdminReportsApi,
  validateReportDates,
  reportUncertain,
  reportMoney,
} from "./admin-reports-api";
import { AdminError, type adminRequest } from "./admin-api";
const filters = {
  from: "2026-11-14",
  to: "2026-11-14",
  product: null,
  groupBy: "product",
} as const;
const totals = {
  purchases: "0",
  spend: [],
  litres: "0",
  kilograms: "0",
  products: [],
};
const report = {
  filters,
  asOf: "2026-11-14T10:00:00Z",
  timezone: "Africa/Lagos",
  dataVersion: "42",
  totals,
  excluded: [],
  daily: [],
  groups: { items: [], nextCursor: null },
  dateBasis: "verified_or_reported_sale_date",
} as const;
const id = "019ab100-0000-7000-8000-000000000001";
const artifact = {
  id,
  format: "pdf",
  filters,
  sourceDataVersion: "42",
  snapshotAt: report.asOf,
  createdBy: { id, code: "ADMIN001", name: "Ada Williams" },
  state: "pending",
  preparedAt: null,
  expiresAt: null,
  byteSize: null,
  sha256: null,
  failureCode: null,
};
describe("admin report boundary", () => {
  it("validates actual inclusive Lagos days and a bounded range", () => {
    expect(validateReportDates("2026-11-14", "2026-11-14")).toBe("");
    for (const [from, to] of [
      ["", "2026-11-14"],
      ["2026-02-30", "2026-03-01"],
      ["2026-11-15", "2026-11-14"],
      ["2025-01-01", "2026-11-14"],
    ])
      expect(validateReportDates(from!, to!)).not.toBe("");
  });
  it("rejects a report with different filters or data generation", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({
        ...report,
        filters: { ...filters, product: "pms" },
      });
    const api = new AdminReportsApi(request as typeof adminRequest);
    await expect(api.query(filters)).rejects.toMatchObject({
      code: "invalid_response",
    });
    request.mockResolvedValue(report);
    await expect(api.query(filters, "41", "opaque")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
  it("rejects wrong source generation without exposing mixed rows", async () => {
    const api = new AdminReportsApi(
      vi
        .fn()
        .mockResolvedValue({
          items: [],
          nextCursor: null,
          asOf: report.asOf,
          dataVersion: "43",
        }) as typeof adminRequest,
    );
    await expect(api.sources(filters, "42")).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
  it("freezes exact viewed filters and generation across uncertain preparation retries", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new AdminError("network"))
      .mockResolvedValue(artifact);
    const api = new AdminReportsApi(request as typeof adminRequest);
    const frozen = api.freeze(report, "pdf");
    await expect(api.prepare(frozen)).rejects.toMatchObject({
      code: "network",
    });
    await api.prepare(frozen);
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
    expect(frozen.expectedDataVersion).toBe("42");
    expect(Object.isFrozen(frozen.filters)).toBe(true);
    expect(api.freeze(report, "pdf").operationId).not.toBe(frozen.operationId);
  });
  it("rejects export receipts for another view, format or export ID", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ ...artifact, sourceDataVersion: "41" });
    const api = new AdminReportsApi(request as typeof adminRequest);
    await expect(api.prepare(api.freeze(report, "pdf"))).rejects.toMatchObject({
      code: "invalid_response",
    });
    request.mockResolvedValue({
      ...artifact,
      id: "019ab100-0000-7000-8000-000000000002",
    });
    await expect(api.status(artifact as never)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
  it("does not retry terminal failed or expired policy responses", () => {
    expect(reportUncertain(new AdminError("export_failed", 409))).toBe(false);
    expect(reportUncertain(new AdminError("export_expired", 410))).toBe(false);
    expect(reportUncertain(new AdminError("network"))).toBe(true);
    expect(reportUncertain(new AdminError("rate_limited", 429))).toBe(true);
  });
  it("keeps aggregate precision and currencies distinct", () => {
    expect(
      reportMoney([
        { currency: "NGN", amountKobo: "999999999999999999999999999999" },
        { currency: "USD", amountKobo: "123" },
      ]),
    ).toBe("₦9,999,999,999,999,999,999,999,999,999.99 · USD 1.23");
    expect(reportMoney([])).toBe("No recorded spend");
  });
});

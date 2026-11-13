import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import {
  reportFilterSchema,
  reportQuerySchema,
  type ReportSource,
  type ReportSnapshot,
} from "../../../shared/contracts/reports";
import { validateFilter, totals, page, reportFromRows } from "./data";
import { excelNumber, renderReportExport, PrecisionError } from "./renderer";
const id = "019a47e0-0000-7000-8000-000000000001";
const filters = {
  from: "2026-11-01",
  to: "2026-11-30",
  product: null,
  groupBy: "product" as const,
};
const row: ReportSource = {
  purchaseId: id,
  saleCode: "S001",
  revisionId: id,
  saleDate: "2026-11-13",
  dateEvidence: "reported",
  appCapturedAt: "2026-11-13T10:00:00Z",
  verifiedSaleDate: null,
  serverReceivedAt: "2026-11-13T10:01:00Z",
  attendant: {
    id,
    staffCode: "STAFF001",
    name: '=WEBSERVICE("example.com")',
    username: "+SUM(1)",
  },
  pump: { id, code: "PUMP001", name: "@formula" },
  product: "pms",
  unit: "litre",
  amountKobo: "123456",
  currency: "NGN",
  quantity: "1.234567",
  state: "credited",
  included: true,
  exclusion: null,
  valuesSource: "accepted_revision",
  duplicateFlag: true,
  correctionPending: true,
};
const snapshot = (sources: ReportSource[] = [row]): ReportSnapshot => ({
  id,
  format: "xlsx",
  sources,
  report: reportFromRows(filters, "2026-11-13T11:00:00Z", "5", sources),
});
describe("reports strict bounds and exact arithmetic", () => {
  it("rejects nonexistent, reversed and excessive inclusive dates without truncation", () => {
    for (const [from, to, code] of [
      ["2026-02-29", "2026-03-01", "date_invalid"],
      ["2026-02-02", "2026-02-01", "date_range_invalid"],
      ["2024-01-01", "2025-01-01", "range_too_large"],
    ])
      expect(() =>
        validateFilter({ ...filters, from: from!, to: to! }),
      ).toThrow(expect.objectContaining({ code }));
    expect(() =>
      validateFilter({ ...filters, from: "2024-01-01", to: "2024-12-31" }),
    ).not.toThrow();
    expect(
      reportFilterSchema.safeParse({ ...filters, stationId: id }).success,
    ).toBe(false);
    expect(
      reportQuerySchema.safeParse({
        ...filters,
        expectedDataVersion: "9223372036854775808",
      }).success,
    ).toBe(false);
  });
  it("sums stored meter pairs exactly, separately by product currency and unit", () => {
    const value = totals([
      row,
      {
        ...row,
        product: "cooking_gas",
        unit: "kilogram",
        quantity: "9.999999",
        currency: "USD",
        amountKobo: "9223372036854775807",
      },
    ]);
    expect(value).toMatchObject({
      purchases: "2",
      litres: "1.234567",
      kilograms: "9.999999",
      spend: [
        { currency: "NGN", amountKobo: "123456" },
        { currency: "USD", amountKobo: "9223372036854775807" },
      ],
    });
    expect(() =>
      totals([{ ...row, amountKobo: "999999999999999999999999999999" }, row]),
    ).toThrow(expect.objectContaining({ code: "aggregate_overflow" }));
    expect(() =>
      totals([{ ...row, quantity: "999999999999999999999999.999999" }, row]),
    ).toThrow(expect.objectContaining({ code: "aggregate_overflow" }));
  });
  it("binds cursor to exact generation and scope and rejects tampering", () => {
    const p = page([1, 2, 3], 1, "secret", "scope", "2");
    expect(
      page([1, 2, 3], 1, "secret", "scope", "2", p.nextCursor!),
    ).toMatchObject({ items: [2] });
    expect(() =>
      page([1, 2], 1, "secret", "scope", "3", p.nextCursor!),
    ).toThrow(expect.objectContaining({ code: "read_view_stale" }));
    expect(() =>
      page([1, 2], 1, "secret", "other", "2", p.nextCursor!),
    ).toThrow(expect.objectContaining({ code: "invalid_request" }));
    expect(() =>
      page([1, 2], 1, "secret", "scope", "2", p.nextCursor! + "x"),
    ).toThrow(expect.objectContaining({ code: "invalid_request" }));
  });
  it("fails Excel decimal precision instead of rounding money or quantity", () => {
    for (const value of [
      "1234567890123456",
      "0.1234567890123456",
      "92233720368547758.07",
    ])
      expect(() => excelNumber(value)).toThrow(PrecisionError);
    for (const value of [
      "0",
      "1.234567",
      "123456789012345",
      "100000000000000000000",
      "123.4500",
    ])
      expect(() => excelNumber(value)).not.toThrow();
  });
  it("renders XLSX text as inert strings, includes excluded rows and stored exact pairs", async () => {
    const s = snapshot([row, { ...row, included: false, exclusion: "held" }]),
      out = await renderReportExport(s);
    const b = new ExcelJS.Workbook();
    await b.xlsx.load(Uint8Array.from(out.bytes).buffer);
    const source = b.getWorksheet("Source sales")!;
    expect(source.rowCount).toBe(3);
    expect(source.getCell("K2").value).toBe(row.attendant.name);
    expect(source.getCell("L2").value).toBe(row.attendant.username);
    expect(source.getCell("R2").value).toBe(1234.56);
    expect(source.getCell("T2").value).toBe(1.234567);
    expect(source.getCell("V3").value).toBe(false);
    for (const ws of b.worksheets)
      ws.eachRow((r) =>
        r.eachCell((c) => expect(c.type).not.toBe(ExcelJS.ValueType.Formula)),
      );
    await expect(
      renderReportExport(
        snapshot([{ ...row, amountKobo: "9223372036854775807" }]),
      ),
    ).rejects.toBeInstanceOf(PrecisionError);
  });
  it("renders full PDF groups across pages including wide and Unicode labels", async () => {
    const s = snapshot();
    s.format = "pdf";
    s.report.groups.items = Array.from({ length: 30 }, (_, i) => ({
      key: String(i),
      product: null,
      attendant: { ...row.attendant, name: "W".repeat(120) + " 漢字" },
      pump: null,
      totals: s.report.totals,
    }));
    const out = await renderReportExport(s);
    const pdf = await PDFDocument.load(out.bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(3);
    expect(out.contentType).toBe("application/pdf");
  });
});

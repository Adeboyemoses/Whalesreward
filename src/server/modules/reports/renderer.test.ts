import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { PDFDocument, PDFDict, PDFName } from "pdf-lib";
import type { ReportSource, ReportSnapshot } from "../../../shared/contracts/reports";
import { reportFromRows } from "./data";
import { renderReportExport, plural, SOURCE_TABLE_CAP } from "./renderer";

const id = "019a47e0-0000-7000-8000-000000000002";
const filters = {
  from: "2026-11-01",
  to: "2026-11-30",
  product: null,
  groupBy: "product" as const,
};
const row: ReportSource = {
  purchaseId: id,
  saleCode: "S001",
  revisionId: null,
  saleDate: "2026-11-13",
  dateEvidence: "verified",
  appCapturedAt: "2026-11-13T22:30:00Z",
  verifiedSaleDate: "2026-11-14",
  serverReceivedAt: "2026-11-13T23:00:00Z",
  attendant: {
    id,
    staffCode: "STAFF001",
    name: "Adebayo-Okonkwo-Chukwuemeka-Nnamdi-Olusegun",
    username: "staff1",
  },
  pump: { id, code: "PUMP001", name: "Pump 1" },
  product: "pms",
  unit: "litre",
  amountKobo: "16950000",
  currency: "NGN",
  quantity: "15.5",
  state: "credited",
  included: true,
  exclusion: null,
  valuesSource: "accepted_revision",
  duplicateFlag: true,
  correctionPending: false,
};
function snapshot(
  sources: ReportSource[],
  format: "pdf" | "xlsx" = "xlsx",
): ReportSnapshot {
  return {
    id,
    format,
    sources,
    report: reportFromRows(filters, "2026-11-13T11:00:00Z", "5", sources),
  };
}

describe("report export renderer — Stage 2 structure", () => {
  it("builds the four replacement XLSX sheets with bold frozen autofiltered headers", async () => {
    const out = await renderReportExport(snapshot([row], "xlsx"));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(out.bytes).buffer);
    expect(book.worksheets.map((w) => w.name)).toEqual([
      "Summary",
      "Daily",
      "Groups",
      "Source sales",
    ]);
    const daily = book.getWorksheet("Daily")!;
    expect(daily.getRow(1).font?.bold).toBe(true);
    expect(daily.autoFilter).toBeTruthy();
    expect(daily.views?.[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("splits Source sales Quantity into separate Litres and Kilograms columns, each unit exclusive", async () => {
    const gas: ReportSource = {
      ...row,
      purchaseId: id,
      unit: "kilogram",
      product: "cooking_gas",
      quantity: "12.5",
    };
    const out = await renderReportExport(snapshot([row, gas], "xlsx"));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(out.bytes).buffer);
    const sheet = book.getWorksheet("Source sales")!;
    const headers = sheet.getRow(1).values as string[];
    expect(headers).toContain("Litres");
    expect(headers).toContain("Kilograms");
    expect(headers).not.toContain("Unit");
    const litresCol = (headers as string[]).indexOf("Litres"),
      kilogramsCol = (headers as string[]).indexOf("Kilograms");
    expect(sheet.getRow(2).getCell(litresCol).value).toBe(15.5);
    expect(sheet.getRow(2).getCell(kilogramsCol).value).toBe(0);
    expect(sheet.getRow(3).getCell(litresCol).value).toBe(0);
    expect(sheet.getRow(3).getCell(kilogramsCol).value).toBe(12.5);
  });

  it("writes real Date cells for calendar days and Lagos-shifted instants, round-tripping through ExcelJS", async () => {
    const out = await renderReportExport(snapshot([row], "xlsx"));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(out.bytes).buffer);
    const sheet = book.getWorksheet("Source sales")!;
    const saleDate = sheet.getRow(2).getCell(4).value as Date;
    expect(saleDate instanceof Date).toBe(true);
    expect(saleDate.toISOString()).toBe("2026-11-13T00:00:00.000Z");
    // appCapturedAt 2026-11-13T22:30:00Z + 1h Lagos shift = 2026-11-13T23:30 UTC getters.
    const appCapturedAt = sheet.getRow(2).getCell(6).value as Date;
    expect(appCapturedAt.getUTCHours()).toBe(23);
    expect(appCapturedAt.getUTCMinutes()).toBe(30);
    expect(appCapturedAt.getUTCDate()).toBe(13);
  });

  it("formats NGN money with a literal naira sign and non-NGN with a code prefix", async () => {
    const out = await renderReportExport(snapshot([row], "xlsx"));
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(out.bytes).buffer);
    const sheet = book.getWorksheet("Source sales")!;
    const headers = sheet.getRow(1).values as string[];
    const amountCol = (headers as string[]).indexOf("Amount");
    expect(sheet.getRow(2).getCell(amountCol).numFmt).toBe('"₦"#,##0.00');
    const usd: ReportSource = { ...row, currency: "USD" };
    const out2 = await renderReportExport(snapshot([usd], "xlsx"));
    const book2 = new ExcelJS.Workbook();
    await book2.xlsx.load(Uint8Array.from(out2.bytes).buffer);
    const sheet2 = book2.getWorksheet("Source sales")!;
    expect(sheet2.getRow(2).getCell(amountCol).numFmt).toBe('"USD "#,##0.00');
  });

  it("uses '1 record' / '1 purchase' singular, never the plural, for a count of one", () => {
    expect(plural("1", "purchase")).toBe("1 purchase");
    expect(plural("1", "record")).toBe("1 record");
    expect(plural("1", "sale")).toBe("1 sale");
    expect(plural("2", "purchase")).toBe("2 purchases");
    expect(plural("0", "record")).toBe("0 records");
  });

  it("embeds the Noto Sans font (not StandardFonts.Helvetica) in the PDF", async () => {
    const out = await renderReportExport(snapshot([row], "pdf"));
    expect(out.contentType).toBe("application/pdf");
    const pdf = await PDFDocument.load(out.bytes);
    const baseFonts: string[] = [];
    for (const [, obj] of pdf.context.enumerateIndirectObjects())
      if (obj instanceof PDFDict) {
        const baseFont = obj.get(PDFName.of("BaseFont"));
        if (baseFont) baseFonts.push(baseFont.toString());
      }
    expect(baseFonts.some((f) => f.includes("NotoSans"))).toBe(true);
    expect(baseFonts.some((f) => f.includes("Helvetica"))).toBe(false);
  });

  it(
    "caps the PDF source sales table at 500 rows, printing a one-line count instead above the cap",
    async () => {
      expect(SOURCE_TABLE_CAP).toBe(500);
      const rowsAt = (n: number): ReportSource[] =>
        Array.from({ length: n }, (_, i) => ({
          ...row,
          purchaseId: id,
          saleCode: `S${String(i).padStart(4, "0")}`,
        }));
      const atCap = await renderReportExport(snapshot(rowsAt(SOURCE_TABLE_CAP), "pdf")),
        overCap = await renderReportExport(snapshot(rowsAt(SOURCE_TABLE_CAP + 1), "pdf"));
      const atCapPages = (await PDFDocument.load(atCap.bytes)).getPageCount(),
        overCapPages = (await PDFDocument.load(overCap.bytes)).getPageCount();
      // One row over the cap drops the whole per-row table for a single summary
      // line, so the page count falls sharply instead of growing by one row.
      expect(atCapPages).toBeGreaterThan(5);
      expect(overCapPages).toBeLessThan(atCapPages);
    },
    // Rendering two 500+ row PDFs under a loaded, parallel CI runner can
    // exceed vitest's 5s default harness timeout well before the assertion
    // even runs; give it the same generous headroom renderer-pdf-text.test.ts
    // uses for comparable non-trivial renders.
    20000,
  );

  it("renders a long run-on name without overflowing by hard-breaking it inside its column", async () => {
    const wide: ReportSource = {
      ...row,
      attendant: { ...row.attendant, name: "W".repeat(200) },
    };
    const out = await renderReportExport(snapshot([wide], "pdf"));
    const pdf = await PDFDocument.load(out.bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    // pdf-lib can only confirm the document parses; it is not CMap-aware,
    // so it cannot read the hard-broken name's actual drawn text or
    // position (pdf-lib's own font is subsetted by glyph ID — see
    // renderer-pdf-text.test.ts's doc comment). The real proof that each
    // wrapped line actually stays inside the Attendant / pump column, and
    // never bleeds into Product, is the x-extent assertion in
    // renderer-pdf-text.test.ts ("keeps a long run-on attendant name's
    // hard-broken lines inside the Attendant / pump column's x-range").
  });

  it("WHR-239 I-defect: shows the display label ('PMS'/'Diesel'/'Cooking gas'), never the bare product enum code, in the Groups sheet when grouped by product", async () => {
    const pmsRow = row;
    const dieselRow: ReportSource = { ...row, purchaseId: id, saleCode: "S002", product: "diesel", unit: "litre" };
    const keroseneRow: ReportSource = { ...row, purchaseId: id, saleCode: "S003", product: "kerosene", unit: "litre" };
    const gasRow: ReportSource = {
      ...row,
      purchaseId: id,
      saleCode: "S004",
      product: "cooking_gas",
      unit: "kilogram",
      quantity: "12.5",
    };
    const sources = [pmsRow, dieselRow, keroseneRow, gasRow];
    const productFilters = { ...filters, groupBy: "product" as const };
    const out = await renderReportExport({
      id,
      format: "xlsx",
      sources,
      report: reportFromRows(productFilters, "2026-11-13T11:00:00Z", "5", sources),
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(out.bytes).buffer);

    // Raw enum codes that must always be display-mapped before they reach a
    // cell. "kerosene" is deliberately excluded: its label ("Kerosene") and
    // raw code differ only by case, so it proves nothing either way here.
    const RAW_PRODUCT_CODES = ["pms", "diesel", "cooking_gas"];
    const bareStringValues = (sheet: ExcelJS.Worksheet): string[] => {
      const values: string[] = [];
      sheet.eachRow((r) =>
        r.eachCell((c) => {
          if (typeof c.value === "string") values.push(c.value);
        }),
      );
      return values;
    };

    for (const sheetName of ["Summary", "Daily", "Groups", "Source sales"] as const) {
      const sheet = book.getWorksheet(sheetName)!;
      const values = bareStringValues(sheet);
      for (const raw of RAW_PRODUCT_CODES)
        expect(values, `${sheetName} sheet must never show the bare code "${raw}"`).not.toContain(raw);
    }

    const groupsSheet = book.getWorksheet("Groups")!;
    const groupLabels = (groupsSheet.getColumn(1).values as unknown[]).filter(
      (v): v is string => typeof v === "string",
    );
    expect(groupLabels).toContain("PMS");
    expect(groupLabels).toContain("Diesel");
    expect(groupLabels).toContain("Cooking gas");
  });

  it("WHR-239 round 2: shows the display label, never the bare product enum code, in the Summary sheet's Product filter row when a product filter is set", async () => {
    const productFilters = { ...filters, product: "cooking_gas" as const };
    const sources = [{ ...row, product: "cooking_gas" as const, unit: "kilogram" as const, quantity: "12.5" }];
    const out = await renderReportExport({
      id,
      format: "xlsx",
      sources,
      report: reportFromRows(productFilters, "2026-11-13T11:00:00Z", "5", sources),
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(out.bytes).buffer);
    const sheet = book.getWorksheet("Summary")!;
    let productFilterValue: unknown;
    sheet.eachRow((r) => {
      if (r.getCell(1).value === "Product filter") productFilterValue = r.getCell(2).value;
    });
    expect(productFilterValue).toBe("Cooking gas");
  });

  it(
    "completes well within the 5s cardStorageDeadline budget at the sources limit",
    async () => {
      const many: ReportSource[] = Array.from({ length: 5000 }, (_, i) => ({
        ...row,
        purchaseId: id,
        saleCode: `S${i}`,
      }));
      const start = Date.now();
      await renderReportExport(snapshot(many, "xlsx"));
      expect(Date.now() - start).toBeLessThan(5000);
    },
    20000,
  );
});

describe("Dockerfile ships the vendored report fonts into the runtime image", () => {
  it("copies src in the build stage and the fonts path in the runtime stage (static content check — no docker build runs in CI)", () => {
    const dockerfile = fs.readFileSync(
      path.join(process.cwd(), "Dockerfile"),
      "utf8",
    );
    expect(dockerfile).toMatch(/FROM dependencies AS build[\s\S]*?COPY src \.\/src/);
    expect(dockerfile).toMatch(
      /FROM base AS runtime[\s\S]*?COPY --from=build --chown=node:node \/app\/src\/server\/modules\/reports\/fonts \.\/src\/server\/modules\/reports\/fonts/,
    );
  });
});

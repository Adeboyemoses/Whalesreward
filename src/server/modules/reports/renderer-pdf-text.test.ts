import { describe, it, expect } from "vitest";
import type { ReportSource, ReportSnapshot } from "../../../shared/contracts/reports";
import { reportFromRows } from "./data";
import { renderReportExport, SOURCE_TABLE_CAP } from "./renderer";

/**
 * pdf-lib's subsetted embedded TrueType font encodes the content stream by
 * glyph ID, not literal ASCII bytes, so a naive raw-byte search over the PDF
 * never finds the real rendered text. pdf-lib does still emit a ToUnicode
 * CMap for the subset, and pdfjs-dist's legacy Node build is CMap-aware, so
 * `getTextContent()` recovers the actual rendered string. Verified
 * empirically during development (see WHR-231 Stage 2 test-engineer report):
 * extraction below reproduces headings, the literal ₦ sign, page footers and
 * table bodies exactly as drawn.
 */
async function loadPdfJsDocument(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = await import.meta.resolve(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
  );
  return pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    disableFontFace: true,
  }).promise;
}
async function extractPages(bytes: Uint8Array): Promise<string[]> {
  const doc = await loadPdfJsDocument(bytes);
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
    );
  }
  return pages;
}
async function extractText(bytes: Uint8Array): Promise<string> {
  return (await extractPages(bytes)).join("\n");
}

/** Per-item geometry (not just joined strings), for proving a drawn cell's
 * text never crosses its column's x-boundary. `transform[4]`/`transform[5]`
 * are the item's drawn x/y origin; `width` is the drawn width of that text
 * run — both already in the same unit-space as the PDF page (595.28 x
 * 841.89 pt, see renderer.ts's PAGE_WIDTH/PAGE_HEIGHT), so no viewport
 * scaling is needed since `getTextContent()` is called with no viewport. */
type PositionedItem = { str: string; x: number; y: number; width: number };
async function extractItemsPerPage(bytes: Uint8Array): Promise<PositionedItem[][]> {
  const doc = await loadPdfJsDocument(bytes);
  const pages: PositionedItem[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .filter((item): item is typeof item & { str: string; transform: number[]; width: number } =>
          "str" in item,
        )
        .map((item) => ({
          str: item.str,
          x: item.transform[4]!,
          y: item.transform[5]!,
          width: item.width,
        })),
    );
  }
  return pages;
}

/** Source sales table column layout, copied from renderer.ts's `columns`
 * array in `renderPdf` (Source sales section) so tests can compute each
 * column's x-range independently of the renderer's own internals. Keep this
 * in sync by inspection whenever that layout changes — a mismatch would
 * show up immediately as a spurious failure here, never a silent gap,
 * because the per-row width-sum invariant in `drawTable` already throws if
 * the columns stop filling the page exactly. */
const SOURCE_SALES_COLUMNS: { header: string; width: number }[] = [
  { header: "Sale code", width: 50 },
  { header: "Date", width: 55 },
  { header: "Evidence", width: 50 },
  { header: "Attendant / pump", width: 75 },
  { header: "Product", width: 45 },
  { header: "Amount", width: 85 },
  { header: "Quantity", width: 60 },
  { header: "Status", width: 65 },
  { header: "Flags", width: 30 },
];
function sourceSalesColumnBounds(): Record<string, { left: number; right: number }> {
  const bounds: Record<string, { left: number; right: number }> = {};
  let x = 40; // MARGIN in renderer.ts
  for (const c of SOURCE_SALES_COLUMNS) {
    bounds[c.header] = { left: x, right: x + c.width };
    x += c.width;
  }
  return bounds;
}

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
const reportedRow: ReportSource = {
  ...row,
  purchaseId: id,
  saleCode: "S002",
  dateEvidence: "reported",
  verifiedSaleDate: null,
  correctionPending: true,
  duplicateFlag: false,
};
function snapshot(sources: ReportSource[]): ReportSnapshot {
  return {
    id,
    format: "pdf",
    sources,
    report: reportFromRows(filters, "2026-11-13T11:00:00Z", "5", sources),
  };
}

describe("report export renderer — PDF real text extraction (pdfjs-dist, CMap-aware)", () => {
  it("renders the Whales Rewards headings, totals numbers and the literal naira sign through the embedded-font CMap", async () => {
    const out = await renderReportExport(snapshot([row]));
    const text = await extractText(out.bytes);
    expect(text).toContain("Whales Rewards");
    expect(text).toContain("Summary");
    expect(text).toContain("Daily");
    expect(text).toContain("Groups");
    expect(text).toContain("Source sales");
    // The one NGN amount in this fixture, with the real ₦ glyph.
    expect(text).toContain("₦169,500.00");
    // Totals snapshotted directly from the fixture: 1 purchase, 15.5 litres.
    expect(text).toContain("1 purchase");
    expect(text).toContain("15.5 litres");
  });

  it("shows the full words 'Verified'/'Reported' and the Dup/Corr legend in the source-sales table when under the cap", async () => {
    const out = await renderReportExport(snapshot([row, reportedRow]));
    const text = await extractText(out.bytes);
    expect(text).toContain("Verified");
    expect(text).toContain("Reported");
    expect(text).toContain("Dup = duplicate flag · Corr = correction pending");
  });

  it(
    "prints 'Page 1 of N' on the first page and 'Page N of N' on the last page, incrementing across a multi-page source table",
    async () => {
      const rows: ReportSource[] = Array.from(
        { length: SOURCE_TABLE_CAP },
        (_, i) => ({ ...row, purchaseId: id, saleCode: `S${String(i).padStart(4, "0")}` }),
      );
      const out = await renderReportExport(snapshot(rows));
      const pages = await extractPages(out.bytes);
      expect(pages.length).toBeGreaterThan(5);
      expect(pages[0]).toContain(`Page 1 of ${pages.length}`);
      expect(pages[pages.length - 1]).toContain(
        `Page ${pages.length} of ${pages.length}`,
      );
      // No page repeats another page's footer number.
      const footers = pages.map((p, i) => p.includes(`Page ${i + 1} of ${pages.length}`));
      expect(footers.every(Boolean)).toBe(true);
    },
    // Rendering and parsing a ~500-row, multi-page PDF is real CPU work;
    // give it headroom beyond the 5s default test timeout under parallel
    // suite load rather than racing the default.
    20000,
  );

  it(
    "prints the over-cap sale count and 'Excel export' wording verbatim, and never renders the per-row source table beyond the cap",
    async () => {
      const rows: ReportSource[] = Array.from(
        { length: SOURCE_TABLE_CAP + 1 },
        (_, i) => ({ ...row, purchaseId: id, saleCode: `S${String(i).padStart(4, "0")}` }),
      );
      const out = await renderReportExport(snapshot(rows));
      const text = await extractText(out.bytes);
      expect(text).toContain(
        `${SOURCE_TABLE_CAP + 1} sales in this report. Every sale is included in the Excel export.`,
      );
      // The per-row table is entirely absent above the cap: none of the
      // generated sale codes appear, and neither does its legend line.
      expect(text).not.toContain("S0500");
      expect(text).not.toContain("Dup = duplicate flag · Corr = correction pending");
    },
    15000,
  );

  it(
    "repeats the Source sales table header ('Sale code') on every continuation page the table spans, not just the first",
    async () => {
      const rows: ReportSource[] = Array.from(
        { length: SOURCE_TABLE_CAP },
        (_, i) => ({ ...row, purchaseId: id, saleCode: `S${String(i).padStart(4, "0")}` }),
      );
      const out = await renderReportExport(snapshot(rows));
      const pages = await extractPages(out.bytes);
      // Pages carrying the table's own row data (identified by a generated
      // sale code, e.g. "S0123" — distinct from the literal header text
      // "Sale code", which has no digits).
      const tableDataPages = pages
        .map((p, i) => (/\bS0\d{3}\b/.test(p) ? i : -1))
        .filter((i) => i >= 0);
      expect(tableDataPages.length).toBeGreaterThan(1);
      for (const i of tableDataPages) expect(pages[i]).toContain("Sale code");
    },
    20000,
  );

  it(
    "repeats the Daily table header ('Recorded spend') on every page it spans, for a report with one row per day across a 366-day range",
    async () => {
      const days: ReportSource[] = Array.from({ length: 366 }, (_, i) => {
        const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000);
        const day = d.toISOString().slice(0, 10);
        return { ...row, purchaseId: id, saleCode: `D${String(i).padStart(4, "0")}`, saleDate: day, verifiedSaleDate: day };
      });
      const out = await renderReportExport(snapshot(days));
      const pages = await extractPages(out.bytes);
      // The Daily table's own header set ("Purchases", "Litres",
      // "Kilograms" together) also appears on the Groups table's pages
      // ("Attendant staff code") and would collide with the Source sales
      // table's own date text ("2025") — excluding both keeps this to
      // Daily-table pages only.
      const dailyDataPages = pages
        .map((p, i) =>
          p.includes("Purchases") &&
          p.includes("Litres") &&
          p.includes("Kilograms") &&
          !p.includes("Attendant staff") &&
          !p.includes("Sale code")
            ? i
            : -1,
        )
        .filter((i) => i >= 0);
      expect(dailyDataPages.length).toBeGreaterThan(1);
      for (const i of dailyDataPages) expect(pages[i]).toContain("Recorded spend");
    },
    20000,
  );

  it("keeps a long run-on attendant name's hard-broken lines inside the Attendant / pump column's x-range, never crossing into Product", async () => {
    const wide: ReportSource = { ...row, attendant: { ...row.attendant, name: "W".repeat(200) } };
    const out = await renderReportExport(snapshot([wide]));
    const pages = await extractItemsPerPage(out.bytes);
    // The "Attendant / pump" header itself hard-wraps onto two lines
    // ("Attendant /" then "pump"), so match on its first line.
    const page = pages.find((items) => items.some((it) => it.str === "Attendant /"));
    expect(page).toBeTruthy();
    const col = sourceSalesColumnBounds()["Attendant / pump"]!;
    const wrappedNameLines = page!.filter((it) => /^W+$/.test(it.str));
    // The 200-character run-on name must actually have been hard-broken
    // into more than one line, or this proves nothing.
    expect(wrappedNameLines.length).toBeGreaterThan(1);
    for (const it of wrappedNameLines) {
      expect(it.x).toBeGreaterThanOrEqual(col.left);
      expect(it.x + it.width).toBeLessThanOrEqual(col.right);
    }
  });

  it("keeps a large intact formatted amount inside the Amount column's x-range as a single unbroken text item", async () => {
    // A large, plausible bulk diesel sale: ₦50,000,000.00 (within the
    // `amount` contract's kobo regex, src/shared/contracts/reports.ts).
    const bulk: ReportSource = { ...row, amountKobo: "5000000000" };
    const out = await renderReportExport(snapshot([bulk]));
    // pdfjs-dist's Node transport detaches the passed buffer on load, so a
    // second independent load needs its own copy of the bytes.
    const text = await extractText(new Uint8Array(out.bytes));
    expect(text).toContain("₦50,000,000.00");
    const pages = await extractItemsPerPage(new Uint8Array(out.bytes));
    const page = pages.find((items) => items.some((it) => it.str === "Amount"));
    expect(page).toBeTruthy();
    const col = sourceSalesColumnBounds().Amount!;
    // This fixture's single row is small enough that Summary, Daily,
    // Groups and Source sales all land on the same page, and the Daily
    // and Groups tables print the same formatted amount in their own
    // "Recorded spend" columns — so isolate to items actually inside the
    // Source sales table's Amount column x-range before counting.
    const amountItemsInColumn = page!.filter(
      (it) => it.str === "₦50,000,000.00" && it.x >= col.left - 1 && it.x + it.width <= col.right + 1,
    );
    // Rendered as exactly one text item in that column — never split
    // across two lines.
    expect(amountItemsInColumn.length).toBe(1);
    const it = amountItemsInColumn[0]!;
    expect(it.x).toBeGreaterThanOrEqual(col.left);
    expect(it.x + it.width).toBeLessThanOrEqual(col.right);
  });

  it("shows the friendly 'Cooking gas' product label in the Groups table, never the raw 'cooking_gas' enum value, document-wide", async () => {
    const gas: ReportSource = { ...row, product: "cooking_gas", unit: "kilogram" };
    const gasFilters = { ...filters, groupBy: "product" as const, product: "cooking_gas" as const };
    const gasSnapshot: ReportSnapshot = {
      id,
      format: "pdf",
      sources: [gas],
      report: reportFromRows(gasFilters, "2026-11-13T11:00:00Z", "5", [gas]),
    };
    const out = await renderReportExport(gasSnapshot);
    const text = await extractText(out.bytes);
    expect(text).toContain("Cooking gas");
    expect(text).not.toContain("cooking_gas");
  });
});

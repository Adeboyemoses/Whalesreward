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
async function extractPages(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = await import.meta.resolve(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
  );
  const doc = await pdfjs.getDocument({
    data: bytes,
    useWorkerFetch: false,
    disableFontFace: true,
  }).promise;
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
});

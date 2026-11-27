import { describe, it, expect } from "vitest";
import type { ReportSource, ReportSnapshot } from "../../../shared/contracts/reports";
import { REPORT_LIMITS } from "../../../shared/contracts/reports";
import { CARD_STORAGE_TIMEOUT_MS } from "../../adapters/card-storage-deadline";
import { reportFromRows } from "./data";
import { renderReportExport, SOURCE_TABLE_CAP } from "./renderer";

const id = "019a47e0-0000-7000-8000-000000000002";
const BUDGET = CARD_STORAGE_TIMEOUT_MS;
// Real margin, not a cut-it-at-the-limit assertion: clears 80% of the
// enforced wall-clock budget that `exports.ts` wraps the renderer in via
// `cardStorageDeadline` (src/server/adapters/card-storage-deadline.ts).
const COMFORTABLE = BUDGET * 0.8;

function dayPlus(start: string, n: number): string {
  const d = new Date(start + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const PRODUCTS = ["pms", "diesel", "kerosene", "cooking_gas"] as const;
// A genuinely long, hyphenated, run-on name — the worst case for the PDF
// column wrapper (wrapWord hard-breaks it character by character).
const LONG_NAME =
  "Chukwuemeka-Olanrewaju-Babatunde-Adewale-Oyelaran-Ikechukwu-Folarin-Adebisi-Oluwaseun-Abiodun-Temidayo";

function makeRow(i: number): ReportSource {
  const day = dayPlus("2026-01-01", i % REPORT_LIMITS.days);
  return {
    purchaseId: id,
    saleCode: `S${String(i).padStart(6, "0")}`,
    revisionId: null,
    saleDate: day,
    dateEvidence: "reported",
    appCapturedAt: `${day}T10:00:00Z`,
    verifiedSaleDate: null,
    serverReceivedAt: `${day}T10:05:00Z`,
    attendant: {
      id,
      staffCode: "STAFF001",
      name: i === 0 ? LONG_NAME : "Adebayo Okon",
      username: "staff1",
    },
    pump: { id, code: "PUMP001", name: "Pump 1" },
    product: PRODUCTS[i % PRODUCTS.length]!,
    unit: i % 2 === 0 ? "litre" : "kilogram",
    amountKobo: String(1000 + i),
    currency: "NGN",
    quantity: "15.5",
    state: "credited",
    included: true,
    exclusion: null,
    valuesSource: "original",
    duplicateFlag: false,
    correctionPending: false,
  };
}
function snapshotOf(
  sources: ReportSource[],
  format: "pdf" | "xlsx",
  days: number,
): ReportSnapshot {
  const filters = {
    from: "2026-01-01",
    to: dayPlus("2026-01-01", days - 1),
    product: null,
    groupBy: "product" as const,
  };
  return {
    id,
    format,
    sources,
    report: reportFromRows(filters, "2026-11-13T11:00:00Z", "5", sources),
  };
}

describe("Earl's worst-case export render-time bound (WHR-231, 27 Nov 2026 approval comment)", () => {
  // "Prove a worst-case export (366 days, 500 listed sales, long names)
  // renders within the export lease time." — the real enforced bound for
  // the renderer is the 5s cardStorageDeadline wrapping it in exports.ts,
  // not the 60s REPORT_LIMITS.leaseMs.
  it("renders the worst-case 366-day, 500-sale, long-name PDF comfortably within the cardStorageDeadline budget", async () => {
    const rows = Array.from({ length: SOURCE_TABLE_CAP }, (_, i) => makeRow(i));
    const snapshot = snapshotOf(rows, "pdf", REPORT_LIMITS.days);
    expect(snapshot.report.daily).toHaveLength(REPORT_LIMITS.days);
    const start = Date.now();
    await renderReportExport(snapshot);
    expect(Date.now() - start).toBeLessThan(COMFORTABLE);
  }, 30000);

  it("renders the same worst-case 366-day, 500-sale, long-name XLSX comfortably within the cardStorageDeadline budget", async () => {
    const rows = Array.from({ length: SOURCE_TABLE_CAP }, (_, i) => makeRow(i));
    const snapshot = snapshotOf(rows, "xlsx", REPORT_LIMITS.days);
    expect(snapshot.report.daily).toHaveLength(REPORT_LIMITS.days);
    const start = Date.now();
    await renderReportExport(snapshot);
    expect(Date.now() - start).toBeLessThan(COMFORTABLE);
  }, 30000);
});

describe("XLSX timing at the real structural ceiling (REPORT_LIMITS.sources, not just the 5000-row smoke test)", () => {
  it(
    `renders ${REPORT_LIMITS.sources} source rows (the real export ceiling) within the cardStorageDeadline budget`,
    async () => {
      const rows = Array.from({ length: REPORT_LIMITS.sources }, (_, i) =>
        makeRow(i),
      );
      const snapshot = snapshotOf(rows, "xlsx", REPORT_LIMITS.days);
      const start = Date.now();
      await renderReportExport(snapshot);
      expect(Date.now() - start).toBeLessThan(COMFORTABLE);
    },
    60000,
  );
});

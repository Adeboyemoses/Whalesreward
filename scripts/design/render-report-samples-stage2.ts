// Stage 2 evidence for WHR-231 (WO-core-13b): regenerates docs/design/samples/
// report-sample.pdf and report-sample.xlsx by calling the real, production
// renderReportExport (src/server/modules/reports/renderer.ts) against the
// same fictional ReportSnapshot the Stage 1 brief used for its mockup. These
// replace the Stage 1 brief's hand-drawn mockup samples with the actual
// Stage 2 renderer's output, per the work order's "attach a fresh sample PDF
// and XLSX to the PR" instruction.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReportSnapshot, Totals } from "../../src/shared/contracts/reports";
import { renderReportExport } from "../../src/server/modules/reports/renderer";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../../docs/design/samples");
mkdirSync(outDir, { recursive: true });

function totals(
  purchases: string,
  nairaKobo: string,
  litres: string,
  kilograms: string,
  products: Totals["products"],
): Totals {
  return {
    purchases,
    spend: nairaKobo === "0" ? [] : [{ currency: "NGN", amountKobo: nairaKobo }],
    litres,
    kilograms,
    products,
  };
}

const report: ReportSnapshot["report"] = {
  filters: { from: "2026-10-27", to: "2026-11-02", product: null, groupBy: "product" },
  asOf: "2026-11-02T22:59:59+01:00",
  timezone: "Africa/Lagos",
  dataVersion: "184203",
  totals: totals("13", "16950000", "135", "20", [
    { product: "pms", unit: "litre", quantity: "90" },
    { product: "diesel", unit: "litre", quantity: "30" },
    { product: "kerosene", unit: "litre", quantity: "15" },
    { product: "cooking_gas", unit: "kilogram", quantity: "20" },
  ]),
  excluded: [
    { state: "cancelled", records: "2", spend: [{ currency: "NGN", amountKobo: "1400000" }] },
    { state: "held", records: "1", spend: [{ currency: "NGN", amountKobo: "1500000" }] },
    { state: "pending", records: "2", spend: [{ currency: "NGN", amountKobo: "1700000" }] },
    { state: "ineligible", records: "0", spend: [] },
  ],
  daily: [
    { day: "2026-10-27", totals: totals("3", "2900000", "27", "0", []) },
    { day: "2026-10-28", totals: totals("2", "3400000", "30", "0", []) },
    { day: "2026-10-29", totals: totals("2", "900000", "9", "0", []) },
    { day: "2026-10-30", totals: totals("1", "2100000", "18", "0", []) },
    { day: "2026-10-31", totals: totals("1", "2000000", "17", "0", []) },
    { day: "2026-11-01", totals: totals("2", "2950000", "22", "0", []) },
    { day: "2026-11-02", totals: totals("2", "2700000", "12", "20", []) },
  ],
  groups: {
    items: [
      { key: "pms", product: "pms", attendant: null, pump: null, totals: totals("6", "9000000", "90", "0", []) },
      { key: "diesel", product: "diesel", attendant: null, pump: null, totals: totals("2", "3600000", "30", "0", []) },
      { key: "cooking_gas", product: "cooking_gas", attendant: null, pump: null, totals: totals("3", "3000000", "0", "20", []) },
      { key: "kerosene", product: "kerosene", attendant: null, pump: null, totals: totals("2", "1350000", "15", "0", []) },
    ],
    nextCursor: null,
  },
  dateBasis: "verified_or_reported_sale_date",
};

const sources: ReportSnapshot["sources"] = [
  {
    purchaseId: "018f0000-0000-7000-8000-000000000001",
    saleCode: "SAL-00231",
    revisionId: null,
    saleDate: "2026-10-27",
    dateEvidence: "verified",
    appCapturedAt: "2026-10-27T08:12:00+01:00",
    verifiedSaleDate: "2026-10-27",
    serverReceivedAt: "2026-10-27T08:12:31+01:00",
    attendant: {
      id: "018f0000-0000-7000-8000-00000000a001",
      staffCode: "ST-014",
      name: "Chukwuemeka Okonkwo-Adeyinka-Babangida",
      username: "c.okonkwo",
    },
    pump: { id: "018f0000-0000-7000-8000-00000000b001", code: "PMP-02", name: "Pump 2" },
    product: "pms",
    unit: "litre",
    amountKobo: "1500000",
    currency: "NGN",
    quantity: "15",
    state: "credited",
    included: true,
    exclusion: null,
    valuesSource: "original",
    duplicateFlag: false,
    correctionPending: false,
  },
  {
    purchaseId: "018f0000-0000-7000-8000-000000000002",
    saleCode: "SAL-00245",
    revisionId: null,
    saleDate: "2026-11-02",
    dateEvidence: "reported",
    appCapturedAt: "2026-11-02T17:40:00+01:00",
    verifiedSaleDate: null,
    serverReceivedAt: "2026-11-02T17:41:05+01:00",
    attendant: {
      id: "018f0000-0000-7000-8000-00000000a002",
      staffCode: "ST-009",
      name: "Ngozi Adaeze",
      username: "n.adaeze",
    },
    pump: { id: "018f0000-0000-7000-8000-00000000b002", code: "PMP-04", name: "Pump 4 (cooking gas)" },
    product: "cooking_gas",
    unit: "kilogram",
    amountKobo: "1500000",
    currency: "NGN",
    quantity: "10",
    state: "held",
    included: false,
    exclusion: "held",
    valuesSource: "original",
    duplicateFlag: true,
    correctionPending: false,
  },
];

const pdf = await renderReportExport({ id: "RPT-7f2e9c-SAMPLE", format: "pdf", report, sources });
writeFileSync(join(outDir, "report-sample.pdf"), pdf.bytes);
const xlsx = await renderReportExport({ id: "RPT-7f2e9c-SAMPLE", format: "xlsx", report, sources });
writeFileSync(join(outDir, "report-sample.xlsx"), xlsx.bytes);
console.log("Wrote", join(outDir, "report-sample.pdf"), "and", join(outDir, "report-sample.xlsx"));

// Stage 1 design evidence for WHR-231 (WO-core-13b). Renders the proposed A4
// PDF layout and Excel sheet plan from fictional data shaped like the current
// ReportSnapshot contract (src/shared/contracts/reports.ts). This is a sample
// renderer for the brief only: it does not touch renderer.ts and is not wired
// into the export pipeline. Money/precision handling mirrors renderer.ts's
// `money`/`excelNumber` (string-exact, no float round-trip); Stage 2 reuses
// those functions directly instead of this script's copies.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ReportSnapshot, ReportSource, Totals } from "../../src/shared/contracts/reports";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../../docs/design/samples");
const fontDir = join(here, "../../docs/design/assets/fonts");
mkdirSync(outDir, { recursive: true });

// --- exact-value formatting, matching renderer.ts's money()/excelNumber() ---
const moneyString = (kobo: string) => {
  const s = kobo.padStart(3, "0");
  return s.slice(0, -2) + "." + s.slice(-2);
};
const nairaDisplay = (kobo: string) => {
  const [whole, frac] = moneyString(kobo).split(".");
  return "₦" + whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + frac;
};
/** Same precision guard as renderer.ts's excelNumber: only safe because every
 * value here is a short fictional literal already known to round-trip. */
const excelNumber = (value: string) => Number(value);

const PRODUCT_LABEL: Record<string, string> = {
  pms: "PMS",
  diesel: "Diesel",
  kerosene: "Kerosene",
  cooking_gas: "Cooking gas",
};
const EXCLUSION_LABEL: Record<string, string> = {
  pending: "Pending",
  held: "Held",
  cancelled: "Cancelled",
  ineligible: "Ineligible",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const displayDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m! - 1]} ${y}`;
};
/** `iso` already carries the Africa/Lagos offset (+01:00); read the local
 * clock fields straight out of the string rather than converting through a
 * Date object (which would read them back in a different zone). */
const displayInstant = (iso: string) => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso)!;
  const [, day, hh, mm] = match;
  const hour24 = Number(hh);
  const h12 = ((hour24 + 11) % 12) + 1;
  const ampm = hour24 < 12 ? "AM" : "PM";
  return `${displayDate(day!)} · ${String(h12).padStart(2, "0")}:${mm} ${ampm}`;
};

function totals(purchases: string, nairaKobo: string, litres: string, kilograms: string, products: Totals["products"]): Totals {
  return {
    purchases,
    spend: nairaKobo === "0" ? [] : [{ currency: "NGN", amountKobo: nairaKobo }],
    litres,
    kilograms,
    products,
  };
}
const spendText = (t: Totals) => (t.spend.length ? t.spend.map((s) => nairaDisplay(s.amountKobo)).join(", ") : "₦0.00");

// Fictional snapshot shaped like ReportSnapshot. Daily rows list only days
// with included purchases, matching reportFromRows (data.ts): an omitted day
// is not a claim of zero station sales, so no zero-filled rows are invented.
// All four excluded states are always present, as the server always returns
// them (data.ts's reportFromRows), including ones with zero records.
const snapshot: ReportSnapshot = {
  id: "RPT-7f2e9c-SAMPLE",
  format: "pdf",
  report: {
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
  },
  sources: [
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
  ],
};

const PAGE: [number, number] = [595.28, 841.89]; // A4 in points
const MARGIN = { top: 56, right: 40, bottom: 48, left: 40 };
const USABLE_WIDTH = PAGE[0] - MARGIN.left - MARGIN.right; // 515.28
const INK_900 = rgb(0.067, 0.08, 0.11);
const INK_700 = rgb(0.32, 0.36, 0.42);
const WHALE_600 = rgb(0.059, 0.298, 0.506); // #0F4C81
const LINE_100 = rgb(0.89, 0.91, 0.94);

async function renderPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(readFileSync(join(fontDir, "NotoSans-Regular.ttf")), { subset: true });
  const bold = await doc.embedFont(readFileSync(join(fontDir, "NotoSans-Bold.ttf")), { subset: true });

  const { report: r, sources } = snapshot;
  let page = doc.addPage(PAGE);
  let y = PAGE[1] - MARGIN.top;

  const newPage = () => {
    page = doc.addPage(PAGE);
    y = PAGE[1] - MARGIN.top;
  };
  const ensure = (need: number) => {
    if (y - need < MARGIN.bottom) newPage();
  };
  const text = (s: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number } = {}) => {
    const { size = 10, font = regular, color = INK_900, x = MARGIN.left } = opts;
    page.drawText(s, { x, y, size, font, color });
  };
  const wrap = (s: string, font: PDFFont, size: number, maxWidth: number): string[] => {
    const words = s.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const candidate = line ? line + " " + w : w;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = w;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    return lines;
  };
  type Col = { label: string; w: number };
  const drawRow = (cols: Col[], values: string[], opts: { font?: PDFFont; color?: ReturnType<typeof rgb> } = {}) => {
    let x = MARGIN.left;
    for (let i = 0; i < cols.length; i++) {
      text(values[i] ?? "", { size: 9.5, x, font: opts.font ?? regular, color: opts.color ?? INK_900 });
      x += cols[i]!.w;
    }
  };
  const tableRule = (cols: Col[]) =>
    page.drawLine({
      start: { x: MARGIN.left, y },
      end: { x: MARGIN.left + cols.reduce((s, c) => s + c.w, 0), y },
      thickness: 0.75,
      color: LINE_100,
    });

  // Header
  text("Whales Rewards", { size: 18, font: bold, color: WHALE_600 });
  y -= 20;
  text("Station 01 · Whales Energy", { size: 11, color: INK_700 });
  y -= 22;
  text(`Operational report  ·  ${displayDate(r.filters.from)} through ${displayDate(r.filters.to)} inclusive`, { size: 12, font: bold });
  y -= 16;
  text(`Date basis: Verified or reported sale date`, { size: 10, color: INK_700 });
  y -= 14;
  text(`Prepared ${displayInstant(r.asOf)} (Africa/Lagos, UTC+01:00)`, { size: 10, color: INK_700 });
  y -= 14;
  text(`Export ${snapshot.id}  ·  Data version ${r.dataVersion}`, { size: 10, color: INK_700 });
  y -= 10;
  page.drawLine({ start: { x: MARGIN.left, y }, end: { x: PAGE[0] - MARGIN.right, y }, thickness: 1, color: LINE_100 });
  y -= 22;

  // Summary
  text("Summary", { size: 13, font: bold });
  y -= 18;
  const includedDuplicates = sources.filter((s) => s.included && s.duplicateFlag).length;
  const pendingCorrections = sources.filter((s) => s.included && s.correctionPending).length;
  const summaryLines = [
    `Recorded spend: ${spendText(r.totals)} (${r.totals.purchases} completed purchases)`,
    `Liquid products: ${r.totals.litres} litres  ·  Cooking gas: ${r.totals.kilograms} kilograms (never added to litres)`,
    ...r.totals.products.map((p) => `  ${PRODUCT_LABEL[p.product] ?? p.product}: ${p.quantity} ${p.unit === "litre" ? "litres" : "kilograms"}`),
    `Included duplicate flags: ${includedDuplicates}  ·  Pending corrections: ${pendingCorrections}`,
  ];
  for (const l of summaryLines) {
    text(l, { size: 10 });
    y -= 14;
  }
  y -= 6;
  text("Excluded from totals", { size: 11, font: bold });
  y -= 14;
  for (const e of r.excluded) {
    text(`${EXCLUSION_LABEL[e.state] ?? e.state}: ${e.records} records, ${spendText({ ...r.totals, spend: e.spend })}`, { size: 10, color: INK_700 });
    y -= 13;
  }
  y -= 10;

  // Daily table — one row per day present in the snapshot; a day absent from
  // this list is not a claim of zero station sales (see data.ts/m4.md).
  ensure(30 + r.daily.length * 14);
  text("Daily", { size: 13, font: bold });
  y -= 18;
  const dailyCols: Col[] = [
    { label: "Day", w: 90 },
    { label: "Purchases", w: 85 },
    { label: "Recorded spend", w: 140 },
    { label: "Litres", w: 90 },
    { label: "Kilograms", w: 90 },
  ];
  drawRow(dailyCols, dailyCols.map((c) => c.label), { font: bold });
  y -= 6;
  tableRule(dailyCols);
  y -= 13;
  for (const d of r.daily) {
    ensure(14);
    drawRow(dailyCols, [displayDate(d.day), d.totals.purchases, spendText(d.totals), d.totals.litres, d.totals.kilograms]);
    y -= 14;
  }
  text("Days outside this list had no included purchases; this is not a claim of zero station sales.", { size: 8, color: INK_700 });
  y -= 18;

  // Groups table
  ensure(30 + r.groups.items.length * 14);
  const groupLabel = { product: "product", attendant: "attendant", pump: "pump" }[r.filters.groupBy];
  text(`Groups (by ${groupLabel})`, { size: 13, font: bold });
  y -= 18;
  const groupCols: Col[] = [
    { label: "Group", w: 130 },
    { label: "Purchases", w: 85 },
    { label: "Recorded spend", w: 140 },
    { label: "Litres", w: 80 },
    { label: "Kilograms", w: 80 },
  ];
  drawRow(groupCols, groupCols.map((c) => c.label), { font: bold });
  y -= 6;
  tableRule(groupCols);
  y -= 13;
  for (const g of r.groups.items) {
    ensure(14);
    const label = g.product
      ? (PRODUCT_LABEL[g.product] ?? g.product)
      : g.attendant
        ? `${g.attendant.name} (${g.attendant.staffCode})`
        : g.pump
          ? `${g.pump.name} (${g.pump.code})`
          : g.key;
    drawRow(groupCols, [label, g.totals.purchases, spendText(g.totals), g.totals.litres, g.totals.kilograms]);
    y -= 14;
  }
  y -= 10;

  // Source sales table: compact columns that fit the usable width exactly,
  // header repeated on every page the table spans.
  const srcCols: Col[] = [
    { label: "Sale", w: 55 },
    { label: "Date", w: 70 },
    { label: "Attendant / pump", w: 118 },
    { label: "Product", w: 58 },
    { label: "Amount", w: 72 },
    { label: "Qty", w: 38 },
    { label: "Status", w: 68 },
    { label: "Flags", w: 36 },
  ];
  if (srcCols.reduce((s, c) => s + c.w, 0) > USABLE_WIDTH)
    throw new Error("Source sales columns exceed the usable page width");
  const HEADER_BLOCK = 18 + 6 + 13; // title + rule gap + header row gap, matches the draws below
  const drawSourceHeader = () => {
    text("Source sales", { size: 13, font: bold });
    y -= 18;
    drawRow(srcCols, srcCols.map((c) => c.label), { font: bold });
    y -= 6;
    tableRule(srcCols);
    y -= 13;
  };
  ensure(HEADER_BLOCK + 24); // header block plus room for at least one row
  drawSourceHeader();
  for (const s of sources) {
    const nameLines = wrap(`${s.attendant.name} / ${s.pump.name}`, regular, 8.5, srcCols[2]!.w - 4);
    const rowHeight = Math.max(1, nameLines.length) * 11;
    if (y - rowHeight < MARGIN.bottom) {
      newPage();
      ensure(HEADER_BLOCK + rowHeight);
      drawSourceHeader();
    }
    const topY = y;
    const evidence = s.dateEvidence === "verified" ? "V" : "R";
    const flags = [s.duplicateFlag ? "Dup" : "", s.correctionPending ? "Corr" : ""].filter(Boolean).join("/") || "—";
    const status = s.included ? "Included" : `Excluded (${EXCLUSION_LABEL[s.exclusion ?? ""] ?? s.exclusion})`;
    drawRow(srcCols, [
      s.saleCode,
      `${displayDate(s.saleDate)} (${evidence})`,
      "",
      PRODUCT_LABEL[s.product] ?? s.product,
      nairaDisplay(s.amountKobo),
      s.quantity,
      status,
      flags,
    ]);
    const nameX = MARGIN.left + srcCols[0]!.w + srcCols[1]!.w;
    let ny = topY;
    for (const line of nameLines) {
      page.drawText(line, { x: nameX, y: ny, size: 8.5, font: regular, color: INK_900 });
      ny -= 11;
    }
    y = topY - rowHeight;
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: PAGE[0] / 2 - 30, y: MARGIN.bottom - 20, size: 9, font: regular, color: INK_700 });
  });

  writeFileSync(join(outDir, "report-sample.pdf"), await doc.save());
}

async function renderXlsx() {
  const { report: r, sources } = snapshot;
  const book = new ExcelJS.Workbook();
  book.creator = "Whales Rewards";
  book.created = new Date(snapshot.report.asOf);

  const headerRow = (sheet: ExcelJS.Worksheet, rowNumber: number, labels: string[]) => {
    const row = sheet.getRow(rowNumber);
    row.values = labels;
    row.font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: rowNumber }];
    sheet.autoFilter = { from: { row: rowNumber, column: 1 }, to: { row: rowNumber, column: labels.length } };
  };

  const summary = book.addWorksheet("Summary");
  summary.addRow(["Report", snapshot.id]);
  summary.addRow(["Station", "Station 01"]);
  summary.addRow(["From", displayDate(r.filters.from), "To", displayDate(r.filters.to)]);
  summary.addRow(["Product", r.filters.product ? PRODUCT_LABEL[r.filters.product] : "All", "Group by", r.filters.groupBy]);
  summary.addRow(["As of", displayInstant(r.asOf), "Timezone", r.timezone]);
  summary.addRow(["Data version", r.dataVersion, "Date basis", "Verified or reported sale date"]);
  summary.addRow([]);
  const totalsHeaderRow = summary.rowCount + 1;
  headerRow(summary, totalsHeaderRow, ["Metric", "Value", "Unit"]);
  summary.addRow(["Completed purchases", excelNumber(r.totals.purchases), "purchases"]);
  for (const s of r.totals.spend) {
    const row = summary.addRow(["Recorded spend", excelNumber(moneyString(s.amountKobo)), s.currency]);
    row.getCell(2).numFmt = "#,##0.00";
  }
  summary.addRow(["Litres", excelNumber(r.totals.litres), "litres"]);
  summary.addRow(["Kilograms", excelNumber(r.totals.kilograms), "kilograms"]);
  for (const p of r.totals.products)
    summary.addRow([`Product: ${PRODUCT_LABEL[p.product] ?? p.product}`, excelNumber(p.quantity), p.unit === "litre" ? "litres" : "kilograms"]);
  summary.addRow([]);
  const excludedHeaderRow = summary.rowCount + 1;
  summary.getRow(excludedHeaderRow).values = ["Excluded from totals"];
  summary.getRow(excludedHeaderRow).font = { bold: true };
  const excludedTableHeaderRow = excludedHeaderRow + 1;
  summary.getRow(excludedTableHeaderRow).values = ["State", "Records", "Spend (NGN)"];
  summary.getRow(excludedTableHeaderRow).font = { bold: true };
  for (const e of r.excluded) {
    const row = summary.addRow([EXCLUSION_LABEL[e.state] ?? e.state, excelNumber(e.records), e.spend.length ? excelNumber(moneyString(e.spend[0]!.amountKobo)) : 0]);
    row.getCell(3).numFmt = "#,##0.00";
  }
  summary.columns.forEach((c) => (c.width = 24));

  const daily = book.addWorksheet("Daily");
  headerRow(daily, 1, ["Day", "Purchases", "Recorded spend (NGN)", "Litres", "Kilograms"]);
  for (const d of r.daily) {
    const row = daily.addRow([
      d.day,
      excelNumber(d.totals.purchases),
      d.totals.spend.length ? excelNumber(moneyString(d.totals.spend[0]!.amountKobo)) : 0,
      excelNumber(d.totals.litres),
      excelNumber(d.totals.kilograms),
    ]);
    row.getCell(3).numFmt = "#,##0.00";
  }
  daily.columns.forEach((c) => (c.width = 20));

  const groups = book.addWorksheet("Groups");
  headerRow(groups, 1, ["Group", "Attendant staff code", "Pump code", "Purchases", "Recorded spend (NGN)", "Litres", "Kilograms"]);
  for (const g of r.groups.items) {
    const row = groups.addRow([
      g.product ? (PRODUCT_LABEL[g.product] ?? g.product) : g.attendant?.name ?? g.pump?.name ?? g.key,
      g.attendant?.staffCode ?? "",
      g.pump?.code ?? "",
      excelNumber(g.totals.purchases),
      g.totals.spend.length ? excelNumber(moneyString(g.totals.spend[0]!.amountKobo)) : 0,
      excelNumber(g.totals.litres),
      excelNumber(g.totals.kilograms),
    ]);
    row.getCell(5).numFmt = "#,##0.00";
  }
  groups.columns.forEach((c) => (c.width = 20));

  // Source sales: every column the current renderer.ts exposes (full parity;
  // nothing dropped), same column order.
  const source = book.addWorksheet("Source sales");
  headerRow(source, 1, [
    "Purchase ID",
    "Sale code",
    "Revision ID",
    "Sale date",
    "Date evidence",
    "App captured at",
    "Verified sale date",
    "Server received at",
    "Attendant ID",
    "Staff code",
    "Attendant",
    "Username",
    "Pump ID",
    "Pump code",
    "Pump",
    "Product",
    "Unit",
    "Amount",
    "Currency",
    "Quantity",
    "State",
    "Included in totals",
    "Exclusion",
    "Values source",
    "Duplicate flag",
    "Correction pending",
  ]);
  const sourceRow = (s: ReportSource) => [
    s.purchaseId,
    s.saleCode,
    s.revisionId ?? "",
    s.saleDate,
    s.dateEvidence,
    s.appCapturedAt,
    s.verifiedSaleDate ?? "",
    s.serverReceivedAt,
    s.attendant.id,
    s.attendant.staffCode,
    s.attendant.name,
    s.attendant.username,
    s.pump.id,
    s.pump.code,
    s.pump.name,
    PRODUCT_LABEL[s.product] ?? s.product,
    s.unit === "litre" ? "litres" : "kilograms",
    excelNumber(moneyString(s.amountKobo)),
    s.currency,
    excelNumber(s.quantity),
    s.state,
    s.included,
    s.exclusion ? EXCLUSION_LABEL[s.exclusion] ?? s.exclusion : "",
    s.valuesSource,
    s.duplicateFlag,
    s.correctionPending,
  ];
  for (const s of sources) {
    const row = source.addRow(sourceRow(s));
    row.getCell(18).numFmt = "#,##0.00";
    row.getCell(20).numFmt = "0.######";
  }
  source.columns.forEach((c, i) => (c.width = i === 10 ? 34 : 20));

  writeFileSync(join(outDir, "report-sample.xlsx"), (await book.xlsx.writeBuffer()) as unknown as Buffer);
}

await renderPdf();
await renderXlsx();
console.log("Wrote", join(outDir, "report-sample.pdf"), "and", join(outDir, "report-sample.xlsx"));

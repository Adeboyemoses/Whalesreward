// Stage 1 design evidence for WHR-231 (WO-core-13b). Renders the proposed A4
// PDF layout and Excel sheet plan from fictional data shaped like the current
// ReportSnapshot contract (src/shared/contracts/reports.ts). This is a sample
// renderer for the brief only: it does not touch renderer.ts and is not wired
// into the export pipeline.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ReportSnapshot, Totals } from "../../src/shared/contracts/reports";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../../docs/design/samples");
const fontDir = join(here, "../../docs/design/assets/fonts");
mkdirSync(outDir, { recursive: true });

const money = (kobo: string) => {
  const s = kobo.padStart(3, "0");
  return "₦" + Number(s.slice(0, -2) + "." + s.slice(-2)).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

function totals(purchases: string, nairaKobo: string, litres: string, kilograms: string, products: Totals["products"]): Totals {
  return {
    purchases,
    spend: [{ currency: "NGN", amountKobo: nairaKobo }],
    litres,
    kilograms,
    products,
  };
}

// Fictional snapshot shaped like ReportSnapshot, with a deliberately long
// customer-adjacent name (attendant) to exercise wrapping and non-ASCII glyphs.
const snapshot: ReportSnapshot = {
  id: "RPT-7f2e9c-SAMPLE",
  format: "pdf",
  report: {
    filters: { from: "2026-10-27", to: "2026-11-02", product: null, groupBy: "product" },
    asOf: "2026-11-02T23:59:59+01:00",
    timezone: "Africa/Lagos",
    dataVersion: "184203",
    totals: totals("13", "16950000", "135", "20", [
      { product: "pms", unit: "litre", quantity: "90" },
      { product: "diesel", unit: "litre", quantity: "30" },
      { product: "kerosene", unit: "litre", quantity: "15" },
      { product: "cooking_gas", unit: "kilogram", quantity: "20" },
    ]),
    excluded: [
      { state: "pending", records: "2", spend: [{ currency: "NGN", amountKobo: "1700000" }] },
      { state: "cancelled", records: "2", spend: [{ currency: "NGN", amountKobo: "1400000" }] },
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
        {
          key: "pms",
          product: "pms",
          attendant: null,
          pump: null,
          totals: totals("6", "9000000", "90", "0", []),
        },
        {
          key: "diesel",
          product: "diesel",
          attendant: null,
          pump: null,
          totals: totals("2", "3600000", "30", "0", []),
        },
        {
          key: "cooking_gas",
          product: "cooking_gas",
          attendant: null,
          pump: null,
          totals: totals("3", "3000000", "0", "20", []),
        },
        {
          key: "kerosene",
          product: "kerosene",
          attendant: null,
          pump: null,
          totals: totals("2", "1350000", "15", "0", []),
        },
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
      exclusion: "pending",
      valuesSource: "original",
      duplicateFlag: true,
      correctionPending: false,
    },
  ],
};

const PAGE = [595.28, 841.89] as const; // A4 in points
const MARGIN = { top: 56, right: 40, bottom: 48, left: 40 };
const INK_900 = rgb(0.067, 0.08, 0.11);
const INK_700 = rgb(0.32, 0.36, 0.42);
const WHALE_600 = rgb(0.059, 0.298, 0.506); // #0F4C81
const LINE_100 = rgb(0.89, 0.91, 0.94);

async function renderPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regularBytes = readFileSync(join(fontDir, "NotoSans-Regular.ttf"));
  const boldBytes = readFileSync(join(fontDir, "NotoSans-Bold.ttf"));
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });

  const { report: r, sources } = snapshot;
  let page = doc.addPage(PAGE as unknown as [number, number]);
  let y = PAGE[1] - MARGIN.top;

  const newPage = () => {
    page = doc.addPage(PAGE as unknown as [number, number]);
    y = PAGE[1] - MARGIN.top;
  };
  const ensure = (need: number) => {
    if (y - need < MARGIN.bottom) newPage();
  };
  const text = (
    s: string,
    opts: { size?: number; font?: typeof regular; color?: ReturnType<typeof rgb>; x?: number } = {},
  ) => {
    const { size = 10, font = regular, color = INK_900, x = MARGIN.left } = opts;
    page.drawText(s, { x, y, size, font, color });
  };
  const wrap = (s: string, font: typeof regular, size: number, maxWidth: number): string[] => {
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

  // Header
  text("Whales Rewards", { size: 18, font: bold, color: WHALE_600 });
  y -= 20;
  text("Station 01 · Whales Energy", { size: 11, font: regular, color: INK_700 });
  y -= 22;
  text(`Operational report  ·  ${r.filters.from} through ${r.filters.to} inclusive`, { size: 12, font: bold });
  y -= 16;
  text(`Date basis: ${r.dateBasis === "verified_or_reported_sale_date" ? "Verified or reported sale date" : r.dateBasis}`, { size: 10, color: INK_700 });
  y -= 14;
  text(`Prepared 02 Nov 2026 · 11:59 PM (Africa/Lagos, UTC+01:00)`, { size: 10, color: INK_700 });
  y -= 14;
  text(`Export ${snapshot.id}  ·  Data version ${r.dataVersion}`, { size: 10, color: INK_700 });
  y -= 10;
  page.drawLine({ start: { x: MARGIN.left, y }, end: { x: PAGE[0] - MARGIN.right, y }, thickness: 1, color: LINE_100 });
  y -= 22;

  // Summary
  text("Summary", { size: 13, font: bold });
  y -= 18;
  const summaryLines = [
    `Recorded spend: ${money(r.totals.spend[0]!.amountKobo)} (${r.totals.purchases} completed purchases)`,
    `Liquid products: ${r.totals.litres} litres  ·  Cooking gas: ${r.totals.kilograms} kilograms (never added to litres)`,
    ...r.totals.products.map((p) => `  ${p.product}: ${p.quantity} ${p.unit === "litre" ? "litres" : "kilograms"}`),
  ];
  for (const l of summaryLines) {
    text(l, { size: 10 });
    y -= 14;
  }
  y -= 6;
  text("Excluded from totals", { size: 11, font: bold });
  y -= 14;
  for (const e of r.excluded) {
    text(`${e.state}: ${e.records} records, ${money(e.spend[0]!.amountKobo)}`, { size: 10, color: INK_700 });
    y -= 13;
  }
  y -= 10;

  // Daily table
  ensure(24 + r.daily.length * 14);
  text("Daily", { size: 13, font: bold });
  y -= 18;
  const dailyCols = [
    { label: "Day", w: 90 },
    { label: "Purchases", w: 80 },
    { label: "Recorded spend", w: 130 },
    { label: "Litres", w: 70 },
    { label: "Kilograms", w: 80 },
  ];
  const drawRow = (cols: { label: string; w: number }[], values: string[], opts: { font?: typeof regular; color?: ReturnType<typeof rgb> } = {}) => {
    let x = MARGIN.left;
    for (let i = 0; i < cols.length; i++) {
      text(values[i] ?? "", { size: 9.5, x, font: opts.font ?? regular, color: opts.color ?? INK_900 });
      x += cols[i]!.w;
    }
  };
  drawRow(dailyCols, dailyCols.map((c) => c.label), { font: bold });
  y -= 6;
  page.drawLine({ start: { x: MARGIN.left, y }, end: { x: MARGIN.left + dailyCols.reduce((s, c) => s + c.w, 0), y }, thickness: 0.75, color: LINE_100 });
  y -= 13;
  for (const d of r.daily) {
    ensure(14);
    drawRow(dailyCols, [d.day, d.totals.purchases, money(d.totals.spend[0]!.amountKobo), d.totals.litres, d.totals.kilograms]);
    y -= 14;
  }
  y -= 10;

  // Groups table
  ensure(24 + r.groups.items.length * 14);
  text(`Groups (by ${r.filters.groupBy})`, { size: 13, font: bold });
  y -= 18;
  const groupCols = [
    { label: "Group", w: 130 },
    { label: "Purchases", w: 80 },
    { label: "Recorded spend", w: 130 },
    { label: "Litres", w: 65 },
    { label: "Kilograms", w: 80 },
  ];
  drawRow(groupCols, groupCols.map((c) => c.label), { font: bold });
  y -= 6;
  page.drawLine({ start: { x: MARGIN.left, y }, end: { x: MARGIN.left + groupCols.reduce((s, c) => s + c.w, 0), y }, thickness: 0.75, color: LINE_100 });
  y -= 13;
  for (const g of r.groups.items) {
    ensure(14);
    drawRow(groupCols, [g.product ?? g.key, g.totals.purchases, money(g.totals.spend[0]!.amountKobo), g.totals.litres, g.totals.kilograms]);
    y -= 14;
  }
  y -= 10;

  // Source sales table with repeated header, long name wrapping
  const srcCols = [
    { label: "Sale", w: 70 },
    { label: "Date", w: 60 },
    { label: "Attendant / pump", w: 150 },
    { label: "Product", w: 65 },
    { label: "Amount", w: 80 },
    { label: "Qty", w: 55 },
    { label: "Status", w: 90 },
  ];
  const drawSourceHeader = () => {
    ensure(22);
    text("Source sales", { size: 13, font: bold });
    y -= 18;
    drawRow(srcCols, srcCols.map((c) => c.label), { font: bold });
    y -= 6;
    page.drawLine({ start: { x: MARGIN.left, y }, end: { x: MARGIN.left + srcCols.reduce((s, c) => s + c.w, 0), y }, thickness: 0.75, color: LINE_100 });
    y -= 13;
  };
  drawSourceHeader();
  for (const s of sources) {
    const nameLines = wrap(`${s.attendant.name} / ${s.pump.name}`, regular, 9, srcCols[2]!.w - 4);
    const rowHeight = Math.max(1, nameLines.length) * 12;
    if (y - rowHeight < MARGIN.bottom) {
      newPage();
      drawSourceHeader();
    }
    const topY = y;
    const srcValues = [
      s.saleCode,
      s.saleDate,
      "",
      s.product,
      money(s.amountKobo),
      s.quantity,
      s.included ? "Included" : `Excluded (${s.exclusion})`,
    ];
    drawRow(srcCols, srcValues);
    const nameX = MARGIN.left + srcCols[0]!.w + srcCols[1]!.w;
    let ny = topY;
    for (const line of nameLines) {
      page.drawText(line, { x: nameX, y: ny, size: 9, font: regular, color: INK_900 });
      ny -= 12;
    }
    y = topY - rowHeight;
  }

  // Page numbers
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: PAGE[0] / 2 - 30,
      y: MARGIN.bottom - 20,
      size: 9,
      font: regular,
      color: INK_700,
    });
  });

  writeFileSync(join(outDir, "report-sample.pdf"), await doc.save());
}

async function renderXlsx() {
  const { report: r, sources } = snapshot;
  const book = new ExcelJS.Workbook();
  book.creator = "Whales Rewards";
  book.created = new Date("2026-11-02T22:59:59Z");

  const headerRow = (sheet: ExcelJS.Worksheet, labels: string[]) => {
    const row = sheet.addRow(labels);
    row.font = { bold: true };
    row.eachCell((c) => {
      c.alignment = { vertical: "middle" };
    });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: labels.length } };
  };

  const summary = book.addWorksheet("Summary");
  summary.addRow(["Report", snapshot.id]);
  summary.addRow(["Station", "Station 01"]);
  summary.addRow(["From", r.filters.from, "To", r.filters.to]);
  summary.addRow(["Product", r.filters.product ?? "All", "Group by", r.filters.groupBy]);
  summary.addRow(["As of", r.asOf, "Timezone", r.timezone]);
  summary.addRow(["Data version", r.dataVersion, "Date basis", r.dateBasis]);
  summary.addRow([]);
  headerRow(summary, ["Metric", "Value", "Unit"]);
  const addTotalsRows = (sheet: ExcelJS.Worksheet, t: Totals) => {
    sheet.addRow(["Completed purchases", Number(t.purchases), "purchases"]);
    for (const s of t.spend) {
      const row = sheet.addRow(["Recorded spend", Number(money(s.amountKobo).replace(/[^\d.]/g, "")), s.currency]);
      row.getCell(2).numFmt = "#,##0.00";
    }
    sheet.addRow(["Litres", Number(t.litres), "litres"]);
    sheet.addRow(["Kilograms", Number(t.kilograms), "kilograms"]);
  };
  addTotalsRows(summary, r.totals);
  summary.addRow([]);
  summary.addRow(["Excluded from totals", "State", "Records", "Spend"]);
  for (const e of r.excluded) summary.addRow(["", e.state, Number(e.records), Number(money(e.spend[0]!.amountKobo).replace(/[^\d.]/g, ""))]);
  summary.columns.forEach((c) => (c.width = 22));

  const daily = book.addWorksheet("Daily");
  headerRow(daily, ["Day", "Purchases", "Recorded spend (NGN)", "Litres", "Kilograms"]);
  for (const d of r.daily) {
    const row = daily.addRow([
      d.day,
      Number(d.totals.purchases),
      Number(money(d.totals.spend[0]!.amountKobo).replace(/[^\d.]/g, "")),
      Number(d.totals.litres),
      Number(d.totals.kilograms),
    ]);
    row.getCell(3).numFmt = "#,##0.00";
  }
  daily.columns.forEach((c) => (c.width = 20));

  const groups = book.addWorksheet("Groups");
  headerRow(groups, ["Group", "Purchases", "Recorded spend (NGN)", "Litres", "Kilograms"]);
  for (const g of r.groups.items) {
    const row = groups.addRow([
      g.product ?? g.attendant?.name ?? g.pump?.name ?? g.key,
      Number(g.totals.purchases),
      Number(money(g.totals.spend[0]!.amountKobo).replace(/[^\d.]/g, "")),
      Number(g.totals.litres),
      Number(g.totals.kilograms),
    ]);
    row.getCell(3).numFmt = "#,##0.00";
  }
  groups.columns.forEach((c) => (c.width = 20));

  const source = book.addWorksheet("Source sales");
  headerRow(source, [
    "Sale code",
    "Sale date",
    "Attendant",
    "Pump",
    "Product",
    "Unit",
    "Amount (NGN)",
    "Quantity",
    "State",
    "Included in totals",
    "Exclusion",
    "Duplicate flag",
    "Correction pending",
  ]);
  for (const s of sources) {
    const row = source.addRow([
      s.saleCode,
      s.saleDate,
      s.attendant.name,
      s.pump.name,
      s.product,
      s.unit === "litre" ? "litres" : "kilograms",
      Number(money(s.amountKobo).replace(/[^\d.]/g, "")),
      Number(s.quantity),
      s.state,
      s.included,
      s.exclusion ?? "",
      s.duplicateFlag,
      s.correctionPending,
    ]);
    row.getCell(7).numFmt = "#,##0.00";
  }
  source.columns.forEach((c, i) => (c.width = i === 2 ? 34 : 20));

  writeFileSync(join(outDir, "report-sample.xlsx"), await book.xlsx.writeBuffer() as unknown as Buffer);
}

await renderPdf();
await renderXlsx();
console.log("Wrote", join(outDir, "report-sample.pdf"), "and", join(outDir, "report-sample.xlsx"));

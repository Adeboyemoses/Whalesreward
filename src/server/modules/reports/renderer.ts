import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { PDFDocument, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type {
  ReportSnapshot,
  ReportSource,
  Totals,
} from "../../../shared/contracts/reports";

export class PrecisionError extends Error {
  constructor() {
    super("precision_not_representable");
  }
}

/** Excel supports 15 significant decimal digits. Conversion is only at this
 * rendering boundary, after exact decimal round-trip validation, never arithmetic. */
export function excelNumber(value: string): number {
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) throw new PrecisionError();
  const normalized = value.includes(".")
    ? value.replace(/0+$/, "").replace(/\.$/, "")
    : value;
  const significant = normalized
    .replace(".", "")
    .replace(/^0+/, "")
    .replace(/0+$/, "");
  if (significant.length > 15) throw new PrecisionError();
  const n = Number(normalized);
  // Expand scientific notation from the JS serialization for an exact comparison.
  const expand = (s: string) => {
    if (!/[eE]/.test(s)) return s;
    const [mantissa, exponent] = s.toLowerCase().split("e");
    const [whole, fraction = ""] = mantissa!.split(".");
    const digits = whole! + fraction,
      point = whole!.length + Number(exponent);
    return point <= 0
      ? "0." + "0".repeat(-point) + digits
      : point >= digits.length
        ? digits + "0".repeat(point - digits.length)
        : digits.slice(0, point) + "." + digits.slice(point);
  };
  if (!Number.isFinite(n) || expand(String(n)) !== normalized)
    throw new PrecisionError();
  return n;
}
const money = (kobo: string) => {
  const s = kobo.padStart(3, "0");
  return s.slice(0, -2) + "." + s.slice(-2);
};

// --- small shared formatting helpers --------------------------------------

/** "1 purchase" / "2 purchases" — never "1 purchases". Count is an exact
 * decimal string (never converted through Number). */
export function plural(count: string, noun: string): string {
  return `${count} ${noun}${count === "1" ? "" : "s"}`;
}

function quantityLabel(quantity: string, unit: "litre" | "kilogram"): string {
  return `${quantity} ${unit === "litre" ? "litres" : "kilograms"}`;
}

/** Inserts thousands separators into an exact decimal string. Pure string
 * manipulation — never Number/parseFloat/toFixed on the value. */
function withThousands(decimal: string): string {
  const [whole, frac] = decimal.split(".");
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

/** NGN prints the real ₦ sign (Noto Sans has the glyph); any other currency
 * keeps the existing code-prefix style rather than inventing a symbol. */
function formatMoneyText(amountKobo: string, currency: string): string {
  const amount = withThousands(money(amountKobo));
  return currency === "NGN" ? `₦${amount}` : `${currency} ${amount}`;
}

/** Excel numFmt for a money cell holding the plain numeric naira/other
 * amount: a literal currency symbol for NGN, a literal code prefix otherwise. */
function moneyNumFmt(currency: string): string {
  return currency === "NGN" ? '"₦"#,##0.00' : `"${currency} "#,##0.00`;
}
const QUANTITY_NUMFMT = "0.######";

const PRODUCT_LABEL: Record<string, string> = {
  pms: "PMS",
  diesel: "Diesel",
  kerosene: "Kerosene",
  cooking_gas: "Cooking gas",
};

/** Distinct currencies across a set of spend-bearing totals, NGN first, for
 * a stable column/row order; defaults to NGN alone when nothing is excluded
 * or earned yet so the common single-currency header always reads plainly. */
function currenciesOf(entries: { spend: Totals["spend"] }[]): string[] {
  const set = new Set<string>();
  for (const e of entries) for (const s of e.spend) set.add(s.currency);
  if (set.size === 0) set.add("NGN");
  return [...set].sort((a, b) =>
    a === "NGN" ? -1 : b === "NGN" ? 1 : a.localeCompare(b),
  );
}
function spendValue(entry: { spend: Totals["spend"] }, currency: string): number {
  const found = entry.spend.find((s) => s.currency === currency);
  return found ? excelNumber(money(found.amountKobo)) : excelNumber("0");
}

// --- calendar-day / instant -> Excel Date cells ----------------------------

/** A `Day` string ("YYYY-MM-DD") has no time component, so it becomes a real
 * UTC midnight Date with no timezone math; ExcelJS round-trips a Date cell
 * by its UTC getters, verified empirically for this exact construction. */
function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
/** Africa/Lagos is a fixed UTC+1 with no DST. Excel has no per-cell
 * timezone and serializes a Date by its UTC getters, so shifting the UTC
 * instant by +1 hour before building the Date makes the UTC getters read
 * back as the intended Lagos wall-clock numbers. Verified empirically with
 * an ExcelJS write/read round trip (see WHR-231 Stage 2 report). */
function lagosInstantDate(instant: string): Date {
  return new Date(Date.parse(instant) + 60 * 60 * 1000);
}
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;
function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
}
/** `21 Oct 2026 · 10:42 AM` per the design system's Lagos-time copy rule. */
function formatLagos(instant: string): string {
  const d = lagosInstantDate(instant);
  const h24 = d.getUTCHours(),
    h12 = h24 % 12 === 0 ? 12 : h24 % 12,
    ampm = h24 < 12 ? "AM" : "PM",
    mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${h12}:${mm} ${ampm}`;
}
const DAY_NUMFMT = "dd mmm yyyy";
const INSTANT_NUMFMT = "dd mmm yyyy hh:mm AM/PM";

// --- XLSX ------------------------------------------------------------------

/** "ID"-suffixed headers hold UUIDs and need real room; short headers need
 * little. Sized for actual content, not a uniform guess. */
function widthFor(header: string): number {
  if (/ID$/.test(header)) return 38;
  if (header.length <= 6) return 12;
  return Math.min(42, header.length + 4);
}
function styleHeader(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  colCount: number,
  { freeze = true }: { freeze?: boolean } = {},
) {
  sheet.getRow(headerRow).font = { bold: true };
  if (freeze) {
    sheet.views = [{ state: "frozen", ySplit: headerRow }];
    sheet.autoFilter = {
      from: { row: headerRow, column: 1 },
      to: { row: headerRow, column: colCount },
    };
  }
}
function sizeColumns(sheet: ExcelJS.Worksheet, headers: string[]) {
  headers.forEach((h, i) => (sheet.getColumn(i + 1).width = widthFor(h)));
}
// ExcelJS string cells are inline/shared strings, never formulas — every
// user-influenced text value below is a plain string cell.
const text = (v: string) => v;

function buildSummarySheet(book: ExcelJS.Workbook, snapshot: ReportSnapshot) {
  const sheet = book.addWorksheet("Summary"),
    { report: r } = snapshot;
  sheet.addRow(["Report ID", text(snapshot.id)]);
  sheet.addRow(["Period", r.filters.from, "to", r.filters.to]);
  sheet.addRow(["Product filter", text(r.filters.product ?? "All products")]);
  sheet.addRow(["Group by", text(r.filters.groupBy)]);
  const asOfRow = sheet.addRow(["As of (Lagos time)", lagosInstantDate(r.asOf)]);
  asOfRow.getCell(2).numFmt = INSTANT_NUMFMT;
  sheet.addRow(["Data version", text(r.dataVersion)]);
  sheet.addRow(["Date basis", "Verified or reported sale date"]);
  sheet.addRow(["Timezone", text(r.timezone)]);
  sheet.addRow([]);
  const totalsHeader = sheet.addRow(["Metric", "Value", "Unit"]);
  const addTotalsBlock = (t: Totals) => {
    sheet.addRow(["Purchases", excelNumber(t.purchases)]);
    for (const s of t.spend) {
      const row = sheet.addRow(["Spend", excelNumber(money(s.amountKobo)), s.currency]);
      row.getCell(2).numFmt = moneyNumFmt(s.currency);
    }
    const litresRow = sheet.addRow(["Litres", excelNumber(t.litres), "litre"]);
    litresRow.getCell(2).numFmt = QUANTITY_NUMFMT;
    const kgRow = sheet.addRow(["Kilograms", excelNumber(t.kilograms), "kilogram"]);
    kgRow.getCell(2).numFmt = QUANTITY_NUMFMT;
    for (const p of t.products) {
      const row = sheet.addRow([PRODUCT_LABEL[p.product] ?? p.product, excelNumber(p.quantity), p.unit]);
      row.getCell(2).numFmt = QUANTITY_NUMFMT;
    }
  };
  addTotalsBlock(r.totals);
  sheet.addRow([]);
  const currencies = currenciesOf(r.excluded);
  const excludedHeader = sheet.addRow([
    "State",
    "Records",
    ...currencies.map((c) => `Spend (${c})`),
  ]);
  excludedHeader.font = { bold: true };
  for (const e of r.excluded) {
    const row = sheet.addRow([
      e.state,
      excelNumber(e.records),
      ...currencies.map((c) => spendValue(e, c)),
    ]);
    currencies.forEach((c, i) => (row.getCell(3 + i).numFmt = moneyNumFmt(c)));
  }
  styleHeader(sheet, totalsHeader.number, 3);
  sizeColumns(sheet, ["Report ID", "Value", "Unit"]);
  sheet.getColumn(1).width = 20;
  return sheet;
}

function buildDailySheet(book: ExcelJS.Workbook, snapshot: ReportSnapshot) {
  const sheet = book.addWorksheet("Daily"),
    { daily } = snapshot.report,
    currencies = currenciesOf(daily.map((d) => d.totals)),
    headers = [
      "Day",
      "Purchases",
      ...currencies.map((c) => `Recorded spend (${c})`),
      "Litres",
      "Kilograms",
    ];
  sheet.addRow(headers);
  for (const d of daily) {
    const row = sheet.addRow([
      dayToDate(d.day),
      excelNumber(d.totals.purchases),
      ...currencies.map((c) => spendValue(d.totals, c)),
      excelNumber(d.totals.litres),
      excelNumber(d.totals.kilograms),
    ]);
    row.getCell(1).numFmt = DAY_NUMFMT;
    currencies.forEach((c, i) => (row.getCell(3 + i).numFmt = moneyNumFmt(c)));
    row.getCell(3 + currencies.length).numFmt = QUANTITY_NUMFMT;
    row.getCell(4 + currencies.length).numFmt = QUANTITY_NUMFMT;
  }
  styleHeader(sheet, 1, headers.length);
  sizeColumns(sheet, headers);
  return sheet;
}

function buildGroupsSheet(book: ExcelJS.Workbook, snapshot: ReportSnapshot) {
  const sheet = book.addWorksheet("Groups"),
    items = snapshot.report.groups.items,
    currencies = currenciesOf(items.map((g) => g.totals)),
    headers = [
      "Group",
      "Attendant staff code",
      "Pump code",
      "Purchases",
      ...currencies.map((c) => `Recorded spend (${c})`),
      "Litres",
      "Kilograms",
    ];
  sheet.addRow(headers);
  for (const g of items) {
    const row = sheet.addRow([
      text(g.product ?? g.attendant?.name ?? g.pump?.name ?? g.key),
      text(g.attendant?.staffCode ?? ""),
      text(g.pump?.code ?? ""),
      excelNumber(g.totals.purchases),
      ...currencies.map((c) => spendValue(g.totals, c)),
      excelNumber(g.totals.litres),
      excelNumber(g.totals.kilograms),
    ]);
    currencies.forEach((c, i) => (row.getCell(5 + i).numFmt = moneyNumFmt(c)));
    row.getCell(5 + currencies.length).numFmt = QUANTITY_NUMFMT;
    row.getCell(6 + currencies.length).numFmt = QUANTITY_NUMFMT;
  }
  styleHeader(sheet, 1, headers.length);
  sizeColumns(sheet, headers);
  return sheet;
}

const SOURCE_HEADERS = [
  "Purchase ID",
  "Sale code",
  "Revision ID",
  "Sale date",
  "Date evidence",
  "App captured at (Lagos time)",
  "Verified sale date",
  "Server received at (Lagos time)",
  "Attendant ID",
  "Staff code",
  "Attendant",
  "Username",
  "Pump ID",
  "Pump code",
  "Pump",
  "Product",
  "Amount",
  "Currency",
  "Litres",
  "Kilograms",
  "State",
  "Included in totals",
  "Exclusion",
  "Values source",
  "Duplicate flag",
  "Correction pending",
];
function buildSourceSheet(book: ExcelJS.Workbook, sources: ReportSource[]) {
  const sheet = book.addWorksheet("Source sales");
  sheet.addRow(SOURCE_HEADERS);
  for (const s of sources) {
    const row = sheet.addRow([
      s.purchaseId,
      s.saleCode,
      s.revisionId ?? "",
      dayToDate(s.saleDate),
      s.dateEvidence,
      lagosInstantDate(s.appCapturedAt),
      s.verifiedSaleDate ? dayToDate(s.verifiedSaleDate) : "",
      lagosInstantDate(s.serverReceivedAt),
      s.attendant.id,
      s.attendant.staffCode,
      s.attendant.name,
      s.attendant.username,
      s.pump.id,
      s.pump.code,
      s.pump.name,
      s.product,
      excelNumber(money(s.amountKobo)),
      s.currency,
      s.unit === "litre" ? excelNumber(s.quantity) : excelNumber("0"),
      s.unit === "kilogram" ? excelNumber(s.quantity) : excelNumber("0"),
      s.state,
      s.included,
      s.exclusion ?? "",
      s.valuesSource,
      s.duplicateFlag,
      s.correctionPending,
    ]);
    row.getCell(4).numFmt = DAY_NUMFMT;
    row.getCell(6).numFmt = INSTANT_NUMFMT;
    if (s.verifiedSaleDate) row.getCell(7).numFmt = DAY_NUMFMT;
    row.getCell(8).numFmt = INSTANT_NUMFMT;
    row.getCell(17).numFmt = moneyNumFmt(s.currency);
    row.getCell(19).numFmt = QUANTITY_NUMFMT;
    row.getCell(20).numFmt = QUANTITY_NUMFMT;
  }
  styleHeader(sheet, 1, SOURCE_HEADERS.length);
  sizeColumns(sheet, SOURCE_HEADERS);
  return sheet;
}

async function renderXlsx(
  snapshot: ReportSnapshot,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const book = new ExcelJS.Workbook();
  buildSummarySheet(book, snapshot);
  buildDailySheet(book, snapshot);
  buildGroupsSheet(book, snapshot);
  buildSourceSheet(book, snapshot.sources);
  for (const ws of book.worksheets)
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.type === ExcelJS.ValueType.Formula)
          throw new Error("formula cell is never permitted in a report export");
      }),
    );
  return {
    bytes: new Uint8Array(await book.xlsx.writeBuffer()),
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

// --- PDF ---------------------------------------------------------------

const PAGE_WIDTH = 595.28,
  PAGE_HEIGHT = 841.89,
  MARGIN = 40,
  USABLE_WIDTH = PAGE_WIDTH - 2 * MARGIN,
  BOTTOM = MARGIN + 20,
  LINE_GAP = 2,
  CELL_PAD = 4;
export const SOURCE_TABLE_CAP = 500;
const FONTS_DIR = path.join(process.cwd(), "src/server/modules/reports/fonts");

type Align = "left" | "right";
type Column = { header: string; width: number; align: Align };
type Cell = { lines: string[]; align: Align };

class Cursor {
  page: PDFPage;
  y: number;
  constructor(
    public doc: PDFDocument,
    public regular: PDFFont,
    public bold: PDFFont,
  ) {
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }
  newPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }
  ensure(height: number) {
    if (this.y - height < BOTTOM) this.newPage();
  }
  text(value: string, x: number, size: number, font: PDFFont) {
    this.page.drawText(value, { x, y: this.y, size, font });
  }
  line(text: string, size = 10, bold = false, gap = 4) {
    const font = bold ? this.bold : this.regular;
    this.ensure(size + gap);
    this.text(text, MARGIN, size, font);
    this.y -= size + gap;
  }
  rule() {
    this.ensure(10);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.5,
    });
    this.y -= 10;
  }
}

/** Wraps at spaces; a single word wider than the column is hard-broken by
 * character so nothing ever overflows its column (long status text, a
 * hyphenated surname with no spaces, etc). */
function wrapWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];
  const lines: string[] = [];
  let part = "";
  for (const ch of word) {
    const candidate = part + ch;
    if (part && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(part);
      part = ch;
    } else {
      part = candidate;
    }
  }
  if (part) lines.push(part);
  return lines;
}
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ").filter((w) => w.length > 0);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    const wordLines = wrapWord(word, font, size, maxWidth);
    current = wordLines.pop() ?? "";
    lines.push(...wordLines);
  }
  if (current) lines.push(current);
  return lines;
}
function makeCell(
  value: string,
  font: PDFFont,
  size: number,
  width: number,
  align: Align = "left",
): Cell {
  return { lines: wrapText(value, font, size, width - 2 * CELL_PAD), align };
}
function makeMultiCell(
  values: string[],
  font: PDFFont,
  size: number,
  width: number,
  align: Align = "right",
): Cell {
  const lines = values.length
    ? values.flatMap((v) => wrapText(v, font, size, width - 2 * CELL_PAD))
    : ["0"];
  return { lines, align };
}

/** The one table-drawing routine shared by Daily, Groups and Source sales,
 * so all three repeat their header row on every continuation page and never
 * overlap a column — widths are computed up front, text wraps inside its
 * column, and money/quantity columns are right-aligned by measuring the
 * drawn text at the draw font size. */
function drawTable(
  cursor: Cursor,
  title: string,
  columns: Column[],
  rows: Cell[][],
  size = 8,
) {
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
  if (Math.abs(totalWidth - USABLE_WIDTH) > 1)
    throw new Error(`${title} table columns (${totalWidth}pt) must fill the usable page width (${USABLE_WIDTH}pt) with no gap or overlap`);
  const lineHeight = size + LINE_GAP;
  const xs: number[] = [];
  let x = MARGIN;
  for (const c of columns) {
    xs.push(x);
    x += c.width;
  }
  const drawHeader = () => {
    const header = columns.map((c) => makeCell(c.header, cursor.bold, size, c.width, c.align));
    const h = Math.max(...header.map((c) => c.lines.length)) * lineHeight + CELL_PAD;
    drawRow(header, cursor.bold, h);
  };
  const drawRow = (cells: Cell[], font: PDFFont, rowHeight: number) => {
    const top = cursor.y;
    cells.forEach((cell, i) => {
      const colX = xs[i]!,
        width = columns[i]!.width;
      cell.lines.forEach((line, li) => {
        const lineY = top - li * lineHeight;
        const w = font.widthOfTextAtSize(line, size);
        const lx = cell.align === "right" ? colX + width - CELL_PAD - w : colX + CELL_PAD;
        cursor.page.drawText(line, { x: lx, y: lineY - size, size, font });
      });
    });
    cursor.y = top - rowHeight;
  };
  cursor.line(title, 11, true, 6);
  const headerCells = columns.map((c) => makeCell(c.header, cursor.bold, size, c.width, c.align));
  const headerHeight = Math.max(...headerCells.map((c) => c.lines.length)) * lineHeight + CELL_PAD;
  // Reserve room for the header plus at least one data row so a header is
  // never orphaned alone at the bottom of a page.
  const firstRowHeight = rows[0]
    ? Math.max(...rows[0]!.map((c) => c.lines.length)) * lineHeight + CELL_PAD
    : 0;
  cursor.ensure(headerHeight + firstRowHeight);
  drawHeader();
  for (const row of rows) {
    const rowHeight = Math.max(...row.map((c) => c.lines.length)) * lineHeight + CELL_PAD;
    if (cursor.y - rowHeight < BOTTOM) {
      cursor.newPage();
      drawHeader();
    }
    drawRow(row, cursor.regular, rowHeight);
  }
}

function drawTotalsLines(cursor: Cursor, label: string, t: Totals) {
  cursor.line(`${label}: ${plural(t.purchases, "purchase")}`);
  for (const s of t.spend) cursor.line(`  Recorded spend: ${formatMoneyText(s.amountKobo, s.currency)}`);
  if (t.spend.length === 0) cursor.line("  Recorded spend: ₦0.00");
  cursor.line(`  ${quantityLabel(t.litres, "litre")}; ${quantityLabel(t.kilograms, "kilogram")}`);
  for (const p of t.products)
    cursor.line(`  ${PRODUCT_LABEL[p.product] ?? p.product}: ${quantityLabel(p.quantity, p.unit)}`);
}

function sourceStatus(s: ReportSource): string {
  return s.included ? "Included" : `Excluded (${s.exclusion ?? "ineligible"})`;
}
function sourceFlags(s: ReportSource): string {
  const flags = [s.duplicateFlag && "Dup", s.correctionPending && "Corr"].filter(Boolean);
  return flags.length ? flags.join(", ") : "—";
}

async function renderPdf(
  snapshot: ReportSnapshot,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { report: r, sources } = snapshot;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(
      fs.readFileSync(path.join(FONTS_DIR, "NotoSans-Regular.ttf")),
      { subset: true },
    ),
    bold = await doc.embedFont(
      fs.readFileSync(path.join(FONTS_DIR, "NotoSans-Bold.ttf")),
      { subset: true },
    );
  const cursor = new Cursor(doc, regular, bold);

  // Header
  cursor.line("Whales Rewards — operational report", 14, true, 6);
  cursor.line(`${formatDay(r.filters.from)} through ${formatDay(r.filters.to)} inclusive (${r.timezone})`);
  cursor.line("Date basis: Verified or reported sale date");
  cursor.line(`Prepared ${formatLagos(r.asOf)}`);
  cursor.line(`Export ID: ${snapshot.id} · Data version: ${r.dataVersion}`);
  cursor.line(`Filters — Product: ${r.filters.product ? (PRODUCT_LABEL[r.filters.product] ?? r.filters.product) : "All products"}; Group by: ${r.filters.groupBy}`);
  cursor.rule();

  // Summary
  cursor.line("Summary", 12, true, 6);
  drawTotalsLines(cursor, "Totals", r.totals);
  const includedDup = sources.filter((s) => s.included && s.duplicateFlag).length,
    includedCorr = sources.filter((s) => s.included && s.correctionPending).length;
  cursor.line(`Included duplicate flags: ${includedDup}; pending corrections: ${includedCorr}`);
  cursor.line("Excluded from totals:", 10, true);
  for (const e of r.excluded) {
    cursor.line(`  ${e.state}: ${plural(e.records, "record")}`);
    for (const s of e.spend) cursor.line(`    ${formatMoneyText(s.amountKobo, s.currency)}`);
  }

  // Daily
  if (r.daily.length) {
    const columns: Column[] = [
      { header: "Day", width: 100, align: "left" },
      { header: "Purchases", width: 90, align: "right" },
      { header: "Recorded spend", width: 140, align: "right" },
      { header: "Litres", width: 90, align: "right" },
      { header: "Kilograms", width: 95, align: "right" },
    ];
    const rows = r.daily.map((d) => [
      makeCell(formatDay(d.day), regular, 8, columns[0]!.width),
      makeCell(d.totals.purchases, regular, 8, columns[1]!.width, "right"),
      makeMultiCell(
        d.totals.spend.length ? d.totals.spend.map((s) => formatMoneyText(s.amountKobo, s.currency)) : ["₦0.00"],
        regular,
        8,
        columns[2]!.width,
      ),
      makeCell(d.totals.litres, regular, 8, columns[3]!.width, "right"),
      makeCell(d.totals.kilograms, regular, 8, columns[4]!.width, "right"),
    ]);
    drawTable(cursor, "Daily", columns, rows);
    cursor.line("A day with no row is not a claim of zero station sales.", 7);
  }

  // Groups
  if (r.groups.items.length) {
    const columns: Column[] = [
      { header: "Group", width: 115, align: "left" },
      { header: "Attendant staff code", width: 85, align: "left" },
      { header: "Pump code", width: 60, align: "left" },
      { header: "Purchases", width: 55, align: "right" },
      { header: "Recorded spend", width: 90, align: "right" },
      { header: "Litres", width: 55, align: "right" },
      { header: "Kilograms", width: 55, align: "right" },
    ];
    const rows = r.groups.items.map((g) => [
      makeCell(
        g.product ?? g.attendant?.name ?? g.pump?.name ?? g.key,
        regular,
        8,
        columns[0]!.width,
      ),
      makeCell(g.attendant?.staffCode ?? "", regular, 8, columns[1]!.width),
      makeCell(g.pump?.code ?? "", regular, 8, columns[2]!.width),
      makeCell(g.totals.purchases, regular, 8, columns[3]!.width, "right"),
      makeMultiCell(
        g.totals.spend.length ? g.totals.spend.map((s) => formatMoneyText(s.amountKobo, s.currency)) : ["₦0.00"],
        regular,
        8,
        columns[4]!.width,
      ),
      makeCell(g.totals.litres, regular, 8, columns[5]!.width, "right"),
      makeCell(g.totals.kilograms, regular, 8, columns[6]!.width, "right"),
    ]);
    drawTable(cursor, "Groups", columns, rows);
  }

  // Source sales
  if (sources.length > SOURCE_TABLE_CAP) {
    cursor.line("Source sales", 12, true, 6);
    cursor.line(
      `${plural(String(sources.length), "sale")} in this report. Every sale is included in the Excel export.`,
    );
  } else if (sources.length) {
    const columns: Column[] = [
      { header: "Sale code", width: 50, align: "left" },
      { header: "Date", width: 55, align: "left" },
      { header: "Evidence", width: 50, align: "left" },
      { header: "Attendant / pump", width: 95, align: "left" },
      { header: "Product", width: 45, align: "left" },
      { header: "Amount", width: 55, align: "right" },
      { header: "Quantity", width: 60, align: "right" },
      { header: "Status", width: 75, align: "left" },
      { header: "Flags", width: 30, align: "left" },
    ];
    const rows = sources.map((s) => {
      const effectiveDay = s.dateEvidence === "verified" ? (s.verifiedSaleDate ?? s.saleDate) : s.saleDate;
      return [
        makeCell(s.saleCode, regular, 8, columns[0]!.width),
        makeCell(formatDay(effectiveDay), regular, 8, columns[1]!.width),
        makeCell(s.dateEvidence === "verified" ? "Verified" : "Reported", regular, 8, columns[2]!.width),
        makeCell(`${s.attendant.name} / ${s.pump.name}`, regular, 8, columns[3]!.width),
        makeCell(PRODUCT_LABEL[s.product] ?? s.product, regular, 8, columns[4]!.width),
        makeCell(formatMoneyText(s.amountKobo, s.currency), regular, 8, columns[5]!.width, "right"),
        makeCell(quantityLabel(s.quantity, s.unit), regular, 8, columns[6]!.width, "right"),
        makeCell(sourceStatus(s), regular, 8, columns[7]!.width),
        makeCell(sourceFlags(s), regular, 8, columns[8]!.width),
      ];
    });
    drawTable(cursor, "Source sales", columns, rows);
    cursor.line("Dup = duplicate flag · Corr = correction pending", 7);
  }

  // Footer page numbers
  const pages = doc.getPages();
  pages.forEach((p, i) =>
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: MARGIN,
      y: MARGIN - 10,
      size: 9,
      font: regular,
    }),
  );
  return { bytes: await doc.save(), contentType: "application/pdf" };
}

export async function renderReportExport(
  snapshot: ReportSnapshot,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  return snapshot.format === "xlsx" ? renderXlsx(snapshot) : renderPdf(snapshot);
}

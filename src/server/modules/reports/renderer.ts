import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { ReportSnapshot, Totals } from "../../../shared/contracts/reports";
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
function totalsLines(label: string, t: Totals): string[] {
  return [
    `${label}: ${t.purchases} purchases`,
    ...t.spend.map((s) => `${s.currency} ${money(s.amountKobo)}`),
    `${t.litres} litres; ${t.kilograms} kilograms`,
    ...t.products.map(
      (p) =>
        `${p.product}: ${p.quantity} ${p.unit === "litre" ? "litres" : "kilograms"}`,
    ),
  ];
}
export async function renderReportExport(
  snapshot: ReportSnapshot,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const { report: r, sources } = snapshot;
  if (snapshot.format === "xlsx") {
    const book = new ExcelJS.Workbook(),
      report = book.addWorksheet("Report"),
      source = book.addWorksheet("Source sales");
    const text = (v: string) => v; // ExcelJS string cells are inline/shared strings, never formulas.
    report.addRow(["Report", text(snapshot.id)]);
    report.addRow(["From", r.filters.from, "To", r.filters.to]);
    report.addRow([
      "Product",
      r.filters.product ?? "All",
      "Group by",
      r.filters.groupBy,
    ]);
    report.addRow(["As of", r.asOf, "Timezone", r.timezone]);
    report.addRow(["Data version", r.dataVersion, "Date basis", r.dateBasis]);
    const addTotals = (label: string, t: Totals) => {
      report.addRow([
        label,
        "Purchases",
        excelNumber(t.purchases),
        "Litres",
        excelNumber(t.litres),
        "Kilograms",
        excelNumber(t.kilograms),
      ]);
      for (const s of t.spend) {
        const row = report.addRow([
          "Spend",
          s.currency,
          excelNumber(money(s.amountKobo)),
        ]);
        row.getCell(3).numFmt = "0.00";
      }
      for (const p of t.products)
        report.addRow(["Product", p.product, p.unit, excelNumber(p.quantity)]);
    };
    addTotals("Totals", r.totals);
    for (const e of r.excluded) {
      report.addRow(["Excluded", e.state, "Records", excelNumber(e.records)]);
      for (const s of e.spend) {
        const row = report.addRow([
          "Excluded spend",
          s.currency,
          excelNumber(money(s.amountKobo)),
        ]);
        row.getCell(3).numFmt = "0.00";
      }
    }
    for (const d of r.daily) addTotals("Day " + d.day, d.totals);
    for (const g of r.groups.items) {
      report.addRow([
        "Group",
        g.key,
        g.product ?? g.attendant?.name ?? g.pump?.name ?? "",
        g.attendant?.username ?? "",
        g.pump?.code ?? "",
      ]);
      addTotals("Group totals", g.totals);
    }
    source.addRow([
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
    for (const s of sources) {
      const row = source.addRow([
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
        s.product,
        s.unit,
        excelNumber(money(s.amountKobo)),
        s.currency,
        excelNumber(s.quantity),
        s.state,
        s.included,
        s.exclusion ?? "",
        s.valuesSource,
        s.duplicateFlag,
        s.correctionPending,
      ]);
      row.getCell(18).numFmt = "0.00";
      row.getCell(20).numFmt = "0.######";
    }
    report.columns.forEach((c) => (c.width = 24));
    source.columns.forEach((c) => (c.width = 24));
    source.views = [{ state: "frozen", ySplit: 1 }];
    return {
      bytes: new Uint8Array(await book.xlsx.writeBuffer()),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }
  const doc = await PDFDocument.create(),
    font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = [
    `Operational report ${snapshot.id}`,
    `${r.filters.from} through ${r.filters.to} inclusive (${r.timezone})`,
    `Product: ${r.filters.product ?? "All"}; group: ${r.filters.groupBy}`,
    `Snapshot: ${r.asOf}; generation: ${r.dataVersion}`,
    `Date basis: ${r.dateBasis}`,
    ...totalsLines("Totals", r.totals),
    ...r.excluded.flatMap((e) => [
      `Excluded ${e.state}: ${e.records} records`,
      ...e.spend.map((s) => `${s.currency} ${money(s.amountKobo)}`),
    ]),
    ...r.daily.flatMap((d) => totalsLines("Day " + d.day, d.totals)),
    ...r.groups.items.flatMap((g) => [
      `Group ${g.key}: ${g.product ?? g.attendant?.name ?? g.pump?.name ?? ""}`,
      ...(g.attendant
        ? [`Staff ${g.attendant.staffCode}; username ${g.attendant.username}`]
        : []),
      ...(g.pump ? [`Pump ${g.pump.code}; product ${g.pump.product}`] : []),
      ...totalsLines("Group totals", g.totals),
    ]),
  ];
  // Preserve non-WinAnsi text explicitly as Unicode escapes rather than dropping it.
  const safe = (s: string) =>
    [...s]
      .map((c) => {
        try {
          font.encodeText(c);
          return c;
        } catch {
          return "\\u{" + c.codePointAt(0)!.toString(16) + "}";
        }
      })
      .join("");
  let page = doc.addPage([595, 842]),
    y = 800;
  for (const line of lines) {
    const clean = safe(line);
    let part = "";
    const draw = () => {
      if (y < 55) {
        page = doc.addPage([595, 842]);
        y = 800;
      }
      page.drawText(part, { x: 36, y, size: 10, font });
      y -= 15;
    };
    for (const character of clean) {
      if (part && font.widthOfTextAtSize(part + character, 10) > 523) {
        draw();
        part = "";
      }
      part += character;
    }
    if (part) draw();
  }
  doc.getPages().forEach((p, i) =>
    p.drawText(`Page ${i + 1} of ${doc.getPageCount()}`, {
      x: 36,
      y: 25,
      size: 9,
      font,
    }),
  );
  return { bytes: await doc.save(), contentType: "application/pdf" };
}

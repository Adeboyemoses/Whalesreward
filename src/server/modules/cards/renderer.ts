import ExcelJS from "exceljs";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import QRCode from "qrcode";
import { CARD_ALPHABET } from "../../../shared/contracts/sync";

/** Every physical dimension is explicitly configured in millimetres; no stock is assumed. */
export type CardPrintLayout = {
  pageWidthMm: number;
  pageHeightMm: number;
  cardWidthMm: number;
  cardHeightMm: number;
  marginMm: number;
  gapMm: number;
};
type CardExportSnapshot = {
  id: string;
  format: "pdf" | "xlsx";
  snapshotAt: string;
  batch: {
    id: string;
    code: string;
    name: string;
    status: "generated" | "printed" | "active";
    version: number;
  };
  items: {
    ordinal: number;
    code: string;
    qrPayload: string;
    state: "unassigned" | "linked" | "retired";
    assignmentEligible: boolean;
  }[];
};

const mm = (value: number) => (value * 72) / 25.4;
const FOOTER_MM = 8;
const exactCardCode = new RegExp(`^[${CARD_ALPHABET}]{7}$`);

export function validateCardPrintLayout(layout: CardPrintLayout) {
  const {
    pageWidthMm: pw,
    pageHeightMm: ph,
    cardWidthMm: cw,
    cardHeightMm: ch,
    marginMm: margin,
    gapMm: gap,
  } = layout;
  if (
    ![pw, ph, cw, ch, margin, gap].every(Number.isFinite) ||
    pw <= 0 ||
    ph <= 0 ||
    pw > 1000 ||
    ph > 1000 ||
    cw < 40 ||
    ch < 35 ||
    margin < 0 ||
    gap < 0
  )
    throw new Error("print_layout_invalid");
  const columns = Math.floor((pw - 2 * margin + gap) / (cw + gap));
  const rows = Math.floor((ph - 2 * margin - FOOTER_MM + gap) / (ch + gap));
  if (columns < 1 || rows < 1) throw new Error("print_layout_invalid");
  return { columns, rows };
}

// Standard PDF fonts cannot represent arbitrary Unicode. Make unsupported characters
// explicit and lossless as visible Unicode escapes, rather than dropping glyphs.
function printable(value: string) {
  return Array.from(value)
    .map((character) => {
      const code = character.codePointAt(0)!;
      return code >= 32 && code <= 126
        ? character
        : `\\u{${code.toString(16).toUpperCase()}}`;
    })
    .join("");
}
function spreadsheetText(value: string) {
  return /^[\s]*[=+@-]|^[\t\r\n]/u.test(value) ? `'${value}` : value;
}

function label(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  width: number,
) {
  // Labels stay inside their card even at the smallest supported dimensions.
  let size = 7;
  while (font.widthOfTextAtSize(text, size) > width && size > 4) size -= 0.25;
  let visible = text;
  while (font.widthOfTextAtSize(visible, size) > width)
    visible = visible.slice(0, -1);
  if (visible !== text) visible = `${visible.slice(0, -3)}...`;
  page.drawText(visible, { x, y, size, font });
}

export async function renderCardExport(
  snapshot: CardExportSnapshot,
  layout?: CardPrintLayout,
): Promise<{
  bytes: Uint8Array;
  contentType: string;
  extension: "pdf" | "xlsx";
}> {
  // Input comes only from a stored inventory snapshot, never live customer joins.
  // Validate the v1 payload without normalization: URLs/whitespace are never QR authority.
  if (
    snapshot.items.length > 1000 ||
    snapshot.items.some(
      (item) => !exactCardCode.test(item.code) || item.qrPayload !== item.code,
    )
  )
    throw new Error("invalid_card_snapshot");
  const items = [...snapshot.items].sort((a, b) => a.ordinal - b.ordinal);
  if (snapshot.format === "xlsx") {
    const book = new ExcelJS.Workbook();
    const cards = book.addWorksheet("Cards");
    cards.addRow([
      "Ordinal",
      "Code",
      "QR payload",
      "State",
      "Batch ID",
      "Batch status",
      "Assignment eligible at snapshot",
    ]);
    for (const item of items)
      cards.addRow([
        item.ordinal,
        item.code,
        item.qrPayload,
        item.state,
        spreadsheetText(snapshot.batch.id),
        snapshot.batch.status,
        item.assignmentEligible,
      ]);
    for (const column of [2, 3, 4, 5, 6]) cards.getColumn(column).numFmt = "@";
    const metadata = book.addWorksheet("Export");
    metadata.addRows([
      ["Field", "Value"],
      ["Export ID", spreadsheetText(snapshot.id)],
      ["Snapshot at", spreadsheetText(snapshot.snapshotAt)],
      ["Batch ID", spreadsheetText(snapshot.batch.id)],
      ["Batch code", spreadsheetText(snapshot.batch.code)],
      ["Batch name", spreadsheetText(snapshot.batch.name)],
      ["Batch status", snapshot.batch.status],
      ["Batch version", snapshot.batch.version],
      [
        "Eligibility",
        "Informational snapshot only; recheck current inventory before assignment.",
      ],
    ]);
    return {
      bytes: new Uint8Array(await book.xlsx.writeBuffer()),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: "xlsx",
    };
  }
  if (!layout) throw new Error("print_layout_unconfigured");
  const { columns, rows } = validateCardPrintLayout(layout);
  const printableItems = items.filter((item) => item.state === "unassigned");
  if (!printableItems.length) throw new Error("no_printable_cards");
  const doc = await PDFDocument.create();
  doc.setTitle(`Card batch ${snapshot.batch.code}: ${snapshot.batch.name}`);
  doc.setSubject(
    `Export ${snapshot.id}; snapshot ${snapshot.snapshotAt}; status ${snapshot.batch.status}; version ${snapshot.batch.version}`,
  );
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const codeFont = await doc.embedFont(StandardFonts.CourierBold);
  const perPage = columns * rows;
  const pageCount = Math.ceil(printableItems.length / perPage);
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = doc.addPage([mm(layout.pageWidthMm), mm(layout.pageHeightMm)]);
    const pageItems = printableItems.slice(
      pageIndex * perPage,
      (pageIndex + 1) * perPage,
    );
    for (const [index, item] of pageItems.entries()) {
      const x = mm(
        layout.marginMm +
          (index % columns) * (layout.cardWidthMm + layout.gapMm),
      );
      const top = mm(
        layout.pageHeightMm -
          layout.marginMm -
          Math.floor(index / columns) * (layout.cardHeightMm + layout.gapMm),
      );
      const width = mm(layout.cardWidthMm);
      const height = mm(layout.cardHeightMm);
      page.drawRectangle({
        x,
        y: top - height,
        width,
        height,
        borderWidth: 0.3,
        borderColor: rgb(0.7, 0.7, 0.7),
      });
      label(
        page,
        font,
        printable(snapshot.batch.name),
        x + mm(2),
        top - mm(3),
        width - mm(4),
      );
      label(
        page,
        font,
        `${printable(snapshot.batch.code)} | ${snapshot.batch.status}`,
        x + mm(2),
        top - mm(6),
        width - mm(4),
      );
      // Four modules of white quiet zone and integer-pixel modules prevent resampling
      // artefacts in the source image; the physical QR side is always at least 21 mm.
      const image = await doc.embedPng(
        await QRCode.toBuffer(item.qrPayload, {
          type: "png",
          margin: 4,
          scale: 8,
          errorCorrectionLevel: "M",
        }),
      );
      const side = mm(
        Math.min(30, layout.cardHeightMm - 14, layout.cardWidthMm - 6),
      );
      page.drawImage(image, {
        x: x + (width - side) / 2,
        y: top - mm(8) - side,
        width: side,
        height: side,
      });
      const codeSize = 11;
      page.drawText(item.code, {
        x: x + (width - codeFont.widthOfTextAtSize(item.code, codeSize)) / 2,
        y: top - height + mm(2),
        font: codeFont,
        size: codeSize,
      });
    }
    page.drawText(`Page ${pageIndex + 1} of ${pageCount}`, {
      x: mm(layout.marginMm),
      y: mm(3),
      size: 8,
      font,
    });
  }
  return {
    bytes: await doc.save(),
    contentType: "application/pdf",
    extension: "pdf",
  };
}

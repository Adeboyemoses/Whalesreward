import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  decodePDFRawStream,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
} from "pdf-lib";
import jsQR from "jsqr";
import { renderCardExport, type CardPrintLayout } from "./renderer";

const layout: CardPrintLayout = {
  pageWidthMm: 100,
  pageHeightMm: 100,
  cardWidthMm: 85,
  cardHeightMm: 54,
  marginMm: 5,
  gapMm: 2,
};
const snapshot = {
  id: "export-1",
  format: "pdf" as "pdf" | "xlsx",
  snapshotAt: "2026-11-09T10:00:00.000Z",
  batch: {
    id: "batch-1",
    code: "BATCH001",
    name: "Test batch",
    status: "active" as const,
    version: 3,
  },
  items: [
    {
      ordinal: 1,
      code: "ABCDEFG",
      qrPayload: "ABCDEFG",
      state: "unassigned" as const,
      assignmentEligible: true,
    },
    {
      ordinal: 2,
      code: "2345678",
      qrPayload: "2345678",
      state: "linked" as const,
      assignmentEligible: false,
    },
    {
      ordinal: 3,
      code: "XYZ2345",
      qrPayload: "XYZ2345",
      state: "retired" as const,
      assignmentEligible: false,
    },
    {
      ordinal: 4,
      code: "7654329",
      qrPayload: "7654329",
      state: "unassigned" as const,
      assignmentEligible: true,
    },
  ],
};

function pageText(doc: PDFDocument, index: number) {
  const contents = doc.getPage(index).node.Contents();
  const streams =
    contents && "asArray" in contents ? contents.asArray() : [contents];
  return streams
    .map((ref) => {
      const stream = doc.context.lookup(ref);
      return stream instanceof PDFRawStream
        ? Buffer.from(decodePDFRawStream(stream).decode()).toString()
        : "";
    })
    .join("\n");
}
function decodedImages(doc: PDFDocument) {
  return doc.context.enumerateIndirectObjects().flatMap(([, object]) => {
    if (
      !(object instanceof PDFRawStream) ||
      object.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")
    )
      return [];
    const width = object.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber();
    const height = object.dict
      .lookup(PDFName.of("Height"), PDFNumber)
      .asNumber();
    const bytes = decodePDFRawStream(object).decode();
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4] = bytes[i * 3]!;
      pixels[i * 4 + 1] = bytes[i * 3 + 1]!;
      pixels[i * 4 + 2] = bytes[i * 3 + 2]!;
      pixels[i * 4 + 3] = 255;
    }
    return [jsQR(pixels, width, height)?.data];
  });
}

describe("card export renderer", () => {
  it("prints only unassigned snapshot cards, actual decodable QRs, labels and page numbers", async () => {
    const result = await renderCardExport(snapshot, layout);
    expect(result.contentType).toBe("application/pdf");
    expect(result.extension).toBe("pdf");
    expect(Buffer.from(result.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(result.bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(decodedImages(doc).sort()).toEqual(["7654329", "ABCDEFG"]);
    const first = pageText(doc, 0);
    const second = pageText(doc, 1);
    // PDF hexadecimal text bytes independently encode visible labels/codes.
    expect(first).toContain(
      Buffer.from("ABCDEFG").toString("hex").toUpperCase(),
    );
    expect(first).toContain(
      Buffer.from("Test batch").toString("hex").toUpperCase(),
    );
    expect(first).toContain(
      Buffer.from("active").toString("hex").toUpperCase(),
    );
    expect(first).toContain(
      Buffer.from("Page 1 of 2").toString("hex").toUpperCase(),
    );
    expect(second).toContain(
      Buffer.from("Page 2 of 2").toString("hex").toUpperCase(),
    );
    expect(first + second).not.toContain(
      Buffer.from("2345678").toString("hex").toUpperCase(),
    );
  });

  it("handles Unicode metadata visibly with Unicode escapes rather than missing glyphs", async () => {
    const result = await renderCardExport(
      { ...snapshot, batch: { ...snapshot.batch, name: "Fuel 😀 <安全>" } },
      layout,
    );
    const doc = await PDFDocument.load(result.bytes);
    expect(pageText(doc, 0)).toContain(
      Buffer.from("Fuel \\u{1F600} <\\u{5B89}\\u{5168}>")
        .toString("hex")
        .toUpperCase(),
    );
  });

  it("writes all states, raw QR, text codes, eligibility and immutable export metadata to XLSX", async () => {
    const result = await renderCardExport({
      ...snapshot,
      format: "xlsx",
      batch: { ...snapshot.batch, name: '=HYPERLINK("bad")' },
    });
    expect(result.extension).toBe("xlsx");
    expect(result.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(Buffer.from(result.bytes).subarray(0, 2).toString()).toBe("PK");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(result.bytes).buffer);
    const cards = book.getWorksheet("Cards")!;
    expect(cards.rowCount).toBe(5);
    expect(cards.getCell("B3").value).toBe("2345678");
    expect(cards.getCell("B3").numFmt).toBe("@");
    expect(cards.getCell("B3").type).toBe(ExcelJS.ValueType.String);
    expect(cards.getRow(4).values).toEqual([
      undefined,
      3,
      "XYZ2345",
      "XYZ2345",
      "retired",
      "batch-1",
      "active",
      false,
    ]);
    expect(cards.getCell("G2").value).toBe(true);
    const metadata = book.getWorksheet("Export")!;
    expect(metadata.getCell("B2").value).toBe("export-1");
    expect(metadata.getCell("B3").value).toBe("2026-11-09T10:00:00.000Z");
    expect(metadata.getCell("B6").value).toBe('\'=HYPERLINK("bad")');
    expect(metadata.getCell("B8").value).toBe(3);
  });

  it.each(["=1+1", "+cmd", "-1+2", "@SUM(A1)", "\t=1", "\r=1", "\n=1", "  =1"])(
    "neutralizes formula-like text metadata %j",
    async (name) => {
      const result = await renderCardExport({
        ...snapshot,
        format: "xlsx",
        batch: { ...snapshot.batch, name },
      });
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(Uint8Array.from(result.bytes).buffer);
      const cell = book.getWorksheet("Export")!.getCell("B6");
      // XML parsers normalize carriage returns to line feeds.
      expect(cell.value).toBe(`'${name.replace(/\r/g, "\n")}`);
      expect(cell.type).toBe(ExcelJS.ValueType.String);
    },
  );

  it("requires explicit PDF layout while XLSX works independently", async () => {
    await expect(renderCardExport(snapshot)).rejects.toThrow(
      "print_layout_unconfigured",
    );
  });
  it.each([
    { pageWidthMm: NaN },
    { pageHeightMm: Infinity },
    { cardHeightMm: 0 },
    { marginMm: -1 },
    { gapMm: -1 },
    { pageWidthMm: 1001 },
    { cardWidthMm: 10 },
    { cardHeightMm: 20 },
    { marginMm: 30 },
    { gapMm: Infinity },
    { pageHeightMm: 62 },
  ])("rejects unsafe or non-fitting layout %j", async (change) => {
    await expect(
      renderCardExport(snapshot, { ...layout, ...change }),
    ).rejects.toThrow("print_layout_invalid");
  });
  it("rejects empty PDF printable inventory", async () => {
    await expect(
      renderCardExport(
        {
          ...snapshot,
          items: snapshot.items.filter((item) => item.state !== "unassigned"),
        },
        layout,
      ),
    ).rejects.toThrow("no_printable_cards");
  });
  it.each(["https://example.com/ABCDEFG", "abcdefg", "ABCDEFG\n", "XYZ2345"])(
    "rejects payload that is not exactly its normalized printed code: %j",
    async (qrPayload) => {
      await expect(
        renderCardExport(
          { ...snapshot, items: [{ ...snapshot.items[0]!, qrPayload }] },
          layout,
        ),
      ).rejects.toThrow("invalid_card_snapshot");
    },
  );
  it("keeps four-module QR quiet zones and decodable pixels at the minimum configured card size", async () => {
    const result = await renderCardExport(
      { ...snapshot, items: [snapshot.items[0]!] },
      {
        pageWidthMm: 50,
        pageHeightMm: 53,
        cardWidthMm: 40,
        cardHeightMm: 35,
        marginMm: 5,
        gapMm: 0,
      },
    );
    const doc = await PDFDocument.load(result.bytes);
    expect(decodedImages(doc)).toEqual(["ABCDEFG"]);
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      if (
        !(object instanceof PDFRawStream) ||
        object.dict.get(PDFName.of("Subtype")) !== PDFName.of("Image")
      )
        continue;
      const width = object.dict
        .lookup(PDFName.of("Width"), PDFNumber)
        .asNumber();
      const bytes = decodePDFRawStream(object).decode();
      // QR v1 is 21 modules, plus 4 white modules on every side, at 8px/module.
      expect(width).toBe(232);
      expect(
        [...bytes.subarray(0, width * 32 * 3)].every((byte) => byte === 255),
      ).toBe(true);
      for (let row = 0; row < width; row++) {
        expect(
          [...bytes.subarray(row * width * 3, (row * width + 32) * 3)].every(
            (byte) => byte === 255,
          ),
        ).toBe(true);
        expect(
          [
            ...bytes.subarray(
              ((row + 1) * width - 32) * 3,
              (row + 1) * width * 3,
            ),
          ].every((byte) => byte === 255),
        ).toBe(true);
      }
      expect(
        [...bytes.subarray((width - 32) * width * 3)].every(
          (byte) => byte === 255,
        ),
      ).toBe(true);
    }
    // Physical image is 21mm square, with 8mm label space and 6mm code space.
    const imageTransform = [
      ...pageText(doc, 0).matchAll(/([\d.]+) 0 0 ([\d.]+) 0 0 cm/g),
    ].find((match) => Number(match[1]) > 1);
    expect(imageTransform).not.toBeNull();
    expect(Number(imageTransform![1])).toBeCloseTo((21 * 72) / 25.4, 6);
  });

  it("prints unassigned cards in non-active batches without claiming assignment eligibility", async () => {
    const result = await renderCardExport(
      {
        ...snapshot,
        batch: { ...snapshot.batch, status: "generated" },
        items: [{ ...snapshot.items[0]!, assignmentEligible: false }],
      },
      layout,
    );
    const doc = await PDFDocument.load(result.bytes);
    expect(decodedImages(doc)).toEqual(["ABCDEFG"]);
    expect(pageText(doc, 0)).toContain(
      Buffer.from("generated").toString("hex").toUpperCase(),
    );
  });

  it("neutralizes every free-text XLSX metadata field and retains Unicode labels", async () => {
    const result = await renderCardExport({
      ...snapshot,
      format: "xlsx",
      id: "=export",
      snapshotAt: "+time",
      batch: {
        ...snapshot.batch,
        id: "@batch",
        code: "-code",
        name: "安全 😀",
      },
    });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(result.bytes).buffer);
    const meta = book.getWorksheet("Export")!;
    expect([2, 3, 4, 5, 6].map((row) => meta.getCell(`B${row}`).value)).toEqual(
      ["'=export", "'+time", "'@batch", "'-code", "安全 😀"],
    );
    expect(book.getWorksheet("Cards")!.getCell("E2").value).toBe("'@batch");
  });

  it("rejects printed codes outside the v1 alphabet even when payload matches", async () => {
    await expect(
      renderCardExport({
        ...snapshot,
        format: "xlsx",
        items: [
          { ...snapshot.items[0]!, code: "ABCDEFI", qrPayload: "ABCDEFI" },
        ],
      }),
    ).rejects.toThrow("invalid_card_snapshot");
  });

  it("rejects more than the bounded 1000-card snapshot", async () => {
    await expect(
      renderCardExport({
        ...snapshot,
        format: "xlsx",
        items: Array.from({ length: 1001 }, () => snapshot.items[0]!),
      }),
    ).rejects.toThrow("invalid_card_snapshot");
  });

  it("sorts by snapshot ordinal and does not mutate input", async () => {
    const input = { ...snapshot, items: [...snapshot.items].reverse() };
    const result = await renderCardExport(input, layout);
    const doc = await PDFDocument.load(result.bytes);
    expect(pageText(doc, 0)).toContain(
      Buffer.from("ABCDEFG").toString("hex").toUpperCase(),
    );
    expect(input.items[0]!.ordinal).toBe(4);
  });
});

import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFNumber,
} from "pdf-lib";
import { inflateSync } from "node:zlib";
import jsQR from "jsqr";
/** Decode the embedded, lossless PDF QR images independently of the renderer. */
export async function decodedPDFCodes(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes);
  const codes: string[] = [];
  for (const page of pdf.getPages()) {
    const objects = page.node
      .Resources()
      ?.lookup(PDFName.of("XObject"), PDFDict);
    if (!objects) continue;
    for (const [, ref] of objects.entries()) {
      const image = pdf.context.lookup(ref);
      if (
        !(image instanceof PDFRawStream) ||
        image.dict.get(PDFName.of("Subtype"))?.toString() !== "/Image"
      )
        continue;
      const width = image.dict
          .lookup(PDFName.of("Width"), PDFNumber)
          .asNumber(),
        height = image.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber();
      const raw = inflateSync(image.contents);
      if (raw.length !== width * height * 3)
        throw new Error("Unexpected QR image encoding");
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = raw[i * 3]!;
        rgba[i * 4 + 1] = raw[i * 3 + 1]!;
        rgba[i * 4 + 2] = raw[i * 3 + 2]!;
        rgba[i * 4 + 3] = 255;
      }
      const decoded = jsQR(rgba, width, height);
      if (!decoded) throw new Error("Prepared PDF QR cannot be decoded");
      codes.push(decoded.data);
    }
  }
  return codes.sort();
}

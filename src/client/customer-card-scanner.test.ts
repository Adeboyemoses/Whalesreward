import { describe, expect, it, vi, afterEach } from "vitest";
import { cardDetector, cardQrValue } from "./customer-card-scanner";
afterEach(() => vi.unstubAllGlobals());
describe("replacement card QR", () => {
  it("uses the exact versioned card parser for QR and printed-code identity", () => {
    expect(cardQrValue(" abcd234 ")).toBe("ABCD234");
    for (const invalid of [
      "https://example.com/ABCD234",
      "ABCD23",
      "ABCD230",
      "ABCDEFGH",
      " ".repeat(257),
    ])
      expect(cardQrValue(invalid)).toBeNull();
  });
  it("offers typed-code fallback if QR detection is unsupported", () => {
    vi.stubGlobal("BarcodeDetector", undefined);
    expect(cardDetector()).toBeNull();
    vi.stubGlobal(
      "BarcodeDetector",
      class {
        constructor() {
          throw new Error("Unsupported format");
        }
      },
    );
    expect(cardDetector()).toBeNull();
  });
});

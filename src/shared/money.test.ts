import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAX_KOBO, parseKobo, parseNaira, formatNaira } from "./money";

describe("exact money", () => {
  it("parses kobo over the wire and formats Nigerian money without floats", () => {
    expect(parseKobo("9007199254740993")).toBe(9007199254740993n);
    expect(formatNaira(2000000n)).toBe("₦20,000.00");
    expect(formatNaira(MAX_KOBO)).toBe("₦92,233,720,368,547,758.07");
    expect(parseNaira("20000.01")).toBe(2000001n);
  });
  it("roundtrips every supported nonnegative kobo amount", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: MAX_KOBO }), (kobo) => {
        expect(parseKobo(kobo.toString())).toBe(kobo);
        expect(parseNaira(formatNaira(kobo).replace(/[₦,]/g, ""))).toBe(kobo);
      }),
      { numRuns: 500 },
    );
  });
  it("rejects malformed, signed, floating and overflowing inputs", () => {
    for (const value of [
      "",
      " 1",
      "1e3",
      "1.2",
      "-1",
      "+1",
      "NaN",
      "9223372036854775808",
    ])
      expect(() => parseKobo(value)).toThrow();
    for (const value of [
      "1.001",
      "1.",
      ".1",
      "-1",
      "92,000",
      "92233720368547758.08",
    ])
      expect(() => parseNaira(value)).toThrow();
    expect(() => formatNaira(-1n)).toThrow();
  });
});

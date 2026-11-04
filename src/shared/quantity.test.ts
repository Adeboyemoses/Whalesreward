import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  amountToQuantity,
  quantityToAmount,
  parseQuantity,
  formatQuantity,
  addQuantities,
} from "./quantity";

describe("exact quantity and captured arithmetic (I-29, I-44)", () => {
  it("preserves entered spend even when the rounded quantity cannot reconstruct it", () => {
    expect(amountToQuantity(100n, 300n, 2)).toBe("0.33");
    expect(quantityToAmount("0.33", 300n, 2)).toBe(99n);
  });
  it("rounds half-up exactly once", () => {
    expect(quantityToAmount("0.005", 100n, 3)).toBe(1n);
    expect(() => quantityToAmount("0.004999", 100n, 6)).toThrow();
    expect(amountToQuantity(1n, 8n, 2)).toBe("0.13");
  });
  it("supports exact values beyond binary integer precision", () => {
    expect(quantityToAmount("90071992547.40993", 100000n, 5)).toBe(
      9007199254740993n,
    );
    expect(parseQuantity("99999999999999.999999")).toBe(99999999999999999999n);
  });
  it("quantity mode matches exact rational half-up for generated inputs", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1000n, max: 999999999n }),
        fc.bigInt({ min: 1n, max: 999999n }),
        (scaled, rate) => {
          const input = `${scaled / 1000n}.${(scaled % 1000n).toString().padStart(3, "0")}`;
          expect(quantityToAmount(input, rate, 3)).toBe(
            (scaled * rate * 2n + 1000n) / 2000n,
          );
        },
      ),
      { numRuns: 500 },
    );
  });
  it("amount mode rounding stays within half a captured quantity step", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1000000n, max: 999999999n }),
        fc.bigInt({ min: 1n, max: 999999n }),
        (amount, rate) => {
          const rounded = parseQuantity(amountToQuantity(amount, rate, 3));
          const delta = rounded * rate - amount * 1000000n;
          expect((delta < 0n ? -delta : delta) * 2n).toBeLessThanOrEqual(
            rate * 1000n,
          );
        },
      ),
      { numRuns: 500 },
    );
  });
  it("rejects invalid precision, finer digits, nonpositive rate and quantity, overflow", () => {
    for (const input of [
      "0",
      "-1",
      "1e2",
      "1.",
      " 1",
      "1.0000001",
      "100000000000000",
    ])
      expect(() => parseQuantity(input)).toThrow();
    expect(() => parseQuantity("1.001", 2)).toThrow();
    expect(parseQuantity("1.000", 2)).toBe(1000000n);
    for (const precision of [-1, 7, 1.5, NaN])
      expect(() => amountToQuantity(1n, 1n, precision)).toThrow();
    expect(() => amountToQuantity(0n, 1n, 2)).toThrow();
    expect(() => amountToQuantity(1n, 0n, 2)).toThrow();
    expect(() => amountToQuantity(1n, 100000n, 2)).toThrow();
    expect(() =>
      quantityToAmount("99999999999999", 9223372036854775807n, 0),
    ).toThrow();
  });
  it("displays captured precision and prevents adding litres to kilograms", () => {
    expect(formatQuantity("20", "litre", 2)).toBe("20 litres");
    expect(formatQuantity("5.25", "kilogram", 2)).toBe("5.25 kg");
    expect(
      addQuantities(
        { quantity: "1.2", unit: "litre" },
        { quantity: "2.3", unit: "litre" },
      ),
    ).toEqual({ quantity: "3.5", unit: "litre" });
    expect(() =>
      addQuantities(
        { quantity: "1", unit: "litre" },
        { quantity: "1", unit: "kilogram" },
      ),
    ).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { formatAmountInput } from "./amount-input";

describe("blurred amount display", () => {
  it.each([
    ["20000", "20,000.00"],
    ["20000.01", "20,000.01"],
    ["100.1", "100.10"],
    ["00020000.01", "20,000.01"],
    ["92233720368547758.07", "92,233,720,368,547,758.07"],
  ])("formats %s exactly as %s", (raw, displayed) => {
    expect(formatAmountInput(raw)).toBe(displayed);
  });

  it.each(["", "1.001", "1e3", "20,000", "-1", "1.", "92233720368547758.08"])(
    "leaves invalid or incomplete input %s intact for correction",
    (raw) => expect(formatAmountInput(raw)).toBe(raw),
  );
});

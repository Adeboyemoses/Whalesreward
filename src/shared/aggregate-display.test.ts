import { expect, it } from "vitest";
import {
  formatAggregateNaira,
  formatAggregateQuantity,
} from "./aggregate-display";
it("formats aggregate kobo exactly above BIGINT and safe Number ranges", () => {
  expect(formatAggregateNaira("999999999999999999999999999999")).toBe(
    "₦9,999,999,999,999,999,999,999,999,999.99",
  );
  expect(formatAggregateNaira("0")).toBe("₦0.00");
});
it("formats zero and wide quantities without combining units", () => {
  expect(
    formatAggregateQuantity("999999999999999999999999.123456", "kilogram"),
  ).toBe("999999999999999999999999.123456 kilograms");
  expect(formatAggregateQuantity("0.000000", "litre")).toBe("0 litres");
});
it("rejects malformed, out of bounds and unknown units", () => {
  for (const value of ["-1", "1.2", "1e6", "9".repeat(31)])
    expect(() => formatAggregateNaira(value)).toThrow();
  expect(() => formatAggregateQuantity("1.1234567", "litre")).toThrow();
  expect(() => formatAggregateQuantity("9".repeat(25), "litre")).toThrow();
});
it("does not relax purchase input bounds", async () => {
  const { parseKobo } = await import("./money");
  const { parseQuantity } = await import("./quantity");
  expect(() => parseKobo("999999999999999999999999999999")).toThrow();
  expect(() => parseQuantity("0")).toThrow();
  expect(() => parseQuantity("999999999999999999999999.123456")).toThrow();
});
it("rejects direct non-string inputs instead of coercing rounded numbers", () => {
  const unchecked: unknown[] = [
    0,
    9007199254740991,
    Number("9007199254740993"),
    1n,
    null,
    undefined,
    new String("12"),
    { toString: () => "12" },
  ];
  for (const value of unchecked) {
    expect(() => formatAggregateNaira(value as string)).toThrow(
      "Expected nonnegative aggregate kobo",
    );
    expect(() => formatAggregateQuantity(value as string, "litre")).toThrow(
      "Expected nonnegative aggregate quantity and unit",
    );
  }
});
it("preserves exact decimal strings across safe-integer and BIGINT boundaries", () => {
  for (const [input, expected] of [
    ["9007199254740991", "₦90,071,992,547,409.91"],
    ["9007199254740992", "₦90,071,992,547,409.92"],
    ["9007199254740993", "₦90,071,992,547,409.93"],
    ["9223372036854775807", "₦92,233,720,368,547,758.07"],
    ["9223372036854775808", "₦92,233,720,368,547,758.08"],
  ] as const) {
    expect(formatAggregateNaira(input)).toBe(expected);
    expect(formatAggregateQuantity(input + ".123456", "litre")).toBe(
      input + ".123456 litres",
    );
  }
});
it("rejects unknown units explicitly", () => {
  expect(() => formatAggregateQuantity("12", "gallon" as never)).toThrow(
    "Expected nonnegative aggregate quantity and unit",
  );
});

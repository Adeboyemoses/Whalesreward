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

import type { QuantityUnit } from "./quantity";
/** Read-only aggregate display; does not expand purchase/input money bounds. */
export function formatAggregateNaira(value: string): string {
  if (!/^(0|[1-9][0-9]{0,29})$/.test(value))
    throw new TypeError("Expected nonnegative aggregate kobo");
  const kobo = BigInt(value),
    whole = (kobo / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₦${whole}.${(kobo % 100n).toString().padStart(2, "0")}`;
}
/** Quantities retain the server's separate product/unit projection, including zero totals. */
export function formatAggregateQuantity(
  value: string,
  unit: QuantityUnit,
): string {
  if (
    !/^\d{1,24}(?:\.\d{1,6})?$/.test(value) ||
    (unit !== "litre" && unit !== "kilogram")
  )
    throw new TypeError("Expected nonnegative aggregate quantity and unit");
  const [whole = "", fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return `${BigInt(whole).toString()}${trimmed ? "." + trimmed : ""} ${unit === "litre" ? "litres" : "kilograms"}`;
}

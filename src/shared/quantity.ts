import { assertMoney } from "./money";

export type QuantityUnit = "litre" | "kilogram";
export type UnitQuantity = { quantity: string; unit: QuantityUnit };
export const QUANTITY_SCALE = 1000000n;
export const MAX_QUANTITY_SCALED = 99999999999999999999n;
/** T-10: provisional tie rule; replacing it must preserve captured results. */
export const ROUNDING_MODE = "half-up" as const;

function checkPrecision(precision: number): void {
  if (!Number.isInteger(precision) || precision < 0 || precision > 6)
    throw new RangeError("Quantity precision must be 0 to 6");
}

function checkUnit(unit: QuantityUnit): void {
  if (unit !== "litre" && unit !== "kilogram")
    throw new TypeError("Unsupported quantity unit");
}

function assertQuantity(scaled: bigint): bigint {
  if (scaled <= 0n || scaled > MAX_QUANTITY_SCALED)
    throw new RangeError("Quantity is outside NUMERIC(20,6) positive range");
  return scaled;
}

/** Exact micro-units, suitable for arithmetic only; strings remain the wire representation. */
export function parseQuantity(value: string, precision = 6): bigint {
  checkPrecision(precision);
  if (typeof value !== "string" || !/^\d{1,14}(?:\.\d{1,6})?$/.test(value))
    throw new TypeError("Expected positive decimal quantity");
  const [whole = "", fraction = ""] = value.split(".");
  if (/[1-9]/.test(fraction.slice(precision)))
    throw new RangeError("Quantity exceeds captured precision");
  return assertQuantity(
    BigInt(whole) * QUANTITY_SCALE + BigInt(fraction.padEnd(6, "0")),
  );
}

function decimalString(scaled: bigint, precision: number): string {
  const fraction = (scaled % QUANTITY_SCALE)
    .toString()
    .padStart(6, "0")
    .slice(0, precision)
    .replace(/0+$/, "");
  return `${scaled / QUANTITY_SCALE}${fraction ? `.${fraction}` : ""}`;
}

function roundRatio(numerator: bigint, denominator: bigint): bigint {
  // Positive values only: exactly one nearest rounding, with ties upwards.
  if (ROUNDING_MODE === "half-up")
    return (numerator * 2n + denominator) / (denominator * 2n);
  throw new Error("Unsupported rounding mode");
}

/** Amount mode: caller retains entered amount; rounded quantity must never reconstruct spend. */
export function amountToQuantity(
  amountKobo: bigint,
  rateKobo: bigint,
  precision: number,
): string {
  assertMoney(amountKobo, true);
  assertMoney(rateKobo, true);
  checkPrecision(precision);
  const step = 10n ** BigInt(6 - precision);
  const scaled =
    roundRatio(amountKobo * QUANTITY_SCALE, rateKobo * step) * step;
  return decimalString(assertQuantity(scaled), precision);
}

/** Quantity mode: multiply the exact entered quantity by captured rate and round money once. */
export function quantityToAmount(
  quantity: string,
  rateKobo: bigint,
  precision: number,
): bigint {
  assertMoney(rateKobo, true);
  const scaled = parseQuantity(quantity, precision);
  return assertMoney(roundRatio(scaled * rateKobo, QUANTITY_SCALE), true);
}

export function formatQuantity(
  quantity: string,
  unit: QuantityUnit,
  precision: number,
): string {
  checkUnit(unit);
  const scaled = parseQuantity(quantity, precision);
  return `${decimalString(scaled, precision)} ${unit === "litre" ? "litres" : "kg"}`;
}

/** Explicit unit check prevents combining liquid and cooking-gas totals (I-44). */
export function addQuantities(
  left: UnitQuantity,
  right: UnitQuantity,
): UnitQuantity {
  checkUnit(left.unit);
  checkUnit(right.unit);
  if (left.unit !== right.unit)
    throw new TypeError("Cannot add litres and kilograms");
  const sum = assertQuantity(
    parseQuantity(left.quantity) + parseQuantity(right.quantity),
  );
  return { quantity: decimalString(sum, 6), unit: left.unit };
}

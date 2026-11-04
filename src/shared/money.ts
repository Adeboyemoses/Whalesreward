/** PostgreSQL BIGINT range; money is always nonnegative integer kobo. */
export const MAX_KOBO = 9223372036854775807n;

export function assertMoney(kobo: bigint, positive = false): bigint {
  if (
    typeof kobo !== "bigint" ||
    kobo < (positive ? 1n : 0n) ||
    kobo > MAX_KOBO
  ) {
    throw new RangeError("Money is outside the supported kobo range");
  }
  return kobo;
}

/** Parse decimal integer kobo received over the wire; no floating conversion. */
export function parseKobo(value: string): bigint {
  if (typeof value !== "string" || !/^\d{1,19}$/.test(value))
    throw new TypeError("Expected integer kobo");
  return assertMoney(BigInt(value));
}

/** Parse typed naira with at most two fractional digits, without rounding input. */
export function parseNaira(value: string): bigint {
  if (typeof value !== "string" || !/^\d{1,17}(?:\.\d{1,2})?$/.test(value))
    throw new TypeError("Expected naira with at most two decimals");
  const [whole = "", fraction = ""] = value.split(".");
  return assertMoney(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
}

export function formatNaira(kobo: bigint): string {
  assertMoney(kobo);
  const whole = (kobo / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₦${whole}.${(kobo % 100n).toString().padStart(2, "0")}`;
}

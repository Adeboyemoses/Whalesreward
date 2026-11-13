import { parseQuantity, QUANTITY_SCALE } from "../../../shared/quantity";
import { MAX_KOBO } from "../../../shared/money";
import { AuthError } from "../auth/errors";
/** Validate the domain before no-change comparison or arithmetic; wire syntax is checked separately. */
export function validateMeterPair(
  amount: string,
  quantity: string,
  precision: number,
) {
  try {
    // Bound text before conversion; syntactically numeric overflow is a domain denial.
    if (!/^[1-9][0-9]{0,18}$/.test(amount)) throw new Error();
    const A = BigInt(amount),
      Q = parseQuantity(quantity, precision);
    if (A > MAX_KOBO) throw new Error();
    return { amount: A, quantity: Q };
  } catch {
    throw new AuthError("calculation_invalid", 422);
  }
}
/** Rational kobo. No rounding, division, binary floating point or business tolerance. */
export function compareMeterPair(
  amount: string,
  quantity: string,
  rate: string,
  amountStep: string,
  quantityStep: string,
  precision: number,
) {
  try {
    const pair = validateMeterPair(amount, quantity, precision),
      A = pair.amount,
      Q = pair.quantity,
      r = BigInt(rate),
      sA = BigInt(amountStep),
      sQ = parseQuantity(quantityStep, precision);
    if (
      A <= 0n ||
      A > MAX_KOBO ||
      r <= 0n ||
      r > MAX_KOBO ||
      sA <= 0n ||
      sA > MAX_KOBO ||
      A % sA !== 0n ||
      Q % sQ !== 0n
    )
      throw new Error();
    const delta = A * QUANTITY_SCALE - r * Q,
      d = delta < 0n ? -delta : delta;
    const allowance = r * sQ + sA * QUANTITY_SCALE;
    return {
      reconciled: d * 2n <= allowance,
      residual: { numerator: String(d), denominator: String(QUANTITY_SCALE) },
      allowance: {
        numerator: String(allowance),
        denominator: String(2n * QUANTITY_SCALE),
      },
    };
  } catch {
    throw new AuthError("calculation_invalid", 422);
  }
}

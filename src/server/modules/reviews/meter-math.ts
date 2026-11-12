import { parseQuantity, QUANTITY_SCALE } from "../../../shared/quantity";
import { MAX_KOBO } from "../../../shared/money";
import { AuthError } from "../auth/errors";
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
    const A = BigInt(amount),
      r = BigInt(rate),
      sA = BigInt(amountStep),
      Q = parseQuantity(quantity, precision),
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

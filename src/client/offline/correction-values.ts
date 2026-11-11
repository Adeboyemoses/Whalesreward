import {
  numericEditSchema,
  saleValuesSchema,
  type SaleValues,
} from "../../shared/contracts/sales";
import { parseNaira } from "../../shared/money";
import {
  amountToQuantity,
  parseQuantity,
  quantityToAmount,
  QUANTITY_SCALE,
} from "../../shared/quantity";
import type { OutboxRow } from "../types";
/** Canonical order and normalized decimals give the saved base a stable identity. */
export async function valuesDigest(input: SaleValues): Promise<string> {
  const v = saleValuesSchema.parse(input);
  const canonical = JSON.stringify([
    v.amountKobo,
    v.quantity,
    v.currency,
    v.unit,
    v.basis,
    v.enteredAmountKobo,
    v.enteredQuantity,
    v.rateKobo,
    v.priceVersionId,
    v.quantityPrecision,
    v.medium,
    v.calculation,
    v.verifiedSaleDate,
  ]);
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(bytes), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
export function localValues(row: OutboxRow): SaleValues {
  const o = row.original;
  return saleValuesSchema.parse({
    ...o.entry,
    currency: o.currency,
    unit: o.unit,
    enteredAmountKobo:
      o.entry.basis === "amount" ? o.entry.enteredAmountKobo : null,
    enteredQuantity:
      o.entry.basis === "quantity" ? o.entry.enteredQuantity : null,
    rateKobo: o.rateKobo,
    priceVersionId: o.priceVersionId,
    quantityPrecision: o.quantityPrecision,
    medium: o.medium,
    calculation: "captured_rate",
    verifiedSaleDate: null,
  });
}
export function numericCorrection(base: SaleValues, value: string) {
  const precision = base.quantityPrecision;
  if (base.basis === "amount") {
    const amount = parseNaira(value.trim());
    const edit = numericEditSchema.parse({
      basis: "amount",
      enteredAmountKobo: amount.toString(),
    });
    const values = saleValuesSchema.parse({
      ...base,
      amountKobo: amount.toString(),
      enteredAmountKobo: amount.toString(),
      quantity: amountToQuantity(amount, BigInt(base.rateKobo), precision),
    });
    return { edit, values };
  }
  const scaled = parseQuantity(value.trim(), precision);
  const fraction = (scaled % QUANTITY_SCALE)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  const quantity = `${scaled / QUANTITY_SCALE}${fraction ? "." + fraction : ""}`;
  const edit = numericEditSchema.parse({
    basis: "quantity",
    enteredQuantity: quantity,
  });
  const values = saleValuesSchema.parse({
    ...base,
    quantity,
    enteredQuantity: quantity,
    amountKobo: quantityToAmount(
      quantity,
      BigInt(base.rateKobo),
      precision,
    ).toString(),
  });
  return { edit, values };
}

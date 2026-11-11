import type { SaleValues } from "../shared/contracts/sales";
import { assertMoney, formatNaira, parseNaira } from "../shared/money";
import {
  amountToQuantity,
  parseQuantity,
  quantityToAmount,
  formatQuantity,
} from "../shared/quantity";
export const saleMoney = (value: string) => formatNaira(BigInt(value));
export const saleQuantity = (v: SaleValues) =>
  formatQuantity(v.quantity, v.unit, v.quantityPrecision).replace(
    / kg$/,
    " kilograms",
  );
export const saleRate = (v: SaleValues) =>
  `${saleMoney(v.rateKobo)} / ${v.unit}`;
export const valuePair = (v: SaleValues) =>
  `${saleMoney(v.amountKobo)} · ${saleQuantity(v)}`;
export const inputFromValues = (v: SaleValues) =>
  v.basis === "amount"
    ? `${BigInt(v.enteredAmountKobo ?? v.amountKobo) / 100n}.${(BigInt(v.enteredAmountKobo ?? v.amountKobo) % 100n).toString().padStart(2, "0")}`
    : (v.enteredQuantity ?? v.quantity);
export function correctionPreview(base: SaleValues, text: string) {
  if (base.calculation !== "captured_rate")
    throw new Error("This sale needs an admin review.");
  if (base.basis === "amount") {
    const amount = assertMoney(parseNaira(text.trim()), true);
    return {
      amountKobo: amount.toString(),
      quantity: amountToQuantity(
        amount,
        BigInt(base.rateKobo),
        base.quantityPrecision,
      ),
      changed: amount.toString() !== base.enteredAmountKobo,
    };
  }
  const entered = text.trim();
  parseQuantity(entered, base.quantityPrecision);
  const quantity = entered.includes(".")
    ? entered.replace(/0+$/, "").replace(/\.$/, "")
    : BigInt(entered).toString();
  return {
    amountKobo: quantityToAmount(
      quantity,
      BigInt(base.rateKobo),
      base.quantityPrecision,
    ).toString(),
    quantity,
    changed:
      parseQuantity(quantity, base.quantityPrecision) !==
      parseQuantity(
        base.enteredQuantity ?? base.quantity,
        base.quantityPrecision,
      ),
  };
}
export function saleStatusLabel(
  s: { credited: boolean; state: string },
  attendant = false,
) {
  if (s.credited) return attendant ? "Synced" : "Completed";
  if (s.state === "cancelled") return "Cancelled";
  if (s.state === "held") return "Held";
  return "Incomplete upload";
}
export const saleTone = (s: { credited: boolean; state: string }) =>
  s.credited
    ? ("synced" as const)
    : s.state === "cancelled"
      ? ("failed" as const)
      : s.state === "held"
        ? ("held" as const)
        : ("pending" as const);
const messages: Record<string, string> = {
  correction_pending:
    "A correction is already waiting for this sale. Reload to view it; your accepted values are unchanged.",
  sale_not_correctable:
    "This sale cannot be corrected here. Its recorded values remain unchanged. Ask an authorized admin to review it.",
  no_change:
    "Enter a different amount or quantity. The recorded value has not changed.",
  base_revision_changed:
    "This sale changed after the correction was prepared. Reload and review the current values; nothing has been overwritten.",
  version_conflict:
    "This record changed. Reload and review the current values before deciding again.",
  review_closed:
    "This correction has already been decided. Reload to view its outcome.",
  evidence_pending: "The meter photo is still awaiting validation.",
  evidence_deleted:
    "The meter photo has been deleted under the retention policy.",
  evidence_unavailable:
    "The meter photo is unavailable. A retained digest cannot replace inspection.",
  storage_unavailable:
    "The meter photo could not be loaded. Try again when the service is available.",
  calculation_invalid:
    "Enter a positive value within the sale's recorded precision.",
  invalid_request: "Check the value and required reason, then try again.",
  online_sign_in_required:
    "Sign in online again with this account to send corrections. Your saved changes stay on this phone.",
  permission_denied:
    "This decision requires current sales and corrections access. Recovered corrections must be decided by an admin independent of the recovery executor and grant authorizer.",
  date_invalid: "Choose a valid calendar day.",
  invalid_response:
    "The result could not be verified. Retry the same request; do not assume it failed.",
  obsolete: "This view is no longer current.",
};
export function salesMessage(e: unknown): string {
  const code = e && typeof e === "object" && "code" in e ? String(e.code) : "";
  return (
    messages[code] ??
    (e instanceof Error
      ? e.message
      : "This request could not be completed. Check your connection and try again.")
  );
}

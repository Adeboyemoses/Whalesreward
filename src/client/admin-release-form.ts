import { assertMoney, parseNaira } from "../shared/money";
import { parseQuantity } from "../shared/quantity";
import {
  attestedFactsSchema,
  type ReleaseProposalInput,
} from "../shared/contracts/held-release";
import type { ReleasePreparation } from "./admin-release-api";
export type ReleaseDraft = {
  source: "" | "shift_sheet" | "sales_log";
  entryReference: string;
  amount: string;
  quantity: string;
  rate: string;
  amountAbsent: boolean;
  quantityAbsent: boolean;
  rateAbsent: boolean;
  timeMode: "" | "date" | "range";
  date: string;
  fromDate: string;
  fromTime: string;
  throughDate: string;
  throughTime: string;
  precision: "" | "minute" | "second" | "millisecond";
  finding: "" | "sale_recorded" | "entry_marked_void";
  outcome: "" | "confirm" | "cancel";
  reason: string;
  inspected: boolean;
};
export const emptyReleaseDraft = (): ReleaseDraft => ({
  source: "",
  entryReference: "",
  amount: "",
  quantity: "",
  rate: "",
  amountAbsent: false,
  quantityAbsent: false,
  rateAbsent: false,
  timeMode: "",
  date: "",
  fromDate: "",
  fromTime: "",
  throughDate: "",
  throughTime: "",
  precision: "",
  finding: "",
  outcome: "",
  reason: "",
  inspected: false,
});
export function releaseDecimal(
  value: string,
  kind: "money" | "quantity",
  precision: number,
) {
  if (
    !new RegExp(
      `^(?:0|[1-9]\\d*)(?:\\.\\d{1,${Math.max(precision, 1)}})?$`,
    ).test(value) ||
    (value.includes(".") && value.split(".")[1]!.length > precision)
  )
    throw new Error("decimal");
  return kind === "money"
    ? assertMoney(parseNaira(value), true).toString()
    : (parseQuantity(value, precision), value);
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("date");
  const d = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value)
    throw new Error("date");
  return value;
}
export function releaseRange(
  d: Pick<
    ReleaseDraft,
    | "timeMode"
    | "date"
    | "fromDate"
    | "fromTime"
    | "throughDate"
    | "throughTime"
    | "precision"
  >,
) {
  let from: string, through: string;
  if (d.timeMode === "date") {
    const day = validDate(d.date);
    from = new Date(`${day}T00:00:00.000+01:00`).toISOString();
    through = new Date(`${day}T23:59:59.999+01:00`).toISOString();
  } else {
    if (d.timeMode !== "range" || !d.precision) throw new Error("precision");
    const time = (value: string, end: boolean) => {
      const re =
        d.precision === "minute"
          ? /^([01]\d|2[0-3]):[0-5]\d$/
          : d.precision === "second"
            ? /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/
            : /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}$/;
      if (!re.test(value)) throw new Error("precision");
      return (
        value +
        (d.precision === "minute"
          ? end
            ? ":59.999"
            : ":00.000"
          : d.precision === "second"
            ? end
              ? ".999"
              : ".000"
            : "")
      );
    };
    from = new Date(
      `${validDate(d.fromDate)}T${time(d.fromTime, false)}+01:00`,
    ).toISOString();
    through = new Date(
      `${validDate(d.throughDate)}T${time(d.throughTime, true)}+01:00`,
    ).toISOString();
  }
  if (from > through) throw new Error("range");
  return { from, through, timezone: "Africa/Lagos" as const };
}
export function releaseCanPropose(
  p: ReleasePreparation | null,
  pending: boolean,
) {
  return (
    !!p &&
    p.admission.state === "structurally_admissible" &&
    p.proposerAccess.allowed &&
    !pending
  );
}
export type ReleaseErrors = Partial<
  Record<keyof ReleaseDraft | "photo" | "numbers", string>
>;
export function validateReleaseDraft(
  d: ReleaseDraft,
  p: ReleasePreparation,
  sheetAssetId: string | null,
) {
  const errors: ReleaseErrors = {};
  if (!d.source) errors.source = "Choose the record shown in the photo.";
  if (
    !attestedFactsSchema.shape.entryReference.safeParse(d.entryReference)
      .success
  )
    errors.entryReference =
      "Enter a reference of 1 to 120 characters without personal contact details or links.";
  let amount: string | null = null,
    quantity: string | null = null,
    rate: string | null = null;
  try {
    if (!d.amountAbsent) amount = releaseDecimal(d.amount, "money", 2);
  } catch {
    errors.amount =
      "Enter the amount exactly as written, with no more than 2 decimals.";
  }
  try {
    if (!d.quantityAbsent)
      quantity = releaseDecimal(
        d.quantity,
        "quantity",
        p.original.quantityPrecision,
      );
  } catch {
    errors.quantity = `Enter a positive quantity with no more than ${p.original.quantityPrecision} decimals.`;
  }
  try {
    if (!d.rateAbsent) rate = releaseDecimal(d.rate, "money", 2);
  } catch {
    errors.rate =
      "Enter the rate shown in the entry, with no more than 2 decimals.";
  }
  if (amount === null && quantity === null)
    errors.numbers =
      "The entry must show the sale's entered amount or quantity. Copy it exactly; do not calculate it.";
  let observedCapture: ReturnType<typeof releaseRange> | null = null;
  try {
    observedCapture = releaseRange(d);
  } catch {
    errors.timeMode =
      d.timeMode === "date"
        ? "Enter a real date shown in the entry."
        : d.precision
          ? "Enter the full time range supported by the entry. The end must not be before the start."
          : "Choose the precision actually shown in the entry.";
  }
  if (!d.finding)
    errors.finding = "Choose what the matching entry explicitly records.";
  if (
    !d.outcome ||
    (d.finding === "sale_recorded"
      ? d.outcome !== "confirm"
      : d.outcome !== "cancel")
  )
    errors.outcome = "Choose an outcome supported by the matching entry.";
  if (!/^[^\u0000-\u001f\u007f]{1,1000}$/u.test(d.reason.trim()))
    errors.reason = "Enter a reason of 1 to 1,000 characters.";
  if (!d.inspected)
    errors.inspected =
      "Inspect the sheet photo and confirm that the facts and precision are legible and faithfully copied.";
  if (!sheetAssetId)
    errors.photo =
      "Upload and validate one sheet photo, or inspect a retained sheet photo.";
  if (Object.keys(errors).length || !observedCapture)
    return { errors, input: null };
  const input: Omit<ReleaseProposalInput, "operationId"> = {
    ...p.guard,
    target: p.target,
    sheetAssetId: sheetAssetId!,
    meterAssetId: p.meterAssetId,
    outcome: d.outcome as "confirm" | "cancel",
    reason: d.reason.trim(),
    facts: {
      ...p.originalContext,
      source: d.source as "shift_sheet" | "sales_log",
      entryReference: d.entryReference.trim(),
      recordedAmountKobo: amount,
      recordedQuantity: quantity,
      recordedRateKobo: rate,
      observedCapture,
      finding: d.finding as "sale_recorded" | "entry_marked_void",
    },
  };
  return { errors, input };
}
export const releaseConfirmLabels = {
  price: "Confirm captured values",
  card: "Confirm valid earlier purchase",
  date: "Confirm sale date from the entry",
  capture: "Confirm capture checks from the entry",
};
export function releaseImpact(
  kind: keyof typeof releaseConfirmLabels,
  outcome: "confirm" | "cancel",
) {
  if (outcome === "cancel")
    return "A different authorized person must approve this proposal. Approval cancels this sale and closes its original holds and capture checks as cancelled. It does not cancel another sale. The original entry and history remain.";
  return {
    price:
      "A different authorized person must approve this proposal. Only this price review may clear. Captured values stay unchanged; a later numeric revision cannot be overwritten. Loyalty credit still depends on every other check.",
    card: "A different authorized person must approve this proposal. Only this card review may clear. The old card stays disabled. Loyalty credit still depends on every other check.",
    date: "A different authorized person must approve this proposal. Only this date review may clear. The verified date is recorded separately; the original timestamp stays unchanged. Loyalty credit still depends on every other check.",
    capture:
      "A different authorized person must approve this proposal. All selected open capture checks are reviewed together. Other holds remain. A sale outside the campaign still does not count toward the giveaway.",
  }[kind];
}

import { formatNaira, parseKobo } from "../../../../shared/money";
import type { Session } from "@/client/types";
type Price = Session["price"];
const rate = (price: Price, unit: string) =>
  `${formatNaira(parseKobo(price.rateKobo))} per ${unit === "kg" ? "kilogram" : "litre"}`;
/** Version comparison is notification-only; adoption belongs to the client transaction. */
export function adoptedPriceNotices(
  previous: Price,
  current: Price,
  unit: string,
): string[] {
  if (current.version <= previous.version) return [];
  const messages: string[] = [];
  if (current.rateKobo !== previous.rateKobo)
    messages.push(`Price updated to ${rate(current, unit)}`);
  else if (current.quantityPrecision !== previous.quantityPrecision)
    messages.push("Quantity precision updated for new sales");
  return messages;
}
export function retainedPriceWarnings(
  frozen: Price,
  current: Price,
  unit: string,
): string[] {
  const messages: string[] = [];
  if (current.rateKobo !== frozen.rateKobo)
    messages.push(
      `Price updated to ${rate(current, unit)} for new sales. This sale keeps ${rate(frozen, unit)}. Check the meter before saving.`,
    );
  if (current.quantityPrecision !== frozen.quantityPrecision)
    messages.push(
      "Quantity precision updated for new sales. This sale keeps its original quantity precision. Check the meter before saving.",
    );
  return messages;
}

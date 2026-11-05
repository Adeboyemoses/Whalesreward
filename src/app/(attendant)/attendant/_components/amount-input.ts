import { formatNaira, parseNaira } from "../../../../shared/money";

/** Display a blurred amount without changing its editable decimal value. */
export function formatAmountInput(value: string): string {
  try {
    return formatNaira(parseNaira(value)).slice(1);
  } catch {
    return value;
  }
}

import { v7 } from "uuid";

/** UUID time bits are identifiers only, never evidence of capture time. */
export function newId(): string {
  return v7();
}

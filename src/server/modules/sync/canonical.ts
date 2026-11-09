import { createHash } from "node:crypto";
/** Versioned, recursively key-sorted JSON. Schemas normalize codes, instants and decimals first. */
export function payloadDigest(value: unknown): string {
  let namespace = "sync-v1";
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "lookupReceipt" in value
  ) {
    const { lookupReceipt, ...legacy } = value as Record<string, unknown>;
    if (lookupReceipt == null) value = legacy;
    else namespace = "sync-v2-lookup";
  }
  function stable(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
    if (v !== null && typeof v === "object")
      return `{${Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`)
        .join(",")}}`;
    return JSON.stringify(v);
  }
  return createHash("sha256")
    .update(`${namespace}\0${stable(value)}`)
    .digest("hex");
}

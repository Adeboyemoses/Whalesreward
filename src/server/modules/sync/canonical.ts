import { createHash } from "node:crypto";
/** Versioned, recursively key-sorted JSON. Schemas normalize codes, instants and decimals first. */
export function payloadDigest(value: unknown): string {
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
    .update(`sync-v1\0${stable(value)}`)
    .digest("hex");
}

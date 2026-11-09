import { createHash } from "node:crypto";
/** Recursively key-sorted JSON, using an explicit stack for bounded-size deeply nested evidence. */
export function canonicalJson(value: unknown): string {
  type Task = { value: unknown } | { text: string };
  const pending: Task[] = [{ value }],
    output: string[] = [];
  while (pending.length) {
    const task = pending.pop()!;
    if ("text" in task) {
      output.push(task.text);
      continue;
    }
    const v = task.value;
    if (Array.isArray(v)) {
      output.push("[");
      pending.push({ text: "]" });
      for (let i = v.length - 1; i >= 0; i--) {
        pending.push({ value: v[i] });
        if (i > 0) pending.push({ text: "," });
      }
    } else if (v !== null && typeof v === "object") {
      output.push("{");
      pending.push({ text: "}" });
      const entries = Object.entries(v).sort(([a], [b]) => a.localeCompare(b));
      for (let i = entries.length - 1; i >= 0; i--) {
        const [k, x] = entries[i]!;
        pending.push({ value: x }, { text: ":" }, { text: JSON.stringify(k) });
        if (i > 0) pending.push({ text: "," });
      }
    } else output.push(JSON.stringify(v));
  }
  return output.join("");
}
/** Keep absent/null receipts in the legacy namespace; every other JSON value is immutable evidence. */
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
  return createHash("sha256")
    .update(`${namespace}\0${canonicalJson(value)}`)
    .digest("hex");
}

/** PostgreSQL JSONB cannot represent NUL or unpaired UTF-16 surrogates, including keys. */
export function jsonbRepresentable(value: unknown): boolean {
  const pending: unknown[] = [value];
  const unsupported =
    /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  while (pending.length) {
    const item = pending.pop();
    if (typeof item === "string" && unsupported.test(item)) return false;
    if (Array.isArray(item)) pending.push(...item);
    else if (item !== null && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) pending.push(key, child);
    }
  }
  return true;
}

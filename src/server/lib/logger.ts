import pino, { type DestinationStream } from "pino";

const REDACTED = "[Redacted]";
const sensitiveKey =
  /^(?:lookupReceipt|lookup_receipt_input|lookup_receipt_input_json|lookup_receipt_claims|phone(?:number|_normalized)?|password(?:hash|_hash)?|code|(?:.*[_-])?token|.*Token|signed[_-]?url|authorization|cookie|secret(?:hash|verifier|_hash|_verifier)?)$/i;

/** Redact nested records and arrays before serialization; never mutate domain objects. */
function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => redact(entry, seen));
  if (value instanceof Date) return value.toISOString();
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value))
    result[key] = sensitiveKey.test(key) ? REDACTED : redact(entry, seen);
  return result;
}

/** Log event names and allowlisted IDs, never raw request bodies or untrusted message strings. */
export function createLogger(destination?: DestinationStream) {
  const options = {
    level: "info",
    // Pino child bindings bypass inherited bindings formatters. Sanitize the final
    // structured line so child bindings, serializers and nested arrays share the rule.
    hooks: {
      streamWrite: (line: string) =>
        `${JSON.stringify(redact(JSON.parse(line)))}\n`,
    },
  };
  return destination ? pino(options, destination) : pino(options);
}

export const logger = createLogger();

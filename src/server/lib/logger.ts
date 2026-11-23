import pino, { type DestinationStream } from "pino";

const events = new Set([
  "api.unhandled_failure",
  "api.error_threshold",
  "purchase.received",
  "security.event",
  "database.pool_failed",
  "email.loop_shutdown",
  "email.loop_disabled",
  "email.loop_pool",
  "email.loop_batch",
  "email.loop_started",
  "email.send_failed",
  "email.config_invalid",
  "email.startup_failed",
  "cards.exports_pool_failed",
  "cards.exports_batch",
  "reports.exports_pool_failed",
  "reports.exports_batch",
  "corrections.pool_failed",
  "corrections.validation_batch",
  "duplicates.pool_failed",
  "duplicates.validation_batch",
  "maintenance.database_unavailable",
  "maintenance.finished",
  "maintenance.failed",
]);
const countKeys = new Set([
  "requests",
  "serverErrors",
  "throttled",
  "processed",
  "delivered",
  "failed",
  "errors",
  "scanned",
  "findings",
  "agedStaged",
  "unreferencedFinal",
  "missingObject",
  "digestMismatch",
  "sizeMismatch",
  "missingDigest",
  "missingReceipt",
  "receiptMismatch",
  "stalledUpload",
  "deleteMarkers",
  "providerFailures",
]);
const enums: Record<string, ReadonlySet<string>> = {
  reason: new Set([
    "build_phase",
    "production",
    "provider_unset",
    "noop",
    "config_invalid",
    "token_has_prefix",
    "network",
    "timeout",
    "http_status",
    "provider_error",
    "response_invalid",
  ]),
  adapter: new Set(["noop", "mailpit", "zoho_cpaas", "unknown"]),
  job: new Set(["orphans", "reconcile-uploads"]),
  errorCode: new Set([
    "budget_exhausted",
    "invalid_limits",
    "lease_lost",
    "database_unavailable",
    "storage_unavailable",
    "unsafe_database_role",
    "invalid_configuration",
  ]),
  setting: new Set([
    "WHR_ENV",
    "EMAIL_PROVIDER",
    "ZOHO_CPAAS_API_URL",
    "ZOHO_CPAAS_TOKEN",
    "EMAIL_FROM",
    "EMAIL_ALLOWED_RECIPIENTS",
    "MAILPIT_URL",
  ]),
};
const safeCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
/** Closed projection applied after Pino serialization, including child bindings and errors.
 * Never retain arbitrary strings, request records, freeform messages or hostnames. */
function project(input: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const key of ["level", "time"])
    if (safeCount(input[key])) output[key] = input[key];
  if (typeof input.event === "string" && events.has(input.event))
    output.event = input.event;
  else output.event = "log.suppressed";
  // Unknown events are never allowed to smuggle data under an otherwise safe key.
  if (output.event === "log.suppressed") return output;
  for (const [key, values] of Object.entries(enums))
    if (typeof input[key] === "string" && values.has(input[key]))
      output[key] = input[key];
  for (const key of countKeys)
    if (safeCount(input[key])) output[key] = input[key];
  if (
    typeof input.status === "number" &&
    Number.isInteger(input.status) &&
    input.status >= 100 &&
    input.status <= 599
  )
    output.status = input.status;
  else if (
    ["busy", "continued", "succeeded", "failed"].includes(String(input.status))
  )
    output.status = input.status;
  if (input.counts && typeof input.counts === "object") {
    output.counts = Object.fromEntries(
      Object.entries(input.counts).filter(
        ([key, value]) => countKeys.has(key) && safeCount(value),
      ),
    );
  }
  // Provider codes are a closed diagnostic grammar, not provider message text.
  if (
    typeof input.error_code === "string" &&
    /^[A-Z]{2,5}_[0-9]{1,5}$/.test(input.error_code)
  )
    output.error_code = input.error_code;
  return output;
}
export function createLogger(destination?: DestinationStream) {
  const options = {
    level: "info",
    hooks: {
      streamWrite: (line: string) =>
        `${JSON.stringify(project(JSON.parse(line)))}\n`,
    },
  };
  return destination ? pino(options, destination) : pino(options);
}
export const logger = createLogger();

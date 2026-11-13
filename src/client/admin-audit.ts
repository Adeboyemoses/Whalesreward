import { z } from "zod";
import { adminRequest, AdminError } from "./admin-api";
import {
  auditEventSchema,
  auditPageSchema,
  auditSearchSchema,
  type AuditSearch,
  type AuditEvent,
  type AuditChange,
} from "../shared/contracts/audit";
import { formatNaira, parseKobo } from "../shared/money";
import { formatQuantity } from "../shared/quantity";
import { adminAction, adminTime } from "./admin-display";
export class AdminAuditApi {
  constructor(private request: typeof adminRequest = adminRequest) {}
  private async read<T>(path: string, schema: z.ZodType<T>, body?: unknown) {
    const result = schema.safeParse(await this.request<unknown>(path, body));
    if (!result.success) throw new AdminError("invalid_response", 200);
    return result.data;
  }
  search(input: AuditSearch) {
    return this.read(
      "audit/search",
      auditPageSchema,
      auditSearchSchema.parse(input),
    );
  }
  detail(id: string) {
    return this.read(`audit/${encodeURIComponent(id)}`, auditEventSchema);
  }
}
export const auditTitle = (e: AuditEvent) =>
  e.action === "legacy_event"
    ? "older event, details not available"
    : adminAction(e.action);
export function auditValue(
  event: AuditEvent,
  change: AuditChange,
  side: "before" | "after",
): string {
  const value = change[side];
  if (value === null) return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    const enums = [
      "holdKinds",
      "policyBlocks",
      "reviewConclusions",
      "permissions",
    ];
    return value.length
      ? (enums.includes(change.field) ? value.map(adminAction) : value).join(
          " · ",
        )
      : "None";
  }
  if (["amountKobo", "rateKobo", "creditedSpendKobo"].includes(change.field))
    return formatNaira(parseKobo(value));
  if (change.field === "quantity") {
    const unit = event.changes.find((c) => c.field === "unit")?.[side];
    return unit === "litre" || unit === "kilogram"
      ? formatQuantity(value, unit, 6).replace(/ kg$/, " kilograms")
      : `${value} (unit not recorded)`;
  }
  if (["effectiveFrom", "effectiveUntil", "activatedAt"].includes(change.field))
    return adminTime(value);
  if (change.field === "verifiedSaleDate")
    return adminTime(`${value}T12:00:00+01:00`).split(" · ")[0] ?? value;
  // Only closed enum fields receive presentation labels. All free text, IDs,
  // revisions and release references remain the exact recorded strings.
  const enums = [
    "state",
    "currency",
    "unit",
    "medium",
    "basis",
    "calculation",
    "duplicateState",
    "correctionState",
    "outcome",
    "meterConclusion",
    "customerCategory",
    "verificationMethod",
    "verificationState",
    "recoveryState",
    "batchStatus",
    "exportFormat",
    "policyEnvironment",
    "policyState",
  ];
  return enums.includes(change.field) ? adminAction(value) : value;
}
export function auditMessage(e: unknown) {
  if (e instanceof AdminError) {
    if (e.code === "date_invalid")
      return "Enter a valid calendar date in From and To (Africa/Lagos).";
    if (e.code === "date_range_invalid")
      return "From must be on or before To (Africa/Lagos).";
    if (e.code === "not_found") return "This audit event is unavailable.";
    if (e.code === "invalid_request")
      return "Check the filters. Target ID must be a valid record UUID.";
    return e.message;
  }
  return "Audit history could not be loaded. Check the filters and try again.";
}

/** Human labels describe displayed units rather than the wire representation. */
export function auditFieldLabel(field: AuditChange["field"]) {
  const labels: Partial<Record<AuditChange["field"], string>> = {
    amountKobo: "Amount",
    rateKobo: "Captured unit price",
    creditedSpendKobo: "Credited spend",
    quantity: "Quantity",
    batchStatus: "Batch status",
    correctionState: "Review status",
    duplicateState: "Duplicate status",
    state: "Sale status",
    basis: "Entry basis",
    phoneChanged: "Phone changed",
    verifiedSaleDate: "Verified sale date",
  };
  return (
    labels[field] ??
    adminAction(
      field
        .replace(/([A-Z])/g, " $1")
        .toLowerCase()
        .replace(/\bid\b/g, "ID"),
    )
  );
}

export type MaintenanceJob = "orphans" | "reconcile-uploads";
export type Limits = {
  pageSize: number;
  maxPages: number;
  sliceMs: number;
  leaseMs: number;
  objectDeadlineMs: number;
  agedMs: number;
};
export function maintenanceLimits(input: Partial<Limits> = {}): Limits {
  const limits = {
    pageSize: 25,
    maxPages: 20,
    sliceMs: 600000,
    leaseMs: 60000,
    objectDeadlineMs: 10000,
    agedMs: 3600000,
    ...input,
  };
  const caps: Limits = {
    pageSize: 1000,
    maxPages: 1000,
    sliceMs: 600000,
    leaseMs: 600000,
    objectDeadlineMs: 30000,
    agedMs: 31536000000,
  };
  for (const key of Object.keys(limits) as (keyof Limits)[]) {
    if (
      !Number.isSafeInteger(limits[key]) ||
      limits[key] < 1 ||
      limits[key] > caps[key]
    )
      throw new MaintenanceError("invalid_limits");
  }
  return limits;
}
export class MaintenanceError extends Error {
  readonly code:
    | "budget_exhausted"
    | "invalid_limits"
    | "lease_lost"
    | "database_unavailable"
    | "storage_unavailable"
    | "unsafe_database_role"
    | "invalid_configuration";
  constructor(
    code:
      | "budget_exhausted"
      | "invalid_limits"
      | "lease_lost"
      | "database_unavailable"
      | "storage_unavailable"
      | "unsafe_database_role"
      | "invalid_configuration",
  ) {
    super(code);
    this.code = code;
  }
}
export type VersionCursor = { keyMarker: string; versionIdMarker?: string };
export type Cursor = {
  phase: "staging" | "final" | "expected" | "done";
  provider: VersionCursor | null;
  after: string | null;
};
export type Counts = Record<string, number>;
export const countNames = [
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
] as const;
export type FindingCode =
  | "aged_staged"
  | "unreferenced_final"
  | "missing_object"
  | "digest_mismatch"
  | "size_mismatch"
  | "missing_digest"
  | "missing_receipt"
  | "receipt_mismatch"
  | "stalled_upload"
  | "delete_marker";
export type Finding = {
  code: FindingCode;
  object?: { key: string; versionId: string | null };
  assetId?: string;
  purchaseId?: string;
  referenceIds?: string[];
};
export type Lease = {
  runId: string;
  owner: string;
  fence: string;
  cutoff: Date;
  cursor: Cursor;
  pageNo: number;
  deadline: Date;
  expiresAt: Date;
  job: MaintenanceJob;
};
export type Page = {
  cursor: Cursor;
  counts: Counts;
  findings: Finding[];
  complete: boolean;
};
export const scheduleMs = (job: MaintenanceJob) =>
  job === "orphans" ? 3600000 : 900000;

/** Leave room to persist the completed-object checkpoint before authority ends. */
export const checkpointReserveMs = (limits: Limits) =>
  Math.max(
    1,
    Math.min(
      5000,
      Math.floor(limits.leaseMs / 4),
      Math.floor(limits.sliceMs / 4),
    ),
  );
export function providerSignal(
  lease: Lease,
  limits: Limits,
  parent: AbortSignal,
): AbortSignal {
  const remaining =
    Math.min(lease.deadline.getTime(), lease.expiresAt.getTime()) -
    Date.now() -
    checkpointReserveMs(limits);
  if (remaining < 1) throw new MaintenanceError("budget_exhausted");
  return AbortSignal.any([
    parent,
    AbortSignal.timeout(Math.min(limits.objectDeadlineMs, remaining)),
  ]);
}

import { attendantCorrectionSchema } from "../../shared/contracts/sales";
import type { AttendantSaleDetail } from "../sales-api";
import type {
  AttendantCorrection,
  CorrectionSubmission,
  NumericEdit,
  SaleValues,
} from "../../shared/contracts/sales";
export type SaveCorrectionInput = {
  source:
    | { kind: "server"; detail: AttendantSaleDetail }
    | { kind: "local"; operationId: string };
  /** Naira in amount mode; exact decimal quantity in quantity mode. */
  value: string;
  reason: string;
};
export type CorrectionOutboxRow = {
  schemaVersion: 1;
  originatingAccountId: string;
  operationId: string;
  originalOperationId: string;
  purchaseId: string | null;
  basedOnRevisionId: string | null;
  baseValues: SaleValues;
  baseValuesDigest: string;
  edit: NumericEdit;
  reason: string;
  evidenceAssetId: string | null;
  photoDigest: string;
  /** Never changed after its first durable write, including after rejection. */
  submission: CorrectionSubmission | null;
  serverCorrection: AttendantCorrection | null;
  state:
    | "saved"
    | "waiting_original"
    | "submitting"
    | "pending_validation"
    | "awaiting_review"
    | "accepted"
    | "rejected"
    | "needs_attention";
  localSavedAt: string;
  attempts: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  syncLease: { owner: string; expiresAt: string } | null;
};
export const pendingCorrection = (row: CorrectionOutboxRow) =>
  !["accepted", "rejected", "needs_attention"].includes(row.state);

/** Receipt settles transport only; review/credit remain the server's decision. */
export function correctionNeedsUpload(row: CorrectionOutboxRow): boolean {
  // Definitive refusals need a newly reviewed operation, never upload-first retries.
  if (row.state === "needs_attention") return false;
  const receipt = attendantCorrectionSchema.safeParse(row.serverCorrection);
  return !(
    receipt.success &&
    row.submission &&
    receipt.data.operationId === row.operationId &&
    receipt.data.operationId === row.submission.operationId &&
    receipt.data.purchaseId === row.purchaseId &&
    receipt.data.basedOnRevisionId === row.submission.basedOnRevisionId &&
    receipt.data.reason === row.submission.reason
  );
}

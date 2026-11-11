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

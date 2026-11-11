import { z } from "zod";
import { adminRequest, AdminError, adminOperationId } from "./admin-api";
import { AdminSalesApi, type AdminSaleDetail } from "./admin-sales-api";
import {
  captureDecisionSchema,
  cardDecisionSchema,
  dateDecisionSchema,
  priceDecisionSchema,
  duplicateDecisionSchema,
  decisionSchema,
  duplicateFlagSchema,
  saleRowSchema,
} from "../shared/contracts/sales";
export type ReviewKind = "duplicate" | "price" | "card" | "date" | "capture";
export type ReviewChoice =
  | "keep_both"
  | "cancel"
  | "accept_captured"
  | "confirm_earlier"
  | "verify_date"
  | "confirm";
export type FrozenReview = {
  path: string;
  kind: ReviewKind;
  body: Record<string, unknown> & { operationId: string; reason: string };
  label: string;
};
export const duplicateResultSchema = z.strictObject({
  decision: decisionSchema,
  flag: duplicateFlagSchema,
  purchases: z.array(saleRowSchema),
});
export function reviewReferences(sale: AdminSaleDetail) {
  return [
    { id: sale.id, label: "Original purchase and server receipt" },
    ...(sale.evidence.state === "validated" && sale.evidence.assetId
      ? [{ id: sale.evidence.assetId, label: "Validated meter photo" }]
      : []),
    { id: sale.original.priceVersionId, label: "Captured price record" },
    ...(sale.replacement
      ? [{ id: sale.replacement.eventId, label: "Card replacement event" }]
      : []),
  ].filter((v, i, all) => all.findIndex((x) => x.id === v.id) === i);
}
export function reviewUncertain(error: unknown) {
  // Unexpected decoding failures cannot prove that the decision was rolled back.
  return (
    !(error instanceof AdminError) ||
    error.status === 0 ||
    error.status >= 500 ||
    error.status === 429 ||
    error.code === "invalid_response" ||
    error.code === "unavailable"
  );
}
export function reviewMessage(error: unknown): string {
  const code = error instanceof AdminError ? error.code : "unavailable";
  return (
    (
      {
        evidence_insufficient:
          "The records don't settle this yet. Leave this sale held while the records are investigated. Notes cannot replace proof.",
        evidence_unavailable:
          "The required evidence is unavailable. This review has not cleared the sale.",
        version_conflict:
          "This sale changed. Reload the current records and review a new decision before confirming.",
        review_closed:
          "This review has already been closed. Reload the current records to see the recorded outcome.",
        sale_not_cancellable:
          "This sale cannot be cancelled in this review. Reload the current records.",
        permission_denied:
          "Your permissions changed or do not allow this decision. Review your current access.",
        date_invalid:
          "Enter a valid Lagos calendar date supported by the records.",
        date_after_receipt:
          "The verified date cannot be after the day the server received this sale.",
        hold_kind_mismatch:
          "This hold no longer matches the review. Reload the current record.",
        policy_review_required:
          "This sale needs further policy review. It remains held.",
        operation_conflict:
          "This operation does not match the recorded request. Reload the record before any new review.",
        comparison_invalid:
          "The comparison records no longer match this duplicate flag. Reload both records.",
        invalid_request:
          "Check the decision reason, explanation and selected records before reviewing again.",
        unavailable:
          "The result is uncertain. Retry the same decision to retrieve its recorded outcome.",
      } as Record<string, string>
    )[code] ??
    (reviewUncertain(error)
      ? "The result is uncertain. Retry the same decision to retrieve its recorded outcome."
      : error instanceof Error
        ? error.message
        : "This review could not be completed.")
  );
}
export class AdminReviewApi extends AdminSalesApi {
  constructor(
    read: typeof adminRequest = adminRequest,
    private mutation: typeof adminRequest = read,
  ) {
    super(read, mutation);
  }
  prepare(
    sale: AdminSaleDetail,
    kind: Exclude<ReviewKind, "duplicate">,
    choice: ReviewChoice,
    reason: string,
    notes: string,
    referenceIds: string[],
    verifiedSaleDate = "",
  ): FrozenReview {
    const allowed = reviewReferences(sale).map((r) => r.id);
    if (referenceIds.some((id) => !allowed.includes(id)))
      throw new AdminError("invalid_request", 400);
    if (sale.evidence.state !== "validated" || !sale.evidence.assetId)
      throw new AdminError("evidence_unavailable", 422);
    const base = {
      operationId: adminOperationId(),
      expectedVersion: sale.version,
      expectedRevisionId: sale.currentRevisionId,
      reason: reason.trim(),
      evidence: {
        assetId: sale.evidence.assetId,
        notes: notes.trim(),
        referenceIds: [...referenceIds],
      },
    };
    const hold = sale.holds.find((h) => h.kind === kind && h.state === "open");
    if (kind !== "capture" && !hold) throw new AdminError("review_closed", 409);
    if (
      kind === "capture" &&
      !sale.policyBlocks.some(
        (b) =>
          b === "capture_authorization_unresolved" ||
          b === "capture_time_unresolved",
      )
    )
      throw new AdminError("review_closed", 409);
    const guarded = { ...base, expectedHoldVersion: hold?.version };
    let body;
    if (kind === "price") {
      if (choice !== "accept_captured")
        throw new AdminError("invalid_request", 400);
      body = priceDecisionSchema.parse({
        ...guarded,
        decision: { outcome: choice },
      });
    } else if (kind === "card")
      body = cardDecisionSchema.parse({ ...guarded, outcome: choice });
    else if (kind === "date")
      body = dateDecisionSchema.parse({ ...guarded, verifiedSaleDate });
    else body = captureDecisionSchema.parse({ ...base, outcome: choice });
    return {
      kind,
      body,
      path:
        kind === "capture"
          ? `sales/${sale.id}/capture-decision`
          : `sales/${sale.id}/holds/${hold!.id}/${kind}-decision`,
      label:
        choice === "cancel"
          ? `Cancel sale ${sale.saleCode}`
          : choice === "verify_date"
            ? `Verify sale date · ${verifiedSaleDate}`
            : choice === "accept_captured"
              ? "Confirm captured values"
              : choice === "confirm_earlier"
                ? "Confirm valid earlier purchase"
                : "Confirm capture",
    };
  }
  prepareDuplicate(
    a: AdminSaleDetail,
    b: AdminSaleDetail,
    flagId: string,
    cancelId: string | null,
    reason: string,
  ): FrozenReview {
    const flag = a.duplicateFlags.find(
      (f) => f.id === flagId && f.state === "open",
    );
    if (
      !flag ||
      !flag.purchaseIds.includes(a.id) ||
      !flag.purchaseIds.includes(b.id) ||
      a.id === b.id ||
      (cancelId && !flag.purchaseIds.includes(cancelId))
    )
      throw new AdminError("comparison_invalid", 422);
    const body = duplicateDecisionSchema.parse({
      operationId: adminOperationId(),
      expectedFlagVersion: flag.version,
      purchases: [a, b].map((s) => ({
        id: s.id,
        expectedVersion: s.version,
        expectedRevisionId: s.currentRevisionId,
      })),
      decision: cancelId
        ? { outcome: "cancel", cancelPurchaseId: cancelId }
        : { outcome: "keep_both" },
      reason: reason.trim(),
    });
    return {
      kind: "duplicate",
      body,
      path: `duplicate-flags/${flag.id}/decision`,
      label: cancelId
        ? `Cancel sale ${cancelId === a.id ? a.saleCode : b.saleCode}`
        : "Clear the flag · keep both",
    };
  }
  async submit(frozen: FrozenReview) {
    const data = await this.mutation<unknown>(
      frozen.path,
      frozen.body,
      "POST",
      frozen.body.operationId,
    );
    const parsed =
      frozen.kind === "duplicate"
        ? duplicateResultSchema.safeParse(data)
        : decisionSchema.safeParse(data);
    if (!parsed.success) throw new AdminError("invalid_response", 200);
    return "decision" in parsed.data ? parsed.data.decision : parsed.data;
  }
}

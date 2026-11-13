import { describe, it, expect } from "vitest";
import {
  auditChangeSchema,
  currentAuditEventSchema,
  auditRules,
  type AuditChange,
} from "../../../shared/contracts/audit";
const id = "019a5000-0000-7000-8000-000000000001";
const V =
  "amountKobo quantity currency unit basis medium rateKobo priceVersionId revisionId credited calculation";
const G = "state holdKinds policyBlocks creditedSpendKobo";
const R =
  "reviewPolicyRelease reviewPolicyRevision reviewEvaluationId reviewConclusions";
const M =
  "meterPolicyRelease meterPolicyRevision meterProfileId meterEvaluationId meterConclusion";
// Independent transcription of the normative M3 action/field matrix.
const matrix: Record<string, string> = {
  sale_received: "state detailsReceived",
  sale_credited: `${V} ${G} photoAssetId candidateRevisionId`,
  sale_held: `${V} ${G} photoAssetId candidateRevisionId`,
  sale_cancelled_unmatched: "state credited creditedSpendKobo",
  correction_received: `${V} correctionState`,
  correction_applied: `${V} correctionState`,
  correction_approved: `${V} correctionState decisionId outcome`,
  correction_rejected: `${V} correctionState`,
  duplicate_flagged: "flagId purchaseIds duplicateState",
  duplicate_cleared: `${V} ${G} decisionId outcome flagId purchaseIds duplicateState`,
  duplicate_cancelled: `${V} ${G} decisionId outcome flagId purchaseIds duplicateState`,
  price_accepted: `${V} ${G} decisionId outcome candidateRevisionId`,
  price_cancelled: `${V} ${G} decisionId outcome candidateRevisionId`,
  price_corrected: `${V} ${G} decisionId outcome candidateRevisionId ${R} ${M}`,
  card_eligibility_confirmed: `${V} ${G} decisionId outcome`,
  card_eligibility_cancelled: `${V} ${G} decisionId outcome`,
  sale_date_verified: `${V} ${G} decisionId outcome verifiedSaleDate ${R}`,
  capture_confirmed: `${V} ${G} decisionId outcome ${R}`,
  capture_cancelled: `${V} ${G} decisionId outcome ${R}`,
  customer_registered: "customerCategory cardId",
  phone_changed: "phoneChanged verificationMethod identityChangeId",
  card_replaced:
    "customerId oldCardId newCardId verificationMethod identityChangeId",
  manager_case_recorded: "caseId verificationMethod",
  card_verification_issued: "challengeId verificationMethod verificationState",
  card_verification_verified:
    "challengeId verificationMethod verificationState",
  recovery_authorized: "grantId originatingAccountId recordCount recoveryState",
  recovery_revoked: "grantId originatingAccountId recordCount recoveryState",
  recovery_item_received:
    "grantId originatingAccountId detailsReceived photoValidated",
  user_created: "roleId roleName enabled emailVerified",
  user_access_changed: "roleId roleName enabled emailVerified",
  role_created: "roleName permissions",
  role_changed: "roleName permissions",
  verification_requested: "emailVerified",
  email_verified: "emailVerified",
  password_reset: "",
  password_changed: "",
  pump_created: "productId pumpVersion",
  attendant_created: "attendantVersion",
  assignment_changed: "assignmentId pumpId assignmentVersion effectiveFrom",
  assignment_ended:
    "assignmentId pumpId effectiveUntil attendantVersion authVersion",
  price_activated:
    "priceVersionId priceVersion rateKobo currency quantityPrecision effectiveFrom",
  batch_generated: "batchStatus batchVersion",
  batch_printed: "batchStatus batchVersion",
  batch_activated: "batchStatus batchVersion",
  export_requested: "exportId exportFormat recordCount",
  export_prepared: "exportId exportFormat",
  export_failed: "exportId exportFormat",
  review_evidence_approved:
    "approvalId policyRelease policyRevision policyEnvironment activatedAt",
  review_evidence_configured:
    "configurationId approvalId policyRelease policyRevision policyEnvironment policyState activatedAt",
  review_evidence_deactivated:
    "configurationId approvalId policyRelease policyRevision policyEnvironment policyState activatedAt",
};
describe("M3 closed typed audit catalogue", () => {
  it("matches every exact required action field set without widening aliases", () => {
    expect(Object.keys(auditRules).sort()).toEqual(Object.keys(matrix).sort());
    for (const [action, fields] of Object.entries(matrix))
      expect(
        [...auditRules[action as keyof typeof auditRules].fields].sort(),
        action,
      ).toEqual(fields.split(" ").filter(Boolean).sort());
  });
  it("uses discriminated field types and rejects unknown or extra payload keys", () => {
    const typed: Extract<AuditChange, { field: "credited" }> = {
      field: "credited",
      before: false,
      after: true,
    };
    expect(auditChangeSchema.parse(typed)).toEqual(typed);
    const wrong: Extract<AuditChange, { field: "credited" }> = {
      field: "credited",
      before: false,
      // @ts-expect-error The field discriminant controls the value type.
      after: "true",
    };
    expect(auditChangeSchema.safeParse(wrong).success).toBe(false);
    for (const bad of [
      { field: "oldCardCode", before: null, after: "A7K3M9Q" },
      { field: "manifestDigest", before: null, after: "a".repeat(64) },
      { field: "quantity", before: null, after: 0.1 },
      { field: "amountKobo", before: null, after: 1 },
      { field: "outcome", before: null, after: "enabled" },
      { field: "purchaseIds", before: null, after: [id, id] },
      { field: "holdKinds", before: [], after: ["price", "price"] },
      { field: "policyBlocks", before: [], after: ["unknown"] },
      { field: "reviewConclusions", before: [], after: ["meter_reconciled"] },
      { field: "roleName", before: null, after: "08012345678" },
      { field: "state", before: null, after: "credited", raw: "secret" },
    ])
      expect(auditChangeSchema.safeParse(bad).success).toBe(false);
  });
  it("bounds related events and changes and denies action actor target mismatches", () => {
    const event = {
      id,
      eventCode: `AUD-${id}`,
      schemaVersion: 1,
      stationId: id,
      occurredAt: "2026-11-13T00:00:00Z",
      area: "access",
      action: "password_reset",
      actor: {
        kind: "system",
        service: "access",
        nameAtEvent: "Access service",
      },
      originatingSeller: null,
      target: { kind: "admin", id, code: "ADMIN001", subjectAtEvent: null },
      operationId: null,
      correlationId: id,
      reason: "Password reset",
      changes: [],
      relatedEventIds: [],
    };
    expect(currentAuditEventSchema.safeParse(event).success).toBe(true);
    for (const patch of [
      { relatedEventIds: Array(21).fill(id) },
      {
        changes: Array(101).fill({
          field: "enabled",
          before: false,
          after: true,
        }),
      },
      { action: "legacy_event" },
      { actor: { ...event.actor, service: "validation" } },
      { target: { ...event.target, kind: "attendant" } },
      { area: "sales" },
    ])
      expect(
        currentAuditEventSchema.safeParse({ ...event, ...patch }).success,
      ).toBe(false);
  });
});

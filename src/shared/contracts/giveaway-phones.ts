import { z } from "zod";
import { authId } from "./auth";
import { safeAuditText } from "./audit-privacy";
const version = z.number().int().positive().max(2147483647);
const reason = z.string().trim().min(1).max(1000).refine(safeAuditText);
const kind = z.enum(["initial", "revision"]);
const guard = {
  expectedVersion: version,
  expectedSettingsVersionId: authId.nullable(),
  expectedDataVersion: z.string().regex(/^(0|[1-9][0-9]*)$/),
  expectedPreviousSnapshotId: authId.nullable(),
};
const common = {
  operationId: authId,
  kind,
  reason,
  ...guard,
  expectedCensusVersion: version,
};
export const managerSchema = z.strictObject({
  operationId: authId,
  expectedVersion: version,
  managerAdminId: authId,
  reason,
});
export const censusSchema = z.strictObject({
  ...common,
  phones: z
    .array(
      z.strictObject({
        id: authId.optional(),
        label: z.string().trim().min(1).max(80).refine(safeAuditText),
        attendantIds: z.array(authId).min(1).max(100),
      }),
    )
    .min(1)
    .max(100),
});
export const exclusionSchema = z.strictObject({
  ...common,
  expectedPhoneVersion: version,
  partialSources: z
    .array(
      z.strictObject({ purchaseId: authId, expectedPurchaseVersion: version }),
    )
    .max(100),
});
export const exclusionDecisionSchema = z.strictObject({
  operationId: authId,
  expectedVersion: version,
  decision: z.enum(["approve", "reject"]),
  reason,
});
export const phoneCheckSchema = z.strictObject({
  ...common,
  entries: z
    .array(
      z.strictObject({
        phoneId: authId,
        expectedPhoneVersion: version,
        result: z.enum(["empty", "unavailable"]),
        exclusionId: authId.nullable(),
      }),
    )
    .min(1)
    .max(100),
});

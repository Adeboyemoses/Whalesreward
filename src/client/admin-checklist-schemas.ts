import { z } from "zod";
import { authId } from "../shared/contracts/auth";
import { actorSchema } from "../shared/contracts/admin";
import { campaignSchema } from "../shared/contracts/settings";
import { incompleteChoiceSchema } from "../shared/contracts/giveaway-projections";
const version = z.number().int().positive();
const instant = z.iso.datetime({ offset: true });
export const phoneSchema = z.strictObject({
  id: authId,
  version,
  label: z.string().min(1).max(80),
  attendantIds: z.array(authId).min(1).max(100),
  state: z.enum([
    "unchecked",
    "empty",
    "unavailable_pending",
    "unavailable_approved",
  ]),
});
export const censusMetaSchema = z.strictObject({
  id: authId.nullable(),
  campaignId: authId,
  version,
  managerAdminId: authId.nullable(),
  dataVersion: z.string().regex(/^(0|[1-9][0-9]*)$/),
});
export const exclusionSourceSchema = incompleteChoiceSchema.omit({
  everAccepted: true,
  hasTrustedByteObservation: true,
  hasCompletePhotoFact: true,
  phoneAttribution: true,
});
export const exclusionSchema = z.strictObject({
  id: authId,
  campaignId: authId,
  phoneId: authId,
  version,
  censusId: authId,
  censusVersion: version,
  phoneVersion: version,
  designationId: authId,
  settingsVersionId: authId.nullable(),
  policyVersion: z.string().nullable(),
  previousSnapshotId: authId.nullable(),
  phoneLabel: z.string(),
  attendants: z
    .array(
      z.strictObject({
        id: authId,
        staffCode: z.string(),
        name: z.string(),
        username: z.string(),
      }),
    )
    .min(1)
    .max(100),
  partialSources: z.array(exclusionSourceSchema).max(100),
  kind: z.enum(["initial", "revision"]),
  state: z.enum(["pending", "approved", "rejected", "superseded"]),
  proposedBy: actorSchema,
  proposedAt: instant,
  decidedBy: actorSchema.nullable(),
  decidedAt: instant.nullable(),
  reason: z.string(),
  decisionReason: z.string().nullable(),
  auditEventId: authId,
});
export const phoneCheckReceiptSchema = z.strictObject({
  id: authId,
  campaignId: authId,
  kind: z.enum(["initial", "revision"]),
  manager: actorSchema,
  checkedAt: instant,
  sourceDataVersion: z.string(),
  settingsVersionId: authId.nullable(),
  censusVersion: version,
  previousSnapshotId: authId.nullable(),
  policyVersion: z.string().nullable(),
  censusId: authId,
  auditEventId: authId,
});
export const phoneEntrySchema = z.strictObject({
  phoneId: authId,
  phoneVersion: version,
  attendantIds: z.array(authId),
  result: z.enum(["empty", "unavailable"]),
  exclusionId: authId.nullable(),
});
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });
export const censusReceiptSchema = z.strictObject({
  census: censusMetaSchema,
  campaign: campaignSchema,
  auditEventId: authId,
});
export const managerReceiptSchema = z.strictObject({
  campaign: campaignSchema,
  auditEventId: authId,
});
export const exclusionReceiptSchema = z.strictObject({
  exclusion: exclusionSchema,
  campaign: campaignSchema,
});
export const checkReceiptSchema = z.strictObject({
  phoneCheck: phoneCheckReceiptSchema,
  campaign: campaignSchema,
});
export type Exclusion = z.infer<typeof exclusionSchema>;
export type Phone = z.infer<typeof phoneSchema>;

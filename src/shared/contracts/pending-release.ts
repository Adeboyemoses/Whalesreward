import { z } from "zod";
import { authId } from "./auth";

export const releaseKindSchema = z.enum(["price", "card", "date", "capture"]);
const instant = z.iso.datetime({ offset: true });
const cursor = z.string().min(1).max(4096);
export const pendingReleaseSummarySchema = z.strictObject({
  proposalId: authId,
  proposalVersion: z.number().int().min(1).max(2147483647),
  kind: releaseKindSchema,
  outcome: z.enum(["confirm", "cancel"]),
  state: z.literal("pending"),
  proposedBy: z.strictObject({
    id: authId,
    code: z.string().min(1).max(120),
    name: z.string().min(1).max(200),
  }),
  proposedAt: instant,
});
export const pendingReleaseRowSchema = pendingReleaseSummarySchema.extend({
  purchaseId: authId,
  saleCode: z.string().min(1).max(120),
});
export const pendingReleaseFilterSchema = z.strictObject({
  kind: releaseKindSchema.optional(),
  cursor: cursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const pendingReleasePageSchema = z.strictObject({
  items: z.array(pendingReleaseRowSchema).max(100),
  nextCursor: cursor.nullable(),
  asOf: instant,
  summary: z.strictObject({ pending: z.string().regex(/^(0|[1-9][0-9]*)$/) }),
});
export type ReleaseKind = z.infer<typeof releaseKindSchema>;
export type PendingReleaseFilter = z.infer<typeof pendingReleaseFilterSchema>;

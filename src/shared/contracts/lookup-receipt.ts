import { z } from "zod";
const id = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const instant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine(
    (v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v,
  );
export const lookupReceiptClaimsSchema = z.strictObject({
  version: z.literal(1),
  purpose: z.literal("capture_lookup"),
  captureContextId: id,
  originatingAccountId: id,
  stationId: id,
  cardId: id,
  cardCode: z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{7}$/),
  customerId: id,
  cardCustomerLinkId: id,
  issuedAt: instant,
  expiresAt: instant,
});
export type LookupReceiptClaims = z.infer<typeof lookupReceiptClaimsSchema>;
export const lookupReceiptSchema = z
  .string()
  .max(2048)
  .regex(/^lr1\.[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);

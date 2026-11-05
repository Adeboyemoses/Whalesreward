import { z } from "zod";
import { authId } from "./auth";
import { MAX_KOBO } from "../money";
export const SYNC_LIMITS = Object.freeze({
  maxBytes: 8 * 1024 * 1024,
  maxPixels: 16000000,
  maxDimension: 6000,
  uploadSeconds: 300,
});
export const CARD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const cardCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{7}$/);
export const lookupSchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("code"),
      code: z.string().max(32).pipe(cardCode),
    })
    .strict(),
  z
    .object({ source: z.literal("qr"), qr: z.string().max(256).pipe(cardCode) })
    .strict(),
]);
const kobo = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((v) => BigInt(v) <= MAX_KOBO);
const quantity = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/)
  .refine((v) => /[1-9]/.test(v))
  .transform((v) =>
    v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v,
  );
const instant = z.iso
  .datetime({ offset: true })
  .transform((v) => new Date(v).toISOString());
export const photoSchema = z
  .object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive().max(SYNC_LIMITS.maxBytes),
    mediaType: z.literal("image/jpeg"),
  })
  .strict();
export const originalSaleSchema = z
  .object({
    operationId: authId,
    captureContextId: authId,
    assignmentId: authId,
    cardCode,
    appCapturedAt: instant,
    priceVersionId: authId,
    rateKobo: kobo,
    currency: z.literal("NGN"),
    quantityPrecision: z.number().int().min(0).max(6),
    unit: z.enum(["litre", "kilogram"]),
    medium: z.enum(["vehicle", "keg", "three_wheeler", "bike", "cylinder"]),
    entry: z.discriminatedUnion("basis", [
      z
        .object({
          basis: z.literal("amount"),
          enteredAmountKobo: kobo,
          amountKobo: kobo,
          quantity,
        })
        .strict(),
      z
        .object({
          basis: z.literal("quantity"),
          enteredQuantity: quantity,
          amountKobo: kobo,
          quantity,
        })
        .strict(),
    ]),
    photo: photoSchema,
  })
  .strict();
export const uploadSchema = photoSchema
  .extend({ operationId: authId })
  .strict();
export const finalizeSchema = z
  .object({
    operationId: authId,
    uploadId: authId,
    expectedVersion: z.number().int().min(1).max(2147483647),
  })
  .strict();
export type OriginalSale = z.infer<typeof originalSaleSchema>;
export type UploadRequest = z.infer<typeof uploadSchema>;
export type FinalizeRequest = z.infer<typeof finalizeSchema>;
export type LookupInput = z.infer<typeof lookupSchema>;
export type Lookup = {
  cardCode: string;
  customer: { id: string; name: string; category: string };
  lookedUpAt: string;
};
export type Hold = { kind: "price" | "card" | "date"; reasonCode: string };
export type SaleStatus = {
  purchaseId: string;
  operationId: string;
  saleCode: string;
  version: number;
  state:
    | "received"
    | "photo_pending"
    | "finalizing"
    | "credited"
    | "held"
    | "cancelled";
  detailsReceived: true;
  photoValidated: boolean;
  credited: boolean;
  currentRevisionId: string | null;
  customer: Lookup["customer"] | null;
  holds: Hold[];
  cancellationReason: string | null;
  pendingReason:
    | "lookup_pending"
    | "photo_required"
    | "validation_pending"
    | "policy_review_required"
    | null;
  serverReceivedAt: string;
};
export type UploadPermission = {
  uploadId: string;
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
  maxBytes: number;
};

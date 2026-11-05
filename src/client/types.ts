import { z } from "zod";
const id = z.uuidv7();
const instant = z.iso.datetime({ offset: true });
const label = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[^\u0000-\u001f\u007f]*$/);
const version = z.number().int().min(1).max(2147483647);
const kobo = z
  .string()
  .regex(/^(0|[1-9]\d*)$/)
  .refine((v) => BigInt(v) > 0n && BigInt(v) <= 9223372036854775807n);
export const productSchema = z.enum([
  "pms",
  "diesel",
  "kerosene",
  "cooking_gas",
]);
export const categorySchema = z.enum([
  "car_owner",
  "commercial_bus_driver",
  "three_wheeler_user",
  "bike_user",
  "keg_buyer",
  "cooking_gas_customer",
]);
export const priceSchema = z.strictObject({
  priceVersionId: id,
  version,
  rateKobo: kobo,
  currency: z.literal("NGN"),
  quantityPrecision: z.number().int().min(0).max(6),
  effectiveFrom: instant,
  fetchedAt: instant,
});
export const sessionSchema = z
  .strictObject({
    account: z.strictObject({
      id,
      staffCode: label.max(64),
      name: label,
      username: label.max(64),
    }),
    station: z.strictObject({
      id,
      code: label.max(64),
      name: label,
      timezone: label,
    }),
    assignment: z.strictObject({ id, version }),
    pump: z.strictObject({ id, code: label.max(64) }),
    product: z.strictObject({
      id,
      code: productSchema,
      unit: z.enum(["litre", "kilogram"]),
    }),
    price: priceSchema,
    captureContextId: id,
    lastOnlineSignInAt: instant,
    offlineExpiresAt: instant,
    sessionExpiresAt: instant,
    serverTime: instant,
    reassignmentRequiresSignIn: z.boolean(),
  })
  .refine(
    (s) =>
      Date.parse(s.offlineExpiresAt) - Date.parse(s.lastOnlineSignInAt) ===
        86400000 &&
      Date.parse(s.serverTime) >= Date.parse(s.lastOnlineSignInAt) &&
      (s.product.code === "cooking_gas") === (s.product.unit === "kilogram"),
  );
export const CARD_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{7}$/;
export function normalizeCardCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!CARD_CODE.test(code))
    throw new ClientError(
      "invalid_card",
      "Enter the seven-character code printed on the card.",
    );
  return code;
}
export const lookupSchema = z.strictObject({
  cardCode: z.string().regex(CARD_CODE),
  customer: z.strictObject({ id, name: label, category: categorySchema }),
  lookedUpAt: instant,
});
export type Session = z.infer<typeof sessionSchema>;
export type Lookup = z.infer<typeof lookupSchema>;
export type Medium = "vehicle" | "keg" | "three_wheeler" | "bike" | "cylinder";
export type Entry =
  | {
      basis: "amount";
      enteredAmountKobo: string;
      amountKobo: string;
      quantity: string;
    }
  | {
      basis: "quantity";
      enteredQuantity: string;
      amountKobo: string;
      quantity: string;
    };
export type OriginalSale = {
  operationId: string;
  captureContextId: string;
  assignmentId: string;
  cardCode: string;
  appCapturedAt: string;
  priceVersionId: string;
  rateKobo: string;
  currency: string;
  quantityPrecision: number;
  unit: "litre" | "kilogram";
  medium: Medium;
  entry: Entry;
  photo: { sha256: string; bytes: number; mediaType: "image/jpeg" };
};
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
  holds: Array<{ kind: "price" | "card" | "date"; reasonCode: string }>;
  cancellationReason: string | null;
  pendingReason:
    | "lookup_pending"
    | "photo_required"
    | "validation_pending"
    | "policy_review_required"
    | null;
  serverReceivedAt: string;
};
export type OutboxRow = {
  schemaVersion: 1;
  originatingAccountId: string;
  operationId: string;
  original: OriginalSale;
  captureDisplay: {
    sellerName: string;
    sellerUsername: string;
    staffCode: string;
    stationId: string;
    stationCode: string;
    pumpId: string;
    pumpCode: string;
    product: Session["product"]["code"];
  };
  customerCache: Lookup | null;
  photoBlob: Blob;
  photoDigest: string;
  state:
    | "saved"
    | "submitting"
    | "photo_pending"
    | "uploading"
    | "finalizing"
    | "credited"
    | "held"
    | "cancelled"
    | "needs_attention";
  purchaseId: string | null;
  serverVersion: number | null;
  serverStatus: SaleStatus | null;
  uploadOperationId: string | null;
  uploadId: string | null;
  finalizeRequest: {
    operationId: string;
    uploadId: string;
    expectedVersion: number;
  } | null;
  attempts: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  localSavedAt: string;
  syncLease: { owner: string; expiresAt: string } | null;
};
export type OfflineWindow = {
  schemaVersion: 1;
  originatingAccountId: string;
  deviceId: string;
  captureContextId: string;
  lastOnlineSignInAt: string;
  offlineExpiresAt: string;
  lastTrustedServerTime: string;
  elapsedAtCheckpointMs: number;
  wallTimeAtCheckpoint: string;
  runtimeId: string;
  locked: boolean;
  logoutPending: boolean;
  session: Session;
};
export type CapturedPhoto = {
  blob: Blob;
  sha256: string;
  bytes: number;
  mediaType: "image/jpeg";
};
export type CaptureDraft = {
  operationId: string;
  appCapturedAt: string;
  session: Session;
};
export type CaptureInput = {
  cardCode: string;
  customerCache: Lookup | null;
  medium: Medium;
  basis: "amount" | "quantity";
  value: string;
  photo: CapturedPhoto;
};
export type ClientState = {
  session: Session | null;
  access: "signed_out" | "active" | "expired";
  logoutPending: boolean;
};
export class ClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly retryAfterMs: number | null = null,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

export type UploadPermissionRequest = {
  operationId: string;
  sha256: string;
  bytes: number;
  mediaType: "image/jpeg";
};
export type UploadPermission = {
  uploadId: string;
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
  maxBytes: number;
};
export type FinalizeRequest = NonNullable<OutboxRow["finalizeRequest"]>;
export type SyncResult = { status: SaleStatus; retryAfterMs: number | null };
export const saleStatusSchema: z.ZodType<SaleStatus> = z
  .strictObject({
    purchaseId: id,
    operationId: id,
    saleCode: label.max(64),
    version,
    state: z.enum([
      "received",
      "photo_pending",
      "finalizing",
      "credited",
      "held",
      "cancelled",
    ]),
    detailsReceived: z.literal(true),
    photoValidated: z.boolean(),
    credited: z.boolean(),
    currentRevisionId: id.nullable(),
    customer: lookupSchema.shape.customer.nullable(),
    holds: z
      .array(
        z.discriminatedUnion("kind", [
          z.strictObject({
            kind: z.literal("price"),
            reasonCode: z.literal("price_uncertain"),
          }),
          z.strictObject({
            kind: z.literal("card"),
            reasonCode: z.literal("replaced_card"),
          }),
          z.strictObject({
            kind: z.literal("date"),
            reasonCode: z.enum([
              "capture_date_uncertain",
              "capture_time_unresolved",
              "capture_authorization_unresolved",
            ]),
          }),
        ]),
      )
      .max(10),
    cancellationReason: z
      .enum(["customer_not_found", "invalid_purchase"])
      .nullable(),
    pendingReason: z
      .enum([
        "lookup_pending",
        "photo_required",
        "validation_pending",
        "policy_review_required",
      ])
      .nullable(),
    serverReceivedAt: instant,
  })
  .refine((s) => {
    if (s.state === "credited")
      return (
        s.credited &&
        s.photoValidated &&
        !!s.currentRevisionId &&
        !!s.customer &&
        s.holds.length === 0 &&
        s.pendingReason === null &&
        s.cancellationReason === null
      );
    if (s.credited) return false;
    if ((s.state === "cancelled") !== (s.cancellationReason !== null))
      return false;
    if (s.state === "held")
      return (
        s.photoValidated &&
        (s.holds.length > 0 || s.pendingReason === "policy_review_required")
      );
    return true;
  });
export const uploadPermissionSchema: z.ZodType<UploadPermission> =
  z.strictObject({
    uploadId: id,
    method: z.literal("PUT"),
    url: z
      .url()
      .max(4096)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" &&
          !url.username &&
          !url.password &&
          !url.hash
        );
      }),
    headers: z
      .record(z.string().min(1).max(128), z.string().max(4096))
      .refine((headers) =>
        Object.entries(headers).every(
          ([key, value]) =>
            !/[\r\n]/.test(key + value) &&
            !["authorization", "cookie", "set-cookie", "host"].includes(
              key.toLowerCase(),
            ),
        ),
      ),
    expiresAt: instant,
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 * 1024),
  });

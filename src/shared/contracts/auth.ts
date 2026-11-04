import { z } from "zod";
export const authId = z.uuidv7().refine((v) => v === v.toLowerCase());
const text = z
  .string()
  .min(1)
  .regex(/^[^\u0000-\u001f\u007f]*$/);
export const signInSchema = z.strictObject({
  username: text.max(64),
  password: text.max(1024),
  deviceId: authId,
});
export const signOutSchema = z.strictObject({});
export type SignInInput = z.infer<typeof signInSchema>;
const instant = z.iso.datetime({ offset: true });
const version = z.number().int().min(1).max(2147483647);
export const attendantSessionSchema = z.strictObject({
  account: z.strictObject({
    id: authId,
    staffCode: text.max(64),
    name: text.max(120),
    username: text.max(64),
  }),
  station: z.strictObject({
    id: authId,
    code: text.max(64),
    name: text.max(120),
    timezone: text.max(120),
  }),
  assignment: z.strictObject({ id: authId, version }),
  pump: z.strictObject({ id: authId, code: text.max(64) }),
  product: z.strictObject({
    id: authId,
    code: z.enum(["pms", "diesel", "kerosene", "cooking_gas"]),
    unit: z.enum(["litre", "kilogram"]),
  }),
  price: z.strictObject({
    priceVersionId: authId,
    version,
    rateKobo: z
      .string()
      .regex(/^[1-9]\d*$/)
      .refine((v) => BigInt(v) <= 9223372036854775807n),
    currency: z.literal("NGN"),
    quantityPrecision: z.number().int().min(0).max(6),
    effectiveFrom: instant,
    fetchedAt: instant,
  }),
  captureContextId: authId,
  lastOnlineSignInAt: instant,
  offlineExpiresAt: instant,
  sessionExpiresAt: instant,
  serverTime: instant,
  reassignmentRequiresSignIn: z.boolean(),
});
export type AttendantSession = z.infer<typeof attendantSessionSchema>;

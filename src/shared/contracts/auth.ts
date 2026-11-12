import { z } from "zod";
export const authId = z.uuidv7().refine((v) => v === v.toLowerCase());
const text = z
  .string()
  .min(1)
  .regex(/^[^\u0000-\u001f\u007f]*$/);
// Passwords are exact (never trimmed). Every credential we provision must also
// be accepted at sign-in; an unanchored control test avoids JS $ matching before
// a trailing newline. Keep the legacy sign-in length range at 1..1024.
export const attendantPasswordSchema = z
  .string()
  .max(1024)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "Control characters are not supported in passwords",
  );
export const signInSchema = z.strictObject({
  username: text.max(64),
  password: attendantPasswordSchema.min(1),
  deviceId: authId,
});
export const signOutSchema = z.strictObject({});
export type SignInInput = z.infer<typeof signInSchema>;
const instant = z.iso.datetime({ offset: true });
const version = z.number().int().min(1).max(2147483647);
export const priceSnapshotSchema = z
  .strictObject({
    priceVersionId: authId,
    version,
    rateKobo: z
      .string()
      .refine((v) => /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n),
    currency: z.literal("NGN"),
    quantityPrecision: z.number().int().min(0).max(6),
    effectiveFrom: z.iso.datetime(),
    fetchedAt: z.iso.datetime(),
  })
  .refine(
    (value) => Date.parse(value.effectiveFrom) <= Date.parse(value.fetchedAt),
    { message: "Price activation cannot follow its read", path: ["fetchedAt"] },
  );
export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>;
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
  price: priceSnapshotSchema,
  captureContextId: authId,
  lastOnlineSignInAt: instant,
  offlineExpiresAt: instant,
  sessionExpiresAt: instant,
  serverTime: instant,
  reassignmentRequiresSignIn: z.boolean(),
});
export type AttendantSession = z.infer<typeof attendantSessionSchema>;

export const restrictedAttendantSessionSchema = z.strictObject({
  state: z.literal("password_change_required"),
  account: z.strictObject({
    id: authId,
    staffCode: text.max(64),
    name: text.max(120),
    username: text.max(64),
  }),
  sessionExpiresAt: instant,
  serverTime: instant,
});
export type RestrictedAttendantSession = z.infer<
  typeof restrictedAttendantSessionSchema
>;

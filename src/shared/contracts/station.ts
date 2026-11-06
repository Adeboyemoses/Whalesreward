import { z } from "zod";
import { authId } from "./auth";
import { pageSchema } from "./admin";
const name = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\u0000-\u001f\u007f]*$/);
const reason = z.string().trim().min(1).max(1000);
const version = z.number().int().positive().max(2147483647);
export const productCode = z.enum(["pms", "diesel", "kerosene", "cooking_gas"]);
export const stationPageSchema = pageSchema;
export const candidateSchema = pageSchema
  .extend({ pumpId: authId.optional() })
  .strict();
export const attendantSearchSchema = candidateSchema
  .extend({ query: name.optional() })
  .strict();
export const createPumpSchema = z.strictObject({
  operationId: authId,
  name,
  productCode,
});
export const activatePriceSchema = z.strictObject({
  operationId: authId,
  expectedVersion: version.nullable(),
  rateKobo: z.string().max(32),
  currency: z.string().max(3),
  quantityPrecision: z.number().int(),
  reason,
});
export const createAttendantSchema = z.strictObject({
  operationId: authId,
  name,
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,40}$/),
  password: z.string().max(1024),
  pumpId: authId,
  expectedPumpVersion: version,
});
export const assignAttendantSchema = z.strictObject({
  operationId: authId,
  expectedVersion: version,
  expectedAssignmentId: authId.nullable(),
  pumpId: authId,
  expectedPumpVersion: version,
  reason,
});
export const firstAttendantPasswordSchema = z.strictObject({
  operationId: authId,
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().max(1024),
  confirmPassword: z.string().max(1024),
});
export const productSchema = z.strictObject({
  id: authId,
  code: productCode,
  unit: z.enum(["litre", "kilogram"]),
});
export const priceSchema = z.strictObject({
  priceVersionId: authId,
  version,
  rateKobo: z.string().regex(/^[1-9]\d*$/),
  currency: z.literal("NGN"),
  quantityPrecision: z.number().int().min(0).max(6),
  effectiveFrom: z.iso.datetime({ offset: true }),
  fetchedAt: z.iso.datetime({ offset: true }),
});
export const assignmentSchema = z.strictObject({
  id: authId,
  version,
  pump: z.strictObject({ id: authId, code: z.string(), name: z.string() }),
  product: productSchema,
  effectiveFrom: z.iso.datetime({ offset: true }),
});
export const attendantSchema = z.strictObject({
  id: authId,
  accountId: authId,
  staffCode: z.string(),
  name: z.string(),
  username: z.string(),
  version,
  createdAt: z.iso.datetime({ offset: true }),
  assignment: assignmentSchema.nullable(),
  handover: z.enum(["fresh_sign_in_required", "acknowledged", "unassigned"]),
});
export const pumpSchema = z.strictObject({
  id: authId,
  code: z.string(),
  name: z.string(),
  version,
  product: productSchema,
  price: priceSchema.nullable(),
  attendantCount: z.string().regex(/^\d+$/),
});

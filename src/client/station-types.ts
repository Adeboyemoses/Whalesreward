import { z } from "zod";
import { authId } from "../shared/contracts/auth";
import {
  attendantSchema,
  pumpSchema as basePumpSchema,
  productSchema,
  priceSchema as basePriceSchema,
} from "../shared/contracts/station";
import { assertMoney, parseKobo } from "../shared/money";
export const priceSchema = basePriceSchema.refine((value) => {
  try {
    assertMoney(parseKobo(value.rateKobo), true);
    return true;
  } catch {
    return false;
  }
}, "Invalid price range");
export const pumpSchema = basePumpSchema.extend({
  price: priceSchema.nullable(),
});
export { attendantSchema, productSchema };
const instant = z.iso.datetime({ offset: true });
const version = z.number().int().positive();
export const actorSchema = z.strictObject({
  id: authId,
  code: z.string(),
  name: z.string(),
});
export const assignmentEventSchema = z.strictObject({
  id: authId,
  version,
  fromPumpId: authId.nullable(),
  toPumpId: authId,
  actor: actorSchema,
  reason: z.string(),
  effectiveFrom: instant,
  effectiveUntil: instant.nullable(),
});
export const pumpAssignmentEventSchema = assignmentEventSchema.extend({
  attendantId: authId,
  staffCode: z.string(),
  attendantName: z.string(),
});
export const priceEventSchema = z.strictObject({
  id: authId,
  product: productSchema,
  version,
  previous: priceSchema.nullable(),
  current: priceSchema,
  actor: actorSchema,
  reason: z.string(),
});
export const stationPriceSchema = z.strictObject({
  product: productSchema,
  price: priceSchema.nullable(),
  pumps: z.array(
    z.strictObject({ id: authId, code: z.string(), name: z.string() }),
  ),
});
export const pricesSchema = z.strictObject({
  items: z.array(stationPriceSchema),
});
export const productsSchema = z.strictObject({ items: z.array(productSchema) });
export const assignmentReceiptSchema = z.strictObject({
  attendant: attendantSchema,
  change: assignmentEventSchema,
});
// Normative M2 P-21 client projection; no production fake or authority lives here.
export const assignmentEndReceiptSchema = z.strictObject({
  operationId: authId,
  attendant: attendantSchema,
  ended: z.strictObject({
    assignmentId: authId,
    assignmentVersion: version,
    pumpId: authId,
    effectiveUntil: instant,
    actor: actorSchema,
    reason: z.string(),
  }),
});
export type Pump = z.infer<typeof pumpSchema>;
export type Attendant = z.infer<typeof attendantSchema>;
export type Product = z.infer<typeof productSchema>;
export type StationPrice = z.infer<typeof stationPriceSchema>;
export type AssignmentEvent = z.infer<typeof assignmentEventSchema>;
export type PriceEvent = z.infer<typeof priceEventSchema>;
export type AssignmentEndReceipt = z.infer<typeof assignmentEndReceiptSchema>;
export type AssignmentReceipt = z.infer<typeof assignmentReceiptSchema>;

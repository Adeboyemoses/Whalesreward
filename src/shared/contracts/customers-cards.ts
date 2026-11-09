import { lookupReceiptSchema } from "./lookup-receipt";
import { z } from "zod";
import { authId } from "./auth";
import { pageSchema } from "./admin";
import { cardCode, lookupSchema } from "./sync";
export const categorySchema = z.enum([
  "car_owner",
  "commercial_bus_driver",
  "three_wheeler_user",
  "bike_user",
  "keg_buyer",
  "cooking_gas_customer",
]);
const name = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[^\u0000-\u001f\u007f]*$/);
const version = z.number().int().positive().max(2147483647);
const instant = z.iso.datetime({ offset: true });
const count = z.string().regex(/^(0|[1-9][0-9]*)$/);
const actor = z.strictObject({
  id: authId,
  code: z.string(),
  name: z.string(),
});
const station = z.strictObject({ id: authId, name: z.string() });
export const registrationSchema = z.strictObject({
  operationId: authId,
  name,
  phone: z.string().max(32),
  category: categorySchema,
  card: lookupSchema,
});
export const phoneLookupSchema = z.strictObject({ phone: z.string().max(32) });
export const customerSearchSchema = pageSchema
  .extend({ query: name.optional(), category: categorySchema.optional() })
  .strict();
export const createBatchSchema = z.strictObject({
  operationId: authId,
  name,
  count: z.number().int(),
});
export const batchTransitionSchema = z.strictObject({
  operationId: authId,
  expectedVersion: version,
  reason: z.string().trim().min(1).max(1000),
});
export const createExportSchema = z.strictObject({
  operationId: authId,
  expectedVersion: version,
  format: z.enum(["pdf", "xlsx"]),
});
export const batchListSchema = pageSchema
  .extend({ status: z.enum(["generated", "printed", "active"]).optional() })
  .strict();
export const cardListSchema = pageSchema
  .extend({ state: z.enum(["unassigned", "linked", "retired"]).optional() })
  .strict();
export const registrationReceiptSchema = z.strictObject({
  operationId: authId,
  customer: z.strictObject({
    id: authId,
    customerCode: z.string(),
    name: z.string(),
    category: categorySchema,
    phone: z.string(),
  }),
  cardCode,
  registeredAt: instant,
  registeredAtStation: station,
  registeredBy: actor,
});
export const registrationReceiptWithLookupSchema = registrationReceiptSchema
  .extend({ lookupReceipt: lookupReceiptSchema.nullable() })
  .strict();
export const customerLookupSchema = z.strictObject({
  customer: z.strictObject({
    id: authId,
    customerCode: z.string(),
    name: z.string(),
    category: categorySchema,
  }),
  cardCode: cardCode.nullable(),
  cardUsable: z.boolean(),
  lookedUpAt: instant,
});
export const customerSummarySchema = z.strictObject({
  id: authId,
  customerCode: z.string(),
  name: z.string(),
  phoneMasked: z.string(),
  category: categorySchema,
  activeCardCode: cardCode.nullable(),
  registeredAt: instant,
  recordedSpendKobo: count,
  currency: z.literal("NGN"),
  completedPurchaseCount: count,
});
export const customerProfileSchema = customerSummarySchema
  .extend({
    version,
    registeredAtStation: station.nullable(),
    registeredBy: actor.nullable(),
    pending: z.strictObject({ amountKobo: count, count }),
    quantities: z
      .array(
        z.strictObject({
          product: z.enum(["pms", "diesel", "kerosene", "cooking_gas"]),
          unit: z.enum(["litre", "kilogram"]),
          quantity: z.string().regex(/^\d+(\.\d{1,6})?$/),
        }),
      )
      .max(4),
  })
  .strict();
export const batchSchema = z.strictObject({
  id: authId,
  batchCode: z.string(),
  name: z.string(),
  version,
  status: z.enum(["generated", "printed", "active"]),
  createdAt: instant,
  createdBy: actor,
  total: count,
  unassigned: count,
  linked: count,
  retired: count,
  availableToAssign: count,
});
export const inventoryCardSchema = z.strictObject({
  id: authId,
  code: cardCode,
  qrPayload: cardCode,
  state: z.enum(["unassigned", "linked", "retired"]),
  assignmentEligible: z.boolean(),
  linkedCustomer: z
    .strictObject({ id: authId, customerCode: z.string(), name: z.string() })
    .nullable(),
  retiredAt: instant.nullable(),
});
export const batchEventSchema = z.strictObject({
  id: authId,
  from: z.enum(["generated", "printed"]).nullable(),
  to: z.enum(["generated", "printed", "active"]),
  actor,
  reason: z.string(),
  occurredAt: instant,
});
export const cardExportSchema = z.strictObject({
  id: authId,
  batchId: authId,
  format: z.enum(["pdf", "xlsx"]),
  state: z.enum(["pending", "ready", "failed", "expired"]),
  preparedAt: instant.nullable(),
  snapshotAt: instant,
  batchStatus: z.enum(["generated", "printed", "active"]),
  batchVersion: version,
  cardCount: count,
  expiresAt: instant.nullable(),
  failure: z.literal("preparation_failed").nullable(),
});

export const customerSaleSchema = z.strictObject({
  id: authId,
  saleCode: z.string(),
  appCapturedAt: instant,
  serverReceivedAt: instant,
  product: z.enum(["pms", "diesel", "kerosene", "cooking_gas"]),
  unit: z.enum(["litre", "kilogram"]),
  amountKobo: count,
  currency: z.literal("NGN"),
  quantity: z.string().regex(/^\d+(\.\d{1,6})?$/),
  seller: z.strictObject({
    id: authId,
    name: z.string(),
    username: z.string(),
  }),
  pump: z.strictObject({ id: authId, code: z.string() }),
  state: z.enum([
    "received",
    "photo_pending",
    "finalizing",
    "credited",
    "held",
    "cancelled",
  ]),
  holds: z
    .array(
      z.strictObject({
        kind: z.enum(["price", "card", "date"]),
        reasonCode: z.string(),
      }),
    )
    .max(3),
  duplicateFlag: z.boolean(),
  correctionPending: z.boolean(),
  credited: z.boolean(),
});

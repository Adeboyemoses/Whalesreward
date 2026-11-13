import { z } from "zod";
import { authId } from "./auth";
import { actorSchema } from "./admin";
import { saleDateSchema } from "./sales";
export const REPORT_LIMITS = {
  days: 366,
  sources: 100000,
  artifactBytes: 64 * 1024 * 1024,
  lifetimeMs: 86400000,
  leaseMs: 60000,
  attempts: 3,
  retryMs: 1000,
} as const;
export const dataVersionSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
const count = z.string().regex(/^(0|[1-9][0-9]*)$/);
const amount = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const quantity = z.string().regex(/^(0|[1-9][0-9]{0,23})(\.[0-9]{1,6})?$/);
const instant = z.iso.datetime({ offset: true });
const product = z.enum(["pms", "diesel", "kerosene", "cooking_gas"]);
const unit = z.enum(["litre", "kilogram"]);
const currency = z.string().regex(/^[A-Z]{3}$/);
const spend = z.array(z.strictObject({ currency, amountKobo: amount }));
export const totalsSchema = z.strictObject({
  purchases: count,
  spend,
  litres: quantity,
  kilograms: quantity,
  products: z.array(z.strictObject({ product, unit, quantity })),
});
export const reportFilterSchema = z.strictObject({
  from: z.string().max(10),
  to: z.string().max(10),
  product: product.nullable(),
  groupBy: z.enum(["product", "attendant", "pump"]),
});
const pageInput = {
  cursor: z.string().max(4096).optional(),
  limit: z.number().int().min(1).max(100).default(25),
};
export const reportQuerySchema = reportFilterSchema.extend({
  ...pageInput,
  expectedDataVersion: dataVersionSchema.optional(),
});
export const reportSourcesInputSchema = reportQuerySchema.extend({
  expectedDataVersion: dataVersionSchema,
});
export const reportExportInputSchema = z.strictObject({
  operationId: authId,
  format: z.enum(["pdf", "xlsx"]),
  filters: reportFilterSchema,
  expectedDataVersion: dataVersionSchema,
});
const attendant = z.strictObject({
  id: authId,
  staffCode: z.string(),
  name: z.string(),
  username: z.string(),
});
const pump = z.strictObject({ id: authId, code: z.string(), name: z.string() });
const state = z.enum([
  "received",
  "photo_pending",
  "finalizing",
  "held",
  "credited",
  "cancelled",
]);
const exclusion = z.enum(["pending", "held", "cancelled", "ineligible"]);
export const reportSourceSchema = z.strictObject({
  purchaseId: authId,
  saleCode: z.string(),
  revisionId: authId.nullable(),
  saleDate: saleDateSchema,
  dateEvidence: z.enum(["verified", "reported"]),
  appCapturedAt: instant,
  verifiedSaleDate: saleDateSchema.nullable(),
  serverReceivedAt: instant,
  attendant,
  pump,
  product,
  unit,
  amountKobo: amount,
  currency,
  quantity,
  state,
  included: z.boolean(),
  exclusion: exclusion.nullable(),
  valuesSource: z.enum(["accepted_revision", "original"]),
  duplicateFlag: z.boolean(),
  correctionPending: z.boolean(),
});
export const reportGroupSchema = z.strictObject({
  key: z.string(),
  product: product.nullable(),
  attendant: attendant.nullable(),
  pump: pump.extend({ product }).nullable(),
  totals: totalsSchema,
});
export const reportSchema = z.strictObject({
  filters: reportFilterSchema,
  asOf: instant,
  timezone: z.literal("Africa/Lagos"),
  dataVersion: dataVersionSchema,
  totals: totalsSchema,
  excluded: z.array(
    z.strictObject({ state: exclusion, records: count, spend }),
  ),
  daily: z.array(z.strictObject({ day: saleDateSchema, totals: totalsSchema })),
  groups: z.strictObject({
    items: z.array(reportGroupSchema),
    nextCursor: z.string().nullable(),
  }),
  dateBasis: z.literal("verified_or_reported_sale_date"),
});
export const reportExportSchema = z.strictObject({
  id: authId,
  format: z.enum(["pdf", "xlsx"]),
  filters: reportFilterSchema,
  sourceDataVersion: dataVersionSchema,
  snapshotAt: instant,
  createdBy: actorSchema,
  state: z.enum(["pending", "ready", "failed", "expired"]),
  preparedAt: instant.nullable(),
  expiresAt: instant.nullable(),
  byteSize: count.nullable(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  failureCode: z
    .enum(["preparation_failed", "precision_not_representable"])
    .nullable(),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;
export type ReportSource = z.infer<typeof reportSourceSchema>;
export type Report = z.infer<typeof reportSchema>;
export type Totals = z.infer<typeof totalsSchema>;
export type ReportExport = z.infer<typeof reportExportSchema>;
export type ReportSnapshot = {
  id: string;
  format: "pdf" | "xlsx";
  report: Report;
  sources: ReportSource[];
};

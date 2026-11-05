import { z } from "zod";
import { authId } from "./auth";
export const permissionCodes = [
  "overview",
  "sales",
  "corrections",
  "duplicates",
  "priceReview",
  "queueRecovery",
  "cardEligibility",
  "dateReview",
  "giveawayFinalize",
  "giveawayRevise",
  "customers",
  "recovery",
  "managerRecovery",
  "leaderboards",
  "reports",
  "reportExport",
  "cards",
  "cardGenerate",
  "cardExport",
  "cardPrint",
  "cardActivate",
  "attendants",
  "pumps",
  "prices",
  "settings",
  "audit",
  "users",
  "roles",
] as const;
export type PermissionCode = (typeof permissionCodes)[number];
export const permissionSchema = z.enum(permissionCodes);
export const dependencies: Partial<Record<PermissionCode, PermissionCode>> = {
  corrections: "sales",
  duplicates: "sales",
  priceReview: "sales",
  queueRecovery: "sales",
  cardEligibility: "sales",
  dateReview: "sales",
  giveawayFinalize: "leaderboards",
  giveawayRevise: "leaderboards",
  recovery: "customers",
  managerRecovery: "customers",
  reportExport: "reports",
  cardGenerate: "cards",
  cardExport: "cards",
  cardPrint: "cards",
  cardActivate: "cards",
};
export const sensitiveDefaults: readonly PermissionCode[] = [
  "queueRecovery",
  "cardEligibility",
  "dateReview",
  "giveawayFinalize",
  "giveawayRevise",
  "priceReview",
];
const name = z.string().trim().min(1).max(120);
const reason = z.string().trim().min(1).max(1000);
const version = z.number().int().positive();
export const emailSchema = z.string().trim().toLowerCase().max(254).email();
const password = z.string().max(1024);
const operationId = authId;
export const roleInputSchema = z
  .object({
    operationId,
    name,
    permissions: z
      .array(permissionSchema)
      .max(28)
      .refine((v) => new Set(v).size === v.length),
    reason,
  })
  .strict();
export const roleEditSchema = roleInputSchema
  .extend({ expectedVersion: version })
  .strict();
export const createUserSchema = z
  .object({
    operationId,
    name,
    username: z
      .string()
      .trim()
      .toLowerCase()
      .min(3)
      .max(40)
      .regex(/^[a-z0-9._-]+$/),
    email: emailSchema,
    temporaryPassword: password,
    roleId: authId,
    expectedRoleVersion: version,
    reason,
  })
  .strict();
export const accessSchema = z
  .object({
    operationId,
    expectedVersion: version,
    roleId: authId,
    expectedRoleVersion: version,
    enabled: z.boolean(),
    reason,
  })
  .strict();
export const firstPasswordSchema = z
  .object({ operationId, newPassword: password, confirmPassword: password })
  .strict();
export const tokenSchema = z
  .object({ token: z.string().min(1).max(256) })
  .strict();
export const resetConfirmSchema = tokenSchema
  .extend({ newPassword: password, confirmPassword: password })
  .strict();
export const verifyRequestSchema = z
  .object({ operationId, expectedVersion: version })
  .strict();
export const resetRequestSchema = z.object({ email: emailSchema }).strict();
export const adminSignInSchema = z
  .object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(1024),
  })
  .strict();
export const pageSchema = z
  .object({
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();
export const searchUsersSchema = pageSchema
  .extend({
    query: name.optional(),
    enabled: z.boolean().optional(),
    roleId: authId.optional(),
  })
  .strict();
export const historySchema = pageSchema
  .extend({
    targetType: z.enum(["admin", "role"]).optional(),
    targetId: authId.optional(),
  })
  .strict()
  .refine((v) => !v.targetId || !!v.targetType);
export const accessValuesSchema = z
  .object({
    roleId: authId.optional(),
    roleName: name.optional(),
    enabled: z.boolean().optional(),
    permissions: z.array(permissionSchema).optional(),
    emailVerified: z.boolean().optional(),
  })
  .strict();
export const actorSchema = z
  .object({ id: authId, code: z.string(), name: z.string() })
  .strict();
export const roleSummarySchema = z
  .object({
    id: authId,
    name: z.string(),
    version,
    isOwner: z.boolean(),
    permissions: z.array(permissionSchema),
    userCount: z.string().regex(/^\d+$/),
  })
  .strict();
export const adminUserSchema = z
  .object({
    id: authId,
    accountId: authId,
    adminCode: z.string(),
    name: z.string(),
    username: z.string(),
    email: z.string().nullable(),
    emailVerified: z.boolean(),
    emailVerifiedAt: z.string().nullable(),
    enabled: z.boolean(),
    mustChangePassword: z.boolean(),
    role: roleSummarySchema,
    version,
    createdAt: z.string(),
    createdBy: actorSchema.nullable(),
    lastSignInAt: z.string().nullable(),
  })
  .strict();
export type AdminUser = z.infer<typeof adminUserSchema>;
export type RoleSummary = z.infer<typeof roleSummarySchema>;
export type RoleInput = z.infer<typeof roleInputSchema>;
export type RoleEdit = z.infer<typeof roleEditSchema>;
export type CreateUser = z.infer<typeof createUserSchema>;
export type AccessInput = z.infer<typeof accessSchema>;
export const resetMessage =
  "If this address belongs to an active account with a verified email, you will receive a reset link.";

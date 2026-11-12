import { z } from "zod";
import { authId } from "./auth";
import { actorSchema } from "./admin";
const version = z.number().int().positive();
const cardCode = z.string().regex(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{7}$/);
// Mentions describe the checks performed; actual values must never enter notes.
const sensitiveAssignment =
  /\b(?:otp|code|password|token|secret|passport|nin|bvn|licen[cs]e)(?:\s+(?:code|number))?\s*(:|=|\bis\b)\s*(\S+)/gi;
const sensitiveValue =
  /\b(?:otp|code|password|token|secret|passport|nin|bvn|licen[cs]e)(?:\s+(?:code|number))?\s+(?:is\s+)?([a-z0-9_/-]+)/gi;
const narrativeWords = new Set([
  "inspected",
  "checked",
  "unavailable",
  "available",
  "supplied",
  "presented",
  "received",
  "sent",
  "expired",
  "lost",
  "forgotten",
  "reset",
  "verification",
  "cannot",
  "could",
  "can",
  "not",
  "was",
  "has",
  "had",
  "in",
  "at",
  "for",
  "by",
  "from",
  "to",
  "access",
]);
export const recoveryText = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((v) => {
    if (
      /(?:https?:\/\/|@|\d[\d ()+-]{4,}\d|\b[a-f0-9]{32,}\b|\b[A-Z]{1,3}\d{4,}\b)/i.test(
        v,
      ) ||
      [...v.matchAll(sensitiveAssignment)].some(
        (match) =>
          match[1]!.toLowerCase() !== "is" ||
          !narrativeWords.has(match[2]!.toLowerCase().replace(/[.,;!?]+$/, "")),
      )
    )
      return false;
    return [...v.matchAll(sensitiveValue)].every((match) =>
      narrativeWords.has(match[1]!.toLowerCase()),
    );
  }, "Invalid narrative");
const mutation = z.object({ operationId: authId, expectedVersion: version });
export const phoneChangeSchema = mutation
  .extend({
    newPhone: z.string().min(1).max(32),
    activeCardCode: cardCode,
    expectedCardVersion: version,
    cardInspectedInPerson: z.literal(true),
    reason: recoveryText,
  })
  .strict();
export const issueCardVerificationSchema = mutation.strict();
export const verifyCardSchema = mutation
  .extend({
    expectedChallengeVersion: version,
    code: z.string().min(1).max(256),
  })
  .strict();
export const replaceCardSchema = mutation
  .extend({
    expectedOldCardVersion: version,
    challengeId: authId,
    expectedChallengeVersion: version,
    newCardCode: cardCode,
    reason: recoveryText,
  })
  .strict();
export const managerCaseSchema = mutation
  .extend({
    customerPresent: z.literal(true),
    reason: recoveryText,
    verificationNotes: recoveryText,
  })
  .strict();
export const recoveryContextSchema = z
  .object({
    customerId: authId,
    customerVersion: version,
    phoneMasked: z.string(),
    activeCard: z
      .object({ id: authId, code: cardCode, version })
      .strict()
      .nullable(),
  })
  .strict();
export const phoneChallengeSchema = z
  .object({
    id: authId,
    customerId: authId,
    version,
    expiresAt: z.string().datetime(),
    resendAfter: z.string().datetime(),
    state: z.enum([
      "delivery_pending",
      "sent",
      "failed",
      "verified",
      "consumed",
      "expired",
      "revoked",
    ]),
    registeredPhoneMasked: z.string(),
    verifiedAt: z.string().datetime().nullable(),
  })
  .strict();
export const identityChangeSchema = z
  .object({
    id: authId,
    operationId: authId,
    customerId: authId,
    customerVersion: version,
    kind: z.enum(["phone_change", "card_replacement"]),
    oldPhoneMasked: z.string().nullable(),
    newPhoneMasked: z.string().nullable(),
    oldCardCode: cardCode.nullable(),
    newCardCode: cardCode.nullable(),
    verification: z.enum(["card_present", "registered_phone_code"]),
    actor: actorSchema,
    reason: recoveryText,
    appliedAt: z.string().datetime(),
    auditEventId: authId,
  })
  .strict();
export const managerCaseViewSchema = z
  .object({
    id: authId,
    customerId: authId,
    version,
    state: z.literal("awaiting_policy_and_decision"),
    customerVersionAtIntake: version,
    createdBy: actorSchema,
    createdAt: z.string().datetime(),
    customerPresent: z.literal(true),
    reason: recoveryText,
    verificationNotes: recoveryText,
    auditEventId: authId,
  })
  .strict();

import { createHash } from "node:crypto";
import { z } from "zod";
import { meterReleaseArtifact } from "./meter-release.ts";

const id = z.uuid();
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.iso
  .datetime({ offset: true })
  .refine((v) => !/\.\d{7,}/.test(v));
const kobo = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
const quantity = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/)
  .refine((v) => /[1-9]/.test(v));
export const meterProfileContentSchema = z.strictObject({
  id,
  version,
  stationId: id,
  pumpId: id,
  productId: id,
  currency: z.literal("NGN"),
  unit: z.enum(["litre", "kilogram"]),
  quantityPrecision: z.number().int().min(0).max(6),
  validFrom: instant,
  validUntil: instant.nullable(),
  amountStepKobo: kobo,
  quantityStep: quantity,
  displayModel: z.literal("common_sale_nearest_steps"),
  verificationReference: id,
});
export const meterVerificationContentSchema = z.strictObject({
  profileContent: meterProfileContentSchema,
  measuredMeterIdentity: z.string().trim().min(1).max(120),
  measurementReference: id,
  verificationNotes: z.string().trim().min(1).max(1000),
});
export const meterProfileSchema = meterProfileContentSchema
  .extend({ digest, approvalReference: id })
  .superRefine((p, ctx) => {
    if ((p.quantityStep.split(".")[1]?.length ?? 0) > p.quantityPrecision)
      ctx.addIssue({ code: "custom", message: "Incompatible step precision" });
    // Comparison retains sub-millisecond precision rather than rounding through Date.
    if (
      p.validUntil !== null &&
      instantMicros(p.validUntil) <= instantMicros(p.validFrom)
    )
      ctx.addIssue({ code: "custom", message: "Invalid applicability" });
  });
export function instantMicros(value: string): bigint {
  const m = /^(.*?)(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value)!;
  return (
    BigInt(Date.parse(m[1]! + m[3]!)) * 1000n +
    BigInt((m[2] ?? "").padEnd(6, "0"))
  );
}
export const meterPolicySchema = z
  .strictObject({
    release: z.literal("meter-reconciliation-v1"),
    digest,
    revision: version,
    scope: z.strictObject({
      stationId: id,
      environment: z.enum(["development", "test", "staging", "production"]),
    }),
    resolver: z.strictObject({
      release: z.literal("review-evidence-v1"),
      digest,
    }),
    profiles: z.array(meterProfileSchema).min(1).max(1000),
    activation: z.discriminatedUnion("state", [
      z.strictObject({
        state: z.literal("inactive"),
        approvalReference: z.null(),
        activatedAt: z.null(),
      }),
      z.strictObject({
        state: z.literal("active"),
        approvalReference: id,
        activatedAt: instant,
      }),
    ]),
  })
  .superRefine((p, ctx) => {
    const identities = new Set<string>();
    for (const profile of p.profiles) {
      const key = `${profile.id}:${profile.version}`;
      if (
        identities.has(key) ||
        profile.stationId !== p.scope.stationId ||
        profile.digest !== profileDigest(profile)
      )
        ctx.addIssue({ code: "custom", message: "Invalid profile binding" });
      identities.add(key);
    }
    for (let i = 0; i < p.profiles.length; i++)
      for (let j = i + 1; j < p.profiles.length; j++) {
        const a = p.profiles[i]!,
          b = p.profiles[j]!;
        if (
          a.pumpId === b.pumpId &&
          a.productId === b.productId &&
          a.currency === b.currency &&
          a.unit === b.unit &&
          a.quantityPrecision === b.quantityPrecision &&
          (a.validUntil === null ||
            instantMicros(b.validFrom) < instantMicros(a.validUntil)) &&
          (b.validUntil === null ||
            instantMicros(a.validFrom) < instantMicros(b.validUntil))
        )
          ctx.addIssue({ code: "custom", message: "Overlapping profiles" });
      }
  });
export type MeterProfile = z.infer<typeof meterProfileSchema>;
export type MeterPolicy = z.infer<typeof meterPolicySchema>;
export function canonical(value: unknown): string {
  function sorted(v: unknown): unknown {
    return Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, sorted(x)]),
          )
        : v;
  }
  return JSON.stringify(sorted(value));
}
export function profileContent(profile: MeterProfile) {
  return meterProfileContentSchema.parse(
    Object.fromEntries(
      Object.entries(profile).filter(
        ([k]) => k !== "digest" && k !== "approvalReference",
      ),
    ),
  );
}
export function profileDigest(profile: MeterProfile): string {
  return createHash("sha256")
    .update(canonical(profileContent(profile)))
    .digest("hex");
}
export const meterReleaseDigest = createHash("sha256")
  .update(meterReleaseArtifact, "utf8")
  .digest("hex");

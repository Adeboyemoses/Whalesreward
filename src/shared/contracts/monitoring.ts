import { z } from "zod";
const policyStatus = z.enum(["configured", "unconfigured"]);
const policies = z
  .object({
    auth: policyStatus,
    delivery: policyStatus,
    delegation: policyStatus,
    phone: policyStatus,
    meter: policyStatus,
    phoneVerification: policyStatus,
    recovery: policyStatus,
    reconciliation: policyStatus,
    timing: policyStatus,
    cardPrint: policyStatus,
    duplicateWindow: policyStatus,
    reviewEvidence: policyStatus,
  })
  .strict();
const checks = {
  policies,
  missingPolicies: z.array(
    z.enum([
      "auth",
      "delivery",
      "delegation",
      "phone",
      "meter",
      "phoneVerification",
      "recovery",
      "reconciliation",
      "timing",
      "cardPrint",
      "duplicateWindow",
      "reviewEvidence",
    ]),
  ),
  lookupReceiptIssuance: policyStatus,
};
const count = z.number().int().nonnegative().safe();
const queue = z.object({ count, oldestAgeSeconds: count }).strict();
const instant = z.iso.datetime().nullable();
export const deployCheckSchema = z
  .object({ ...checks, ready: z.boolean() })
  .strict();
export const monitoringSchema = z
  .object({
    ...checks,
    observedAt: z.iso.datetime(),
    jobs: z.array(
      z
        .object({
          job: z.enum(["orphans", "reconcile-uploads"]),
          outcome: z.enum([
            "running",
            "continued",
            "succeeded",
            "failed",
            "never_run",
          ]),
          heartbeatAt: instant,
          nextDueAt: instant,
          completionDeadline: instant,
          lastCompleteWatermark: instant,
          lastSucceededAt: instant,
          errorCode: z
            .enum(["database_unavailable", "storage_unavailable"])
            .nullable(),
          counts: z.record(z.string(), count),
          alerts: z.array(
            z.enum([
              "missing_heartbeat",
              "failed_run",
              "stale_lease",
              "completion_overdue",
              "stale_heartbeat",
              "missed_schedule",
            ]),
          ),
        })
        .strict(),
    ),
    queues: z
      .object({
        pendingUploads: queue,
        corrections: queue,
        holds: queue,
        duplicates: queue,
        proposals: queue,
        pendingMail: queue,
        failedMail: queue,
      })
      .strict(),
    api: z
      .object({
        requests: count,
        serverErrors: count,
        throttled: count,
        alert: z.boolean(),
        scope: z.literal("process"),
        windowSeconds: z.literal(300),
      })
      .strict(),
  })
  .strict();
export type OperationalMonitoring = z.infer<typeof monitoringSchema>;

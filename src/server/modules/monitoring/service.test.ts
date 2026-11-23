import { expect, it } from "vitest";
import { jobSignal } from "./service";
const now = new Date("2026-11-23T12:00:00Z");
it("missing job records alert even though no failed process exists", () => {
  expect(jobSignal("orphans", undefined, now)).toMatchObject({
    job: "orphans",
    alerts: ["missing_heartbeat"],
    counts: {},
  });
});
it("reports failed, expired and missed completion signals without private run contents", () => {
  const signal = jobSignal(
    "reconcile-uploads",
    {
      heartbeat_at: new Date(now.getTime() - 120000),
      next_due_at: new Date(now.getTime() - 1000),
      lease_until: new Date(now.getTime() - 5000),
      completion_deadline: new Date(now.getTime() - 1000),
      last_outcome: "running",
      outcome: { scanned: 4, findings: 2, phone: "08012345678" },
      error_code: "raw-private-error",
      cursor: "private",
      storage_identity: "private",
    },
    now,
  );
  expect(signal.alerts).toEqual([
    "stale_lease",
    "completion_overdue",
    "stale_heartbeat",
  ]);
  expect(signal.counts).toEqual({ scanned: 4, findings: 2 });
  expect(JSON.stringify(signal)).not.toMatch(/private|08012345678/);
});
it("successful job becomes overdue at next due plus bounded slice, never before it", () => {
  const row = {
    last_outcome: "succeeded",
    next_due_at: new Date(now.getTime() - 600000),
    heartbeat_at: now,
  };
  expect(jobSignal("orphans", row, now).alerts).toEqual([]);
  expect(
    jobSignal("orphans", row, new Date(now.getTime() + 1)).alerts,
  ).toContain("missed_schedule");
});

it("a failed run never becomes healthy from an earlier complete watermark and malformed counts are omitted", () => {
  const result = jobSignal(
    "orphans",
    {
      last_outcome: "failed",
      heartbeat_at: now,
      last_complete_watermark: now,
      outcome: {
        scanned: 4,
        findings: "08012345678",
        missingObject: -1,
        digestMismatch: Infinity,
        unknown: 5,
      },
    },
    now,
  );
  expect(result.alerts).toContain("failed_run");
  expect(result.lastCompleteWatermark).toBe(now.toISOString());
  expect(result.counts).toEqual({ scanned: 4 });
});

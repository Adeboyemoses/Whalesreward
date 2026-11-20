import type pg from "pg";
import type { MaintenanceStorage } from "../../adapters/maintenance-storage.ts";
import { claimRun, commitPage, releaseRun, runCounts } from "./repo.ts";
import { orphanPage, reconciliationPage } from "./inventory.ts";
import {
  MaintenanceError,
  maintenanceLimits,
  checkpointReserveMs,
  type Counts,
  type Limits,
  type MaintenanceJob,
} from "./types.ts";
export type MaintenanceResult = {
  runId: string | null;
  status: "busy" | "continued" | "succeeded" | "failed";
  counts: Counts;
};
export async function runMaintenance(input: {
  pool: pg.Pool;
  storage: MaintenanceStorage;
  job: MaintenanceJob;
  limits?: Partial<Limits>;
  signal?: AbortSignal;
}): Promise<MaintenanceResult> {
  const limits = maintenanceLimits(input.limits);
  const lease = await claimRun(
    input.pool,
    input.job,
    limits,
    input.storage.identity ?? "fixture",
  );
  if (!lease) return { runId: null, status: "busy", counts: {} };
  let complete = false;
  try {
    // A fetched logical page is checkpointed at each completed object. This
    // keeps slow, successful reads from losing an entire page on restart.
    const unitLimits = { ...limits, pageSize: 1 };
    for (let n = 0; n < limits.maxPages * limits.pageSize; n++) {
      const remaining = lease.deadline.getTime() - Date.now();
      if (remaining <= checkpointReserveMs(limits)) break;
      const signal = AbortSignal.any([
        AbortSignal.timeout(remaining - checkpointReserveMs(limits)),
        ...(input.signal ? [input.signal] : []),
      ]);
      const page = await (
        input.job === "orphans" ? orphanPage : reconciliationPage
      )(input.pool, input.storage, lease, unitLimits, signal);
      await commitPage(input.pool, lease, page, limits);
      complete = page.complete;
      if (complete) break;
    }
    if (!complete) await releaseRun(input.pool, lease);
    return {
      runId: lease.runId,
      status: complete ? "succeeded" : "continued",
      counts: await runCounts(input.pool, lease.runId),
    };
  } catch (error) {
    if (
      error instanceof MaintenanceError &&
      error.code === "budget_exhausted"
    ) {
      await releaseRun(input.pool, lease).catch(() => {});
      return {
        runId: lease.runId,
        status: "continued",
        counts: await runCounts(input.pool, lease.runId),
      };
    }
    if (error instanceof MaintenanceError && error.code === "lease_lost")
      return { runId: lease.runId, status: "busy", counts: {} };
    const code =
      error instanceof MaintenanceError && error.code === "database_unavailable"
        ? "database_unavailable"
        : "storage_unavailable";
    await releaseRun(input.pool, lease, code).catch(() => {});
    return {
      runId: lease.runId,
      status: "failed",
      counts: await runCounts(input.pool, lease.runId).catch(() => ({})),
    };
  }
}

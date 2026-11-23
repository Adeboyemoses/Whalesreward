import type pg from "pg";
import { getHealth } from "../health/service";
import { countNames, type MaintenanceJob } from "../maintenance/types";
import { lookupReceiptConfig } from "../sync/lookup-receipt";
import {
  requireAdminSession,
  requirePermission,
  securityLock,
} from "../../lib/authz";
import { transaction } from "../../lib/transaction";
import { adminSessionConfig, requirePolicy } from "../admin-access/config";
import { AuthError } from "../auth/errors";
import { operationalTelemetry } from "./telemetry";

type JobRow = Record<string, unknown>;
function date(value: unknown) {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value
    : null;
}
const iso = (value: unknown) => date(value)?.toISOString() ?? null;
export function jobSignal(
  job: MaintenanceJob,
  row: JobRow | undefined,
  now: Date,
) {
  const alerts: string[] = [];
  const counts: Record<string, number> = {};
  if (!row) alerts.push("missing_heartbeat");
  else {
    if (row.last_outcome === "failed") alerts.push("failed_run");
    if (
      row.last_outcome === "running" &&
      date(row.lease_until) &&
      date(row.lease_until)!.getTime() <= now.getTime()
    )
      alerts.push("stale_lease");
    if (
      row.last_outcome === "running" &&
      date(row.completion_deadline) &&
      date(row.completion_deadline)!.getTime() < now.getTime()
    )
      alerts.push("completion_overdue");
    if (!date(row.heartbeat_at)) alerts.push("missing_heartbeat");
    else if (
      row.last_outcome === "running" &&
      now.getTime() - date(row.heartbeat_at)!.getTime() > 60000
    )
      alerts.push("stale_heartbeat");
    if (
      row.last_outcome !== "running" &&
      date(row.next_due_at) &&
      now.getTime() > date(row.next_due_at)!.getTime() + 600000
    )
      alerts.push("missed_schedule");
    const raw =
      row.outcome && typeof row.outcome === "object"
        ? (row.outcome as Record<string, unknown>)
        : {};
    for (const key of countNames)
      if (
        typeof raw[key] === "number" &&
        Number.isSafeInteger(raw[key]) &&
        raw[key] >= 0
      )
        counts[key] = raw[key];
  }
  return {
    job,
    outcome: ["running", "continued", "succeeded", "failed"].includes(
      String(row?.last_outcome),
    )
      ? (row!.last_outcome as string)
      : "never_run",
    heartbeatAt: iso(row?.heartbeat_at),
    nextDueAt: iso(row?.next_due_at),
    completionDeadline: iso(row?.completion_deadline),
    lastCompleteWatermark: iso(row?.last_complete_watermark),
    lastSucceededAt: iso(row?.last_succeeded_at),
    errorCode: ["database_unavailable", "storage_unavailable"].includes(
      String(row?.error_code),
    )
      ? (row!.error_code as string)
      : null,
    counts,
    alerts,
  };
}
export async function readMonitoring(
  pool: pg.Pool,
  token: string | undefined,
  deployCheck = false,
) {
  requirePolicy(adminSessionConfig());
  // Authorize before configuration/database work and again under the security lock
  // immediately before returning data. A revoked grant never exposes diagnostics.
  const authorize = async (db: pg.PoolClient) => {
    await securityLock(db);
    const actor = await requireAdminSession(db, token);
    requirePermission(actor, "settings");
  };
  await transaction(pool, async (db) => {
    await db.query("SET LOCAL statement_timeout='1500ms'");
    await authorize(db);
  });
  const health = await getHealth(
    async () => {
      await pool.query("SELECT 1");
    },
    async () => true,
    pool,
  );
  if (!health.ok || !health.policies)
    throw new AuthError("temporarily_unavailable", 503);
  const ring = lookupReceiptConfig();
  return transaction(pool, async (db) => {
    await db.query("SET LOCAL statement_timeout='1500ms'");
    await db.query("SET LOCAL lock_timeout='1000ms'");
    await authorize(db);
    const missingPolicies = Object.entries(health.policies!)
      .filter(([, status]) => status === "unconfigured")
      .map(([name]) => name);
    const checks = {
      policies: health.policies!,
      missingPolicies,
      lookupReceiptIssuance: ring.activeKid
        ? ("configured" as const)
        : ("unconfigured" as const),
    };
    if (deployCheck)
      return {
        ...checks,
        ready: missingPolicies.length === 0 && !!ring.activeKid,
      };
    const rows = (
      await db.query(
        `SELECT j.job,j.heartbeat_at,j.next_due_at,j.completion_deadline,j.last_complete_watermark,j.last_succeeded_at,j.last_outcome,j.error_code,j.lease_until,r.outcome FROM maintenance_job j LEFT JOIN maintenance_run r ON r.id=j.run_id WHERE j.scope='primary' ORDER BY j.job`,
      )
    ).rows;
    const now = (
      await db.query<{ now: Date }>("SELECT clock_timestamp() AS now")
    ).rows[0]!.now;
    // Counts and ages only. No person/record IDs, payloads, cursors or reasons cross this boundary.
    const backlog = (
      await db.query(`WITH work AS (
      SELECT 'pendingUploads' AS kind,server_received_at AS opened FROM purchase WHERE status IN ('received','photo_pending','finalizing')
      UNION ALL SELECT 'corrections',first_received_at FROM correction_request WHERE state IN ('pending_validation','awaiting_review')
      UNION ALL SELECT 'holds',created_at FROM purchase_hold WHERE state='open'
      UNION ALL SELECT 'duplicates',created_at FROM duplicate_flag WHERE state='open'
      UNION ALL SELECT 'proposals',p.proposed_at FROM held_release_proposal p JOIN held_release_state s ON s.proposal_id=p.id WHERE s.state='pending'
      UNION ALL SELECT 'pendingMail',created_at FROM mail_request WHERE status IN ('pending','sending')
      UNION ALL SELECT 'failedMail',created_at FROM mail_request WHERE status='failed'
    ) SELECT kind,count(*)::text AS count, greatest(0,extract(epoch FROM (clock_timestamp()-min(opened))))::double precision AS age FROM work GROUP BY kind`)
    ).rows;
    const names = [
      "pendingUploads",
      "corrections",
      "holds",
      "duplicates",
      "proposals",
      "pendingMail",
      "failedMail",
    ];
    const queues = Object.fromEntries(
      names.map((name) => {
        const r = backlog.find((r) => r.kind === name);
        return [
          name,
          {
            count: r ? Number(r.count) : 0,
            oldestAgeSeconds: r ? Math.floor(r.age) : 0,
          },
        ];
      }),
    );
    return {
      ...checks,
      observedAt: now.toISOString(),
      jobs: (["orphans", "reconcile-uploads"] as const).map((job) =>
        jobSignal(
          job,
          rows.find((r) => r.job === job),
          now,
        ),
      ),
      queues,
      api: {
        ...operationalTelemetry.snapshot(),
        scope: "process",
        windowSeconds: 300,
      },
    };
  });
}

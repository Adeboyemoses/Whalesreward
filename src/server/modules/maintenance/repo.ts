import type pg from "pg";
import { newId } from "../../lib/ids.ts";
import {
  countNames,
  MaintenanceError,
  scheduleMs,
  type Counts,
  type Cursor,
  type Lease,
  type Limits,
  type MaintenanceJob,
  type Page,
} from "./types.ts";

async function transaction<T>(
  pool: pg.Pool,
  operation: (db: pg.PoolClient) => Promise<T>,
  readOnly = false,
): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query(readOnly ? "BEGIN READ ONLY" : "BEGIN");
    await db.query("SET LOCAL statement_timeout='5s'");
    await db.query("SET LOCAL lock_timeout='3s'");
    await db.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
    const result = await operation(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    if (error instanceof MaintenanceError) throw error;
    throw new MaintenanceError("database_unavailable");
  } finally {
    db.release();
  }
}
export const evidenceRead = <T>(
  pool: pg.Pool,
  operation: (db: pg.PoolClient) => Promise<T>,
) => transaction(pool, operation, true);
/** Runtime must not possess a latent business-write authority, including through PUBLIC/membership. */
async function assertRole(db: pg.PoolClient) {
  const unsafe = (
    await db.query<{ unsafe: boolean }>(`SELECT
    (SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls FROM pg_roles WHERE rolname=current_user)
    OR has_schema_privilege(current_user,current_schema(),'CREATE')
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relkind IN ('r','p')
      AND c.relname NOT IN ('maintenance_run','maintenance_job','maintenance_object','maintenance_page','maintenance_finding')
      AND (has_table_privilege(current_user,c.oid,'INSERT') OR has_table_privilege(current_user,c.oid,'UPDATE')
        OR has_table_privilege(current_user,c.oid,'DELETE') OR has_table_privilege(current_user,c.oid,'TRUNCATE')
        OR has_any_column_privilege(current_user,c.oid,'INSERT') OR has_any_column_privilege(current_user,c.oid,'UPDATE')))
    AS unsafe`)
  ).rows[0]?.unsafe;
  if (unsafe !== false) throw new MaintenanceError("unsafe_database_role");
}
export async function claimRun(
  pool: pg.Pool,
  job: MaintenanceJob,
  limits: Limits,
  storageIdentity = "fixture",
): Promise<Lease | undefined> {
  if (job !== "orphans" && job !== "reconcile-uploads")
    throw new MaintenanceError("invalid_configuration");
  return transaction(pool, async (db) => {
    await assertRole(db);
    await db.query(
      "INSERT INTO maintenance_job(job,scope) VALUES($1,'primary') ON CONFLICT DO NOTHING",
      [job],
    );
    const control = (
      await db.query(
        `SELECT *,lease_until>clock_timestamp() AS busy,next_due_at>clock_timestamp() AS early FROM maintenance_job WHERE job=$1 AND scope='primary' FOR UPDATE`,
        [job],
      )
    ).rows[0]!;
    if (control.busy || control.early) return undefined;
    let run = control.run_id
      ? (
          await db.query(
            "SELECT * FROM maintenance_run WHERE id=$1 FOR UPDATE",
            [control.run_id],
          )
        ).rows[0]
      : undefined;
    if (
      run &&
      run.status !== "succeeded" &&
      run.storage_identity !== storageIdentity
    )
      throw new MaintenanceError("invalid_configuration");
    if (!run || run.status === "succeeded") {
      const cursor: Cursor = {
        phase: job === "orphans" ? "staging" : "expected",
        provider: null,
        after: null,
      };
      run = (
        await db.query(
          `INSERT INTO maintenance_run(id,job,deduplication_key,status,cursor,fencing_version,attempts,started_at,outcome,storage_identity)
        VALUES($1::uuid,$2,$1::text,'pending',$3,0,0,clock_timestamp(),'{}',$4) RETURNING *`,
          [newId(), job, JSON.stringify(cursor), storageIdentity],
        )
      ).rows[0]!;
    }
    const owner = newId();
    const state = (
      await db.query(
        `UPDATE maintenance_job SET run_id=$2,lease_owner=$3,lease_until=clock_timestamp()+$4*interval '1 millisecond',
      fencing_version=fencing_version+1,heartbeat_at=clock_timestamp(),completion_deadline=clock_timestamp()+$5*interval '1 millisecond',
      last_outcome='running',error_code=NULL WHERE job=$1 AND scope='primary' RETURNING *`,
        [job, run.id, owner, limits.leaseMs, limits.sliceMs],
      )
    ).rows[0]!;
    await db.query(
      `UPDATE maintenance_run SET status='running',lease_owner=$2,lease_until=$3,fencing_version=$4,attempts=attempts+1,
      heartbeat_at=$5,completion_deadline=$6,error_code=NULL WHERE id=$1`,
      [
        run.id,
        owner,
        state.lease_until,
        state.fencing_version,
        state.heartbeat_at,
        state.completion_deadline,
      ],
    );
    return {
      runId: run.id,
      owner,
      fence: state.fencing_version,
      cutoff: run.started_at,
      cursor: run.cursor,
      pageNo: run.page_no,
      deadline: state.completion_deadline,
      expiresAt: state.lease_until,
      job,
    };
  });
}
async function fenced(db: pg.PoolClient, lease: Lease) {
  const row = (
    await db.query(
      `SELECT run_id FROM maintenance_job WHERE job=$1 AND scope='primary' AND run_id=$2
    AND lease_owner=$3 AND fencing_version=$4 AND lease_until>clock_timestamp() AND completion_deadline>clock_timestamp() FOR UPDATE`,
      [lease.job, lease.runId, lease.owner, lease.fence],
    )
  ).rows[0];
  if (!row) throw new MaintenanceError("lease_lost");
  const run = (
    await db.query(
      "SELECT outcome,page_no FROM maintenance_run WHERE id=$1 FOR UPDATE",
      [lease.runId],
    )
  ).rows[0]!;
  if (run.page_no !== lease.pageNo) throw new MaintenanceError("lease_lost");
  return run;
}
function checkedCounts(counts: Counts): Counts {
  const result: Counts = {};
  for (const key of countNames) {
    const value = counts[key] ?? 0;
    if (!Number.isSafeInteger(value) || value < 0)
      throw new MaintenanceError("invalid_configuration");
    result[key] = value;
  }
  if (
    Object.keys(counts).some(
      (k) => !countNames.includes(k as (typeof countNames)[number]),
    )
  )
    throw new MaintenanceError("invalid_configuration");
  return result;
}
export async function commitPage(
  pool: pg.Pool,
  lease: Lease,
  page: Page,
  limits: Limits,
): Promise<void> {
  const renewedUntil = await transaction(pool, async (db) => {
    const run = await fenced(db, lease);
    const counts = checkedCounts(page.counts),
      totals = checkedCounts(run.outcome ?? {});
    if (page.findings.length > limits.pageSize * 12)
      throw new MaintenanceError("invalid_configuration");
    await db.query(
      "INSERT INTO maintenance_page(id,run_id,page_no,counts) VALUES($1,$2,$3,$4)",
      [newId(), lease.runId, lease.pageNo, JSON.stringify(counts)],
    );
    for (const [ordinal, f] of page.findings.entries()) {
      let objectId: string | null = null;
      if (f.object) {
        if (
          f.object.key.length > 1024 ||
          (f.object.versionId?.length ?? 0) > 2048
        )
          throw new MaintenanceError("invalid_configuration");
        await db.query(
          "INSERT INTO maintenance_object(id,object_key,version_id) VALUES($1,$2,$3) ON CONFLICT(object_key,version_id) DO NOTHING",
          [newId(), f.object.key, f.object.versionId ?? ""],
        );
        objectId = (
          await db.query(
            "SELECT id FROM maintenance_object WHERE object_key=$1 AND version_id=$2",
            [f.object.key, f.object.versionId ?? ""],
          )
        ).rows[0]!.id;
      }
      await db.query(
        `INSERT INTO maintenance_finding(id,run_id,page_no,ordinal,code,object_id,asset_id,purchase_id,reference_ids) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          newId(),
          lease.runId,
          lease.pageNo,
          ordinal,
          f.code,
          objectId,
          f.assetId ?? null,
          f.purchaseId ?? null,
          f.referenceIds ?? [],
        ],
      );
    }
    for (const key of countNames) totals[key] = totals[key]! + counts[key]!;
    checkedCounts(totals);
    // A slow page transaction may itself outlive the lease. Roll the entire
    // append/checkpoint back rather than renewing authority after its expiry.
    await fenced(db, lease);
    await db.query(
      `UPDATE maintenance_run SET cursor=$2,page_no=page_no+1,outcome=$3,heartbeat_at=clock_timestamp(),
      lease_until=least(completion_deadline,clock_timestamp()+$4*interval '1 millisecond'),
      status=CASE WHEN $5 THEN 'succeeded' ELSE 'running' END,
      completed_at=CASE WHEN $5 THEN clock_timestamp() ELSE NULL END,
      watermark=CASE WHEN $5 THEN started_at ELSE watermark END WHERE id=$1`,
      [
        lease.runId,
        JSON.stringify(page.cursor),
        JSON.stringify(totals),
        limits.leaseMs,
        page.complete,
      ],
    );
    const updated = await db.query<{ lease_until: Date | null }>(
      `UPDATE maintenance_job SET heartbeat_at=clock_timestamp(),
      lease_until=CASE WHEN $3 THEN NULL ELSE least(completion_deadline,clock_timestamp()+$4*interval '1 millisecond') END,
      lease_owner=CASE WHEN $3 THEN NULL ELSE lease_owner END,
      next_due_at=CASE WHEN $3 THEN clock_timestamp()+$5*interval '1 millisecond' ELSE next_due_at END,
      last_complete_watermark=CASE WHEN $3 THEN $6 ELSE last_complete_watermark END,
      last_succeeded_at=CASE WHEN $3 THEN clock_timestamp() ELSE last_succeeded_at END,
      last_outcome=CASE WHEN $3 THEN 'succeeded' ELSE 'running' END WHERE job=$1 AND run_id=$2 RETURNING lease_until`,
      [
        lease.job,
        lease.runId,
        page.complete,
        limits.leaseMs,
        scheduleMs(lease.job),
        lease.cutoff,
      ],
    );
    return updated.rows[0]!.lease_until;
  });
  if (renewedUntil) lease.expiresAt = renewedUntil;
  lease.cursor = page.cursor;
  lease.pageNo++;
}
export async function releaseRun(
  pool: pg.Pool,
  lease: Lease,
  error?: "storage_unavailable" | "database_unavailable",
) {
  await transaction(pool, async (db) => {
    await fenced(db, lease);
    await db.query(
      `UPDATE maintenance_job SET lease_owner=NULL,lease_until=NULL,heartbeat_at=clock_timestamp(),
      last_outcome=$3,error_code=$4,next_due_at=clock_timestamp()+$5*interval '1 millisecond' WHERE job=$1 AND run_id=$2`,
      [
        lease.job,
        lease.runId,
        error ? "failed" : "continued",
        error ?? null,
        error ? 15000 : 0,
      ],
    );
    await db.query(
      `UPDATE maintenance_run SET status=$2,lease_owner=NULL,lease_until=NULL,heartbeat_at=clock_timestamp(),error_code=$3,
      next_attempt_at=clock_timestamp()+$4*interval '1 millisecond' WHERE id=$1`,
      [
        lease.runId,
        error ? "failed" : "pending",
        error ?? null,
        error ? 15000 : 0,
      ],
    );
  });
}
export async function runCounts(pool: pg.Pool, runId: string): Promise<Counts> {
  return evidenceRead(pool, async (db) =>
    checkedCounts(
      (
        await db.query("SELECT outcome FROM maintenance_run WHERE id=$1", [
          runId,
        ])
      ).rows[0]?.outcome ?? {},
    ),
  );
}

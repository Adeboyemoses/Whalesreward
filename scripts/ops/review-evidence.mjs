import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { v7 as newId } from "uuid";
import { z } from "zod";
import {
  writeAudit,
  auditSystem,
} from "../../src/server/modules/audit/write.ts";
import { reviewEvidenceReleaseArtifact } from "../../src/server/modules/reviews/release.ts";

export const releaseDigest = createHash("sha256")
  .update(reviewEvidenceReleaseArtifact, "utf8")
  .digest("hex");
export const usage = `Usage: pnpm ops:review-evidence activate|deactivate
  --station UUID --environment development|test|staging|production
  --digest SHA256 --authorization REFERENCE
  [--activated-at ISO_INSTANT (activate only)] [--dry-run | --apply --expected-revision N]
Default: dry run. DATABASE_URL must already be set in your shell; never pass it as an argument.`;

class OperatorError extends Error {}
const inputSchema = z.strictObject({
  action: z.enum(["activate", "deactivate"]),
  stationId: z.uuid().transform((value) => value.toLowerCase()),
  environment: z.enum(["development", "test", "staging", "production"]),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  authorizationReference: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/),
  activatedAt: z.iso
    .datetime({ offset: true })
    .refine((value) => !/\.\d{7,}/.test(value))
    .nullable(),
  apply: z.boolean(),
  expectedRevision: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable(),
});

/** @param {string[]} args */
export function parseArguments(args) {
  const [action, ...flags] = args;
  const values = new Map();
  const valued = new Set([
    "--station",
    "--environment",
    "--digest",
    "--authorization",
    "--activated-at",
    "--expected-revision",
  ]);
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (values.has(flag))
      throw new OperatorError("Duplicate argument. Use --help.");
    if (flag === "--apply" || flag === "--dry-run") values.set(flag, true);
    else if (valued.has(flag) && flags[i + 1] && !flags[i + 1].startsWith("--"))
      values.set(flag, flags[++i]);
    else throw new OperatorError("Invalid argument. Use --help.");
  }
  if (values.has("--apply") && values.has("--dry-run"))
    throw new OperatorError("Choose either --apply or --dry-run.");
  const expected = values.get("--expected-revision");
  if (expected !== undefined && !/^[1-9][0-9]*$/.test(expected))
    throw new OperatorError("Invalid expected revision.");
  const parsed = inputSchema.safeParse({
    action,
    stationId: values.get("--station"),
    environment: values.get("--environment"),
    digest: values.get("--digest"),
    authorizationReference: values.get("--authorization"),
    activatedAt: values.get("--activated-at") ?? null,
    apply: values.has("--apply"),
    expectedRevision: expected === undefined ? null : Number(expected),
  });
  if (
    !parsed.success ||
    (action === "activate") !== values.has("--activated-at") ||
    (values.has("--apply") && expected === undefined)
  )
    throw new OperatorError(
      "Invalid or missing input. Authorization must be a non-secret reference ID. Use --help.",
    );
  if (parsed.data.digest !== releaseDigest)
    throw new OperatorError(
      "Release digest does not match the built-in artifact.",
    );
  return parsed.data;
}

/**
 * WHR-116: only Earl's persisted database-level setting establishes identity.
 * current_setting() is unsafe here: session, startup and role options override it.
 * @param {Pick<import('pg').PoolClient, 'query'>} db
 * @param {string} environment
 */
export async function checkDatabaseEnvironment(db, environment) {
  const recorded = await db.query(
    `SELECT setting
     FROM pg_catalog.pg_db_role_setting AS settings
     JOIN pg_catalog.pg_database AS database ON database.oid=settings.setdatabase
     CROSS JOIN LATERAL pg_catalog.unnest(settings.setconfig) AS entries(setting)
     WHERE database.datname=pg_catalog.current_database() AND settings.setrole=0
       AND pg_catalog.split_part(setting,'=',1)=$1`,
    ["whr.environment"],
  );
  const expected = `whr.environment=${environment}`;
  if (
    !["development", "test", "staging", "production"].includes(environment) ||
    recorded.rows.length !== 1 ||
    recorded.rows[0].setting !== expected
  )
    throw new OperatorError(
      "Database environment identity is missing, invalid or does not match --environment. Ask Earl to verify the persisted database setting.",
    );
}

/**
 * @param {import('pg').Pool} pool
 * @param {ReturnType<typeof parseArguments>} input
 */
export async function operate(pool, input) {
  // Validate again at this exported boundary, before opening a connection.
  const parsed = inputSchema.safeParse(input);
  if (
    !parsed.success ||
    input.digest !== releaseDigest ||
    (input.action === "activate") !== (input.activatedAt !== null) ||
    (input.apply && input.expectedRevision === null)
  )
    throw new OperatorError("Invalid operator input or release digest.");
  input = parsed.data;
  const db = await pool.connect();
  try {
    await db.query(
      input.apply
        ? "BEGIN ISOLATION LEVEL READ COMMITTED"
        : "BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY",
    );
    await checkDatabaseEnvironment(db, input.environment);
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('review-evidence:'||$1::text||':'||$2::text,0))",
      [input.stationId, input.environment],
    );
    if (
      (await db.query("SELECT id FROM station WHERE id=$1", [input.stationId]))
        .rowCount !== 1
    )
      throw new OperatorError("Station does not exist in this database.");
    const found = await db.query(
      `SELECT coalesce(max(revision),0)::text AS revision FROM (
      SELECT revision FROM review_evidence_configuration WHERE station_id=$1 AND environment=$2
      UNION ALL SELECT revision FROM review_evidence_approval WHERE station_id=$1 AND environment=$2
    ) revisions`,
      [input.stationId, input.environment],
    );
    const next = BigInt(found.rows[0].revision) + 1n;
    if (next > BigInt(Number.MAX_SAFE_INTEGER))
      throw new OperatorError("Configuration revision is exhausted.");
    const revision = Number(next);
    if (input.expectedRevision !== null && input.expectedRevision !== revision)
      throw new OperatorError(
        "Revision changed or does not match the authorized revision. Run a new dry run and obtain matching authorization.",
      );
    const approvalId = input.action === "activate" ? newId() : null;
    const configurationId = newId();
    const policy = {
      release: "review-evidence-v1",
      digest: releaseDigest,
      revision,
      scope: { stationId: input.stationId, environment: input.environment },
      activation: approvalId
        ? {
            state: "active",
            approvalReference: approvalId,
            activatedAt: input.activatedAt,
          }
        : { state: "inactive", approvalReference: null, activatedAt: null },
    };
    const approval = approvalId
      ? {
          id: approvalId,
          release: policy.release,
          digest: policy.digest,
          revision,
          station_id: input.stationId,
          environment: input.environment,
          activated_at: input.activatedAt,
          authorization_reference: input.authorizationReference,
        }
      : null;
    const configuration = {
      id: configurationId,
      station_id: input.stationId,
      environment: input.environment,
      revision,
      configuration: policy,
      authorization_reference: input.authorizationReference,
    };
    if (input.apply) {
      const previous = (
        await db.query(
          "SELECT id,revision,environment,configuration FROM review_evidence_configuration WHERE station_id=$1 AND environment=$2 ORDER BY revision DESC LIMIT 1",
          [input.stationId, input.environment],
        )
      ).rows[0];
      if (approval)
        await db.query(
          "INSERT INTO review_evidence_approval(id,release,digest,revision,station_id,environment,activated_at,authorization_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            approval.id,
            approval.release,
            approval.digest,
            revision,
            input.stationId,
            input.environment,
            input.activatedAt,
            input.authorizationReference,
          ],
        );
      await db.query(
        "INSERT INTO review_evidence_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
        [
          configurationId,
          input.stationId,
          input.environment,
          revision,
          JSON.stringify(policy),
          input.authorizationReference,
        ],
      );
      const configuredEventId = newId(),
        approvedEventId = approval ? newId() : null,
        correlationId = newId();
      const occurredAt = (
        await db.query("SELECT clock_timestamp()::text AS at")
      ).rows[0].at;
      if (approval)
        await writeAudit(db, {
          id: approvedEventId,
          stationId: input.stationId,
          action: "review_evidence_approved",
          actor: auditSystem("operations"),
          target: {
            kind: "review_evidence_approval",
            id: approval.id,
            code: `APPROVAL-${approval.id}`,
            subjectAtEvent: null,
          },
          correlationId,
          relatedEventIds: [configuredEventId],
          occurredAt,
          reason: "Review evidence approved",
          before: null,
          after: {
            approvalId: approval.id,
            policyRelease: policy.release,
            policyRevision: String(revision),
            policyEnvironment: input.environment,
            activatedAt: input.activatedAt,
          },
        });
      const configurationValues = (row) => ({
        configurationId: row.id,
        approvalId: row.configuration.activation.approvalReference,
        policyRelease: row.configuration.release,
        policyRevision: String(row.revision),
        policyEnvironment: row.environment,
        policyState: row.configuration.activation.state,
        activatedAt: row.configuration.activation.activatedAt,
      });
      await writeAudit(db, {
        id: configuredEventId,
        stationId: input.stationId,
        action: approval
          ? "review_evidence_configured"
          : "review_evidence_deactivated",
        actor: auditSystem("operations"),
        target: {
          kind: "review_evidence_configuration",
          id: configurationId,
          code: `CONFIG-${configurationId}`,
          subjectAtEvent: null,
        },
        correlationId,
        relatedEventIds: approvedEventId ? [approvedEventId] : [],
        occurredAt,
        reason: approval
          ? "Review evidence configured"
          : "Review evidence deactivated",
        before: previous ? configurationValues(previous) : null,
        after: configurationValues(configuration),
      });
      await db.query("COMMIT");
    } else await db.query("ROLLBACK");
    return {
      applied: input.apply,
      approval,
      configuration,
      policy,
      applyCommand: `pnpm ops:review-evidence ${input.action} --station ${input.stationId} --environment ${input.environment} --digest ${input.digest} --authorization ${input.authorizationReference}${input.activatedAt ? ` --activated-at ${input.activatedAt}` : ""} --apply --expected-revision ${revision}`,
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

/** @param {Awaited<ReturnType<typeof operate>>} result */
export function formatResult(result) {
  return [
    result.applied
      ? "Applied immutable review-evidence revision."
      : "Dry run: no rows written. Preview IDs and revision are not reserved; use the apply output after writing.",
    "Rows (recorded_at is assigned by PostgreSQL at insertion):",
    JSON.stringify(
      {
        review_evidence_approval: result.approval,
        review_evidence_configuration: result.configuration,
      },
      null,
      2,
    ),
    `WHR_REVIEW_EVIDENCE_POLICY=${JSON.stringify(result.policy)}`,
    result.applied
      ? "Next: set WHR_REVIEW_EVIDENCE_POLICY to the exact JSON above through the approved deployment procedure. Check /api/health while signed in as an admin with settings permission. Active policy is configured only after its activation instant; inactive policy reports unconfigured."
      : "Next: review the preview against Earl's authorization, then rerun with --apply. Only after successful apply, set WHR_REVIEW_EVIDENCE_POLICY from that output and check /api/health as an admin with settings permission.",
    ...(!result.applied ? [`Apply command: ${result.applyCommand}`] : []),
    "This command does not change deployment variables, reevaluate sales, or clear holds.",
  ].join("\n");
}

/** @param {string[]} args */
export async function main(args) {
  if (args.length === 1 && args[0] === "--help") {
    console.log(usage);
    return 0;
  }
  let pool;
  try {
    const input = parseArguments(args);
    if (!process.env.DATABASE_URL)
      throw new OperatorError(
        "DATABASE_URL must be supplied in your own shell.",
      );
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      lock_timeout: 10000,
      idle_in_transaction_session_timeout: 20000,
    });
    // Never attach a raw driver error to output or logs.
    pool.on("error", () => {});
    console.log(formatResult(await operate(pool, input)));
    return 0;
  } catch (error) {
    console.error(
      error instanceof OperatorError
        ? error.message
        : "Review-evidence operation failed. No policy output is available. Check database access and immutable history privately before retrying.",
    );
    return 1;
  } finally {
    await pool?.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.argv.slice(2));

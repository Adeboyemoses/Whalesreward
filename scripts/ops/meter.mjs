import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import pg from "pg";
import { v7 as newId } from "uuid";
import { z } from "zod";
import { checkDatabaseEnvironment } from "./review-evidence.mjs";
import {
  meterPolicySchema,
  meterProfileSchema,
  meterProfileContentSchema,
  meterVerificationContentSchema,
  profileContent,
  profileDigest,
  meterReleaseDigest,
} from "../../src/server/modules/reviews/meter-policy.ts";
import { meterReleaseArtifact } from "../../src/server/modules/reviews/meter-release.ts";
import { reviewEvidenceReleaseArtifact } from "../../src/server/modules/reviews/release.ts";

export const releaseDigest = meterReleaseDigest;
const resolverDigest = createHash("sha256")
  .update(reviewEvidenceReleaseArtifact, "utf8")
  .digest("hex");
const reference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/);
const version = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const inputSchema = z.strictObject({
  action: z.enum(["activate", "deactivate"]),
  stationId: z.uuid(),
  environment: z.enum(["development", "test", "staging", "production"]),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  authorizationReference: reference,
  activatedAt: z.iso
    .datetime({ offset: true })
    .refine((v) => !/\.\d{7,}/.test(v))
    .nullable(),
  bundlePath: z.string().min(1).max(4096).nullable(),
  apply: z.boolean(),
  expectedRevision: version.nullable(),
});
const verificationSchema = z.strictObject({
  id: z.uuid(),
  stationId: z.uuid(),
  content: meterVerificationContentSchema,
  authorizationReference: reference,
});
const approvalSchema = z.strictObject({
  id: z.uuid(),
  stationId: z.uuid(),
  profileId: z.uuid(),
  profileVersion: version,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  profileContent: meterProfileContentSchema,
  authorizationReference: reference,
});
export const bundleSchema = z.strictObject({
  profiles: z.array(meterProfileSchema).min(1).max(1000),
  verifications: z.array(verificationSchema).min(1).max(1000),
  approvals: z.array(approvalSchema).min(1).max(1000),
});
export const usage = `Usage: pnpm ops:meter activate|deactivate
  --station UUID --environment development|test|staging|production
  --digest SHA256 --authorization REFERENCE
  [--bundle APPROVED_JSON_FILE --activated-at ISO_INSTANT (activate only)]
  [--dry-run | --apply --expected-revision N]
Default: dry run. Supply DATABASE_URL in your shell; never as an argument.
Profiles require Q-559 measurements and recorded approval. No defaults are provided.`;
class OperatorError extends Error {}
const canonical = (value) => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sort(value[key])]),
    );
  return value;
}
const equal = (a, b) => canonical(a) === canonical(b);
function checkedInput(input) {
  const p = inputSchema.safeParse(input);
  if (
    !p.success ||
    p.data.digest !== releaseDigest ||
    (p.data.action === "activate") !==
      (p.data.activatedAt !== null && p.data.bundlePath !== null) ||
    (p.data.action === "deactivate" &&
      (p.data.activatedAt !== null || p.data.bundlePath !== null)) ||
    (p.data.apply && p.data.expectedRevision === null)
  )
    throw new OperatorError(
      "Invalid operator input or release digest. Use --help.",
    );
  return p.data;
}
export function parseArguments(args) {
  const [action, ...flags] = args;
  const values = new Map();
  const valued = new Set([
    "--station",
    "--environment",
    "--digest",
    "--authorization",
    "--activated-at",
    "--bundle",
    "--expected-revision",
  ]);
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (values.has(f))
      throw new OperatorError("Duplicate argument. Use --help.");
    if (f === "--apply" || f === "--dry-run") values.set(f, true);
    else if (valued.has(f) && flags[i + 1] && !flags[i + 1].startsWith("--"))
      values.set(f, flags[++i]);
    else throw new OperatorError("Invalid argument. Use --help.");
  }
  if (values.has("--apply") && values.has("--dry-run"))
    throw new OperatorError("Choose dry run or apply.");
  const n = values.get("--expected-revision");
  if (n !== undefined && !/^[1-9][0-9]*$/.test(n))
    throw new OperatorError("Invalid expected revision.");
  return checkedInput({
    action,
    stationId: values.get("--station"),
    environment: values.get("--environment"),
    digest: values.get("--digest"),
    authorizationReference: values.get("--authorization"),
    activatedAt: values.get("--activated-at") ?? null,
    bundlePath: values.get("--bundle") ?? null,
    apply: values.has("--apply"),
    expectedRevision: n === undefined ? null : Number(n),
  });
}
export function validateBundle(value, stationId) {
  const parsed = bundleSchema.safeParse(value);
  if (!parsed.success)
    throw new OperatorError("Invalid approved profile bundle.");
  const bundle = parsed.data;
  if (
    bundle.verifications.length !== bundle.profiles.length ||
    bundle.approvals.length !== bundle.profiles.length ||
    new Set(bundle.verifications.map((v) => v.id)).size !==
      bundle.verifications.length ||
    new Set(bundle.approvals.map((a) => a.id)).size !== bundle.approvals.length
  )
    throw new OperatorError(
      "Bundle must contain exactly one verification and approval for each profile.",
    );
  for (const profile of bundle.profiles) {
    const v = bundle.verifications.find(
      (v) => v.id === profile.verificationReference,
    );
    const a = bundle.approvals.find((a) => a.id === profile.approvalReference);
    const content = profileContent(profile);
    if (
      profile.stationId !== stationId ||
      profile.digest !== profileDigest(profile) ||
      !v ||
      !a ||
      v.stationId !== stationId ||
      a.stationId !== stationId ||
      !equal(v.content.profileContent, content) ||
      !equal(a.profileContent, content) ||
      a.profileId !== profile.id ||
      a.profileVersion !== profile.version ||
      a.digest !== profile.digest
    )
      throw new OperatorError(
        "Profile verification or approval binding does not match.",
      );
  }
  return bundle;
}
async function readBundle(path, stationId) {
  const info = await stat(path);
  if (!info.isFile() || info.size > 8 * 1024 * 1024)
    throw new OperatorError(
      "Profile bundle must be a JSON file at most 8 MiB.",
    );
  const bytes = await readFile(path);
  if (bytes.length > 8 * 1024 * 1024)
    throw new OperatorError("Profile bundle is too large.");
  return validateBundle(JSON.parse(bytes.toString("utf8")), stationId);
}
async function dependency(db, input) {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('review-evidence:'||$1::text||':'||$2::text,0))",
    [input.stationId, input.environment],
  );
  const found = await db.query(
    `SELECT c.configuration FROM review_evidence_configuration c JOIN review_evidence_approval a ON a.id=(c.configuration->'activation'->>'approvalReference')::uuid WHERE c.station_id=$1 AND c.environment=$2 AND c.revision=(SELECT max(revision) FROM review_evidence_configuration WHERE station_id=$1 AND environment=$2) AND a.station_id=c.station_id AND a.environment=c.environment AND a.revision=c.revision AND a.release='review-evidence-v1' AND a.digest=$3 AND a.activated_at<=clock_timestamp() AND a.activated_at=(c.configuration->'activation'->>'activatedAt')::timestamptz`,
    [input.stationId, input.environment, resolverDigest],
  );
  const schema = z.strictObject({
    release: z.literal("review-evidence-v1"),
    digest: z.literal(resolverDigest),
    revision: version,
    scope: z.strictObject({
      stationId: z.literal(input.stationId),
      environment: z.literal(input.environment),
    }),
    activation: z.strictObject({
      state: z.literal("active"),
      approvalReference: z.uuid(),
      activatedAt: z.iso.datetime({ offset: true }),
    }),
  });
  if (
    found.rowCount !== 1 ||
    !schema.safeParse(found.rows[0].configuration).success
  )
    throw new OperatorError(
      "An approved active matching P-25 resolver is required.",
    );
}
export async function operate(pool, value, suppliedBundle) {
  const input = checkedInput(value);
  const bundle =
    input.action === "activate"
      ? suppliedBundle === undefined
        ? await readBundle(input.bundlePath, input.stationId)
        : validateBundle(suppliedBundle, input.stationId)
      : null;
  const db = await pool.connect();
  try {
    await db.query(input.apply ? "BEGIN" : "BEGIN READ ONLY");
    await checkDatabaseEnvironment(db, input.environment);
    // Match domain lock ordering: resolver, then meter policy.
    if (input.action === "activate") await dependency(db, input);
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('meter:'||$1::text||':'||$2::text,0))",
      [input.stationId, input.environment],
    );
    if (
      (await db.query("SELECT id FROM station WHERE id=$1", [input.stationId]))
        .rowCount !== 1
    )
      throw new OperatorError("Station does not exist.");
    const rows = await db.query(
      "SELECT configuration,revision::text FROM meter_configuration WHERE station_id=$1 AND environment=$2 ORDER BY revision DESC LIMIT 1",
      [input.stationId, input.environment],
    );
    const maximum = await db.query(
      "SELECT coalesce(max(revision),0)::text AS revision FROM (SELECT revision FROM meter_configuration WHERE station_id=$1 AND environment=$2 UNION ALL SELECT revision FROM meter_policy_approval WHERE station_id=$1 AND environment=$2) revisions",
      [input.stationId, input.environment],
    );
    const next = BigInt(maximum.rows[0].revision) + 1n;
    if (next > BigInt(Number.MAX_SAFE_INTEGER))
      throw new OperatorError("Configuration revision exhausted.");
    const revision = Number(next);
    if (input.expectedRevision !== null && input.expectedRevision !== revision)
      throw new OperatorError(
        "Revision changed. Obtain authorization for a new preview before applying.",
      );
    if (
      input.activatedAt &&
      (
        await db.query("SELECT $1::timestamptz>clock_timestamp() AS future", [
          input.activatedAt,
        ])
      ).rows[0].future
    )
      throw new OperatorError("Future meter activation is not allowed.");
    const old = rows.rows[0]?.configuration;
    if (!bundle && !old)
      throw new OperatorError("No prior meter configuration to deactivate.");
    const approvalId = input.action === "activate" ? newId() : null;
    const candidate = {
      release: "meter-reconciliation-v1",
      digest: releaseDigest,
      revision,
      scope: { stationId: input.stationId, environment: input.environment },
      resolver: { release: "review-evidence-v1", digest: resolverDigest },
      profiles: bundle?.profiles ?? old.profiles,
      activation: approvalId
        ? {
            state: "active",
            approvalReference: approvalId,
            activatedAt: input.activatedAt,
          }
        : { state: "inactive", approvalReference: null, activatedAt: null },
    };
    const parsed = meterPolicySchema.safeParse(candidate);
    if (!parsed.success || !parsed.data)
      throw new OperatorError("Invalid or overlapping meter policy profiles.");
    const policy = parsed.data;
    const verifications = [];
    const approvals = [];
    if (bundle)
      for (const profile of bundle.profiles) {
        const scope = await db.query(
          "SELECT p.id FROM pump p JOIN product x ON x.id=p.product_id WHERE p.id=$1 AND p.station_id=$2 AND p.product_id=$3 AND x.unit=$4",
          [profile.pumpId, input.stationId, profile.productId, profile.unit],
        );
        if (scope.rowCount !== 1)
          throw new OperatorError(
            "Profile pump/product/unit scope does not match the database.",
          );
        const verification = bundle.verifications.find(
          (v) => v.id === profile.verificationReference,
        );
        const approval = bundle.approvals.find(
          (a) => a.id === profile.approvalReference,
        );
        const v = {
          id: verification.id,
          station_id: verification.stationId,
          content: verification.content,
          authorization_reference: verification.authorizationReference,
        };
        const a = {
          id: approval.id,
          station_id: approval.stationId,
          profile_id: approval.profileId,
          profile_version: approval.profileVersion,
          digest: approval.digest,
          profile_content: approval.profileContent,
          authorization_reference: approval.authorizationReference,
        };
        const priorV = await db.query(
          "SELECT id,station_id,content,authorization_reference FROM meter_verification WHERE id=$1",
          [v.id],
        );
        const priorA = await db.query(
          "SELECT id,station_id,profile_id,profile_version::float8 AS profile_version,digest,profile_content,authorization_reference FROM meter_profile_approval WHERE id=$1 OR (profile_id=$2 AND profile_version=$3)",
          [a.id, a.profile_id, a.profile_version],
        );
        if (priorV.rowCount && !equal(priorV.rows[0], v))
          throw new OperatorError("Immutable verification identity conflicts.");
        if (
          priorA.rowCount &&
          (priorA.rowCount !== 1 || !equal(priorA.rows[0], a))
        )
          throw new OperatorError(
            "Immutable profile approval identity conflicts.",
          );
        if (!priorV.rowCount) verifications.push(v);
        if (!priorA.rowCount) approvals.push(a);
      }
    const configuration = {
      id: newId(),
      station_id: input.stationId,
      environment: input.environment,
      revision,
      configuration: policy,
      authorization_reference: input.authorizationReference,
    };
    const approval = approvalId
      ? {
          ...configuration,
          id: approvalId,
          artifact: meterReleaseArtifact,
          resolver_artifact: reviewEvidenceReleaseArtifact,
        }
      : null;
    if (input.apply) {
      for (const v of verifications)
        await db.query(
          "INSERT INTO meter_verification(id,station_id,content,authorization_reference) VALUES($1,$2,$3::jsonb,$4)",
          [
            v.id,
            v.station_id,
            JSON.stringify(v.content),
            v.authorization_reference,
          ],
        );
      for (const a of approvals)
        await db.query(
          "INSERT INTO meter_profile_approval(id,station_id,profile_id,profile_version,digest,profile_content,authorization_reference) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",
          [
            a.id,
            a.station_id,
            a.profile_id,
            a.profile_version,
            a.digest,
            JSON.stringify(a.profile_content),
            a.authorization_reference,
          ],
        );
      if (approval)
        await db.query(
          "INSERT INTO meter_policy_approval(id,station_id,environment,revision,configuration,authorization_reference,artifact,resolver_artifact) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)",
          [
            approval.id,
            input.stationId,
            input.environment,
            revision,
            JSON.stringify(policy),
            input.authorizationReference,
            meterReleaseArtifact,
            reviewEvidenceReleaseArtifact,
          ],
        );
      await db.query(
        "INSERT INTO meter_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
        [
          configuration.id,
          input.stationId,
          input.environment,
          revision,
          JSON.stringify(policy),
          input.authorizationReference,
        ],
      );
      await db.query("COMMIT");
    } else await db.query("ROLLBACK");
    return {
      applied: input.apply,
      verifications,
      approvals,
      approval,
      configuration,
      policy,
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}
export function formatResult(result) {
  return [
    result.applied
      ? "Applied immutable meter revision."
      : "Dry run: no rows written. IDs and revision are not reserved.",
    "Protected proposed rows (recorded_at assigned by PostgreSQL):",
    JSON.stringify(
      {
        meter_verification: result.verifications,
        meter_profile_approval: result.approvals,
        meter_policy_approval: result.approval,
        meter_configuration: result.configuration,
      },
      null,
      2,
    ),
    `WHR_METER_POLICY=${JSON.stringify(result.policy)}`,
    result.applied
      ? "Next: set WHR_METER_POLICY to the exact applied JSON through the approved deployment procedure; check /api/health as a live settings admin."
      : `Next: review these rows against Earl's approval, then repeat the same command with --apply --expected-revision ${result.policy.revision}. Use successful apply output for WHR_METER_POLICY, then check /api/health as a live settings admin.`,
    "Keep this output in protected operational records. This command never deploys, reevaluates sales or clears holds.",
  ].join("\n");
}
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
    pool.on("error", () => {});
    console.log(formatResult(await operate(pool, input)));
    return 0;
  } catch (error) {
    console.error(
      error instanceof OperatorError
        ? error.message
        : "Meter operation failed. Check access and immutable history privately before retrying; no policy output is available.",
    );
    return 1;
  } finally {
    await pool?.end().catch(() => {});
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.argv.slice(2));

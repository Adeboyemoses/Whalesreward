import type pg from "pg";
import { AuthError } from "../auth/errors";
import {
  reviewEnvironment,
  reviewEvidenceConfiguration,
  reviewEvidenceApprovalValid,
  pinReviewEvidencePolicy,
  type ReviewEnvironment,
} from "./config";
import { reviewEvidenceV1Installed } from "./evidence-evaluator";
import { reviewEvidenceReleaseArtifact } from "./release";
import { meterReleaseArtifact } from "./meter-release";
import {
  canonical,
  instantMicros,
  meterPolicySchema,
  meterReleaseDigest,
  meterVerificationContentSchema,
  profileContent,
  type MeterPolicy,
  type MeterProfile,
} from "./meter-policy";
export * from "./meter-policy";
export function meterConfiguration(env: ReviewEnvironment): MeterPolicy | null {
  try {
    const policy = meterPolicySchema.parse(
      JSON.parse(env.WHR_METER_POLICY ?? "null"),
    );
    if (
      policy.digest !== meterReleaseDigest ||
      policy.scope.environment !== reviewEnvironment(env)
    )
      return null;
    return policy;
  } catch {
    return null;
  }
}
export async function meterApprovalValid(
  db: Pick<pg.PoolClient, "query">,
  policy: MeterPolicy,
  env: ReviewEnvironment,
) {
  const resolver = reviewEvidenceConfiguration(env);
  if (
    policy.activation.state !== "active" ||
    !resolver ||
    !reviewEvidenceV1Installed() ||
    resolver.scope.stationId !== policy.scope.stationId ||
    resolver.scope.environment !== policy.scope.environment ||
    resolver.digest !== policy.resolver.digest ||
    resolver.release !== policy.resolver.release ||
    !(await reviewEvidenceApprovalValid(db, resolver))
  )
    return null;
  const found = await db.query(
    `SELECT a.artifact,a.resolver_artifact FROM meter_configuration c JOIN meter_policy_approval a ON a.id=$4
    WHERE c.station_id=$1 AND c.environment=$2 AND c.revision=$3 AND c.configuration=$5::jsonb
    AND c.revision=(SELECT max(revision) FROM meter_configuration WHERE station_id=$1 AND environment=$2)
    AND a.station_id=c.station_id AND a.environment=c.environment AND a.revision=c.revision AND a.configuration=c.configuration
    AND ($6::timestamptz)<=clock_timestamp()`,
    [
      policy.scope.stationId,
      policy.scope.environment,
      policy.revision,
      policy.activation.approvalReference,
      JSON.stringify(policy),
      policy.activation.activatedAt,
    ],
  );
  if (
    found.rowCount !== 1 ||
    found.rows[0].artifact !== meterReleaseArtifact ||
    found.rows[0].resolver_artifact !== reviewEvidenceReleaseArtifact
  )
    return null;
  const records = await db.query(
    `SELECT a.id,a.station_id,a.profile_id,a.profile_version::text,a.digest,a.profile_content,
    v.id verification_id,v.station_id verification_station,v.content,v.authorization_reference verification_authorization,v.recorded_at verification_recorded_at,
    a.authorization_reference,a.recorded_at
    FROM meter_profile_approval a JOIN meter_verification v ON v.id=ANY($2::uuid[]) WHERE a.id=ANY($1::uuid[]) AND v.id::text=a.profile_content->>'verificationReference'`,
    [
      policy.profiles.map((p) => p.approvalReference),
      policy.profiles.map((p) => p.verificationReference),
    ],
  );
  const snapshots = [];
  for (const p of policy.profiles) {
    const r = records.rows.find((r) => r.id === p.approvalReference),
      content = profileContent(p);
    const verification = meterVerificationContentSchema.safeParse(r?.content);
    if (
      !r ||
      r.station_id !== p.stationId ||
      r.profile_id !== p.id ||
      r.profile_version !== String(p.version) ||
      r.digest !== p.digest ||
      canonical(r.profile_content) !== canonical(content) ||
      r.verification_id !== p.verificationReference ||
      r.verification_station !== p.stationId ||
      !verification.success ||
      canonical(verification.data.profileContent) !== canonical(content)
    )
      return null;
    const scope = await db.query(
      "SELECT id FROM pump WHERE id=$1 AND station_id=$2 AND product_id=$3 AND EXISTS(SELECT 1 FROM product WHERE id=$3 AND unit=$4)",
      [p.pumpId, p.stationId, p.productId, p.unit],
    );
    if (scope.rowCount !== 1) return null;
    snapshots.push(r);
  }
  return {
    resolver,
    profiles: snapshots,
    artifact: found.rows[0].artifact,
    resolverArtifact: found.rows[0].resolver_artifact,
  };
}
export async function pinMeterPolicy(
  db: pg.PoolClient,
  stationId: string,
  env: ReviewEnvironment,
) {
  const policy = meterConfiguration(env);
  if (
    !policy ||
    policy.scope.stationId !== stationId ||
    policy.activation.state !== "active"
  )
    throw new AuthError("meter_policy_unconfigured", 409);
  // Fixed ordering: resolver policy, meter policy, then source history locks.
  try {
    await pinReviewEvidencePolicy(db, stationId, env);
  } catch (e) {
    if (e instanceof AuthError)
      throw new AuthError("meter_policy_unconfigured", 409);
    throw e;
  }
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('meter:'||$1::text||':'||$2::text,0))",
    [stationId, policy.scope.environment],
  );
  const approval = await meterApprovalValid(db, policy, env);
  if (!approval) throw new AuthError("meter_policy_unconfigured", 409);
  return { policy, ...approval };
}
export function coveringProfile(
  policy: MeterPolicy,
  target: {
    stationId: string;
    pumpId: string;
    productId: string;
    currency: string;
    unit: string;
    quantityPrecision: number;
  },
  L: string,
  U: string,
): MeterProfile {
  const matching = policy.profiles.filter(
    (p) =>
      p.stationId === target.stationId &&
      p.pumpId === target.pumpId &&
      p.productId === target.productId &&
      p.currency === target.currency &&
      p.unit === target.unit &&
      p.quantityPrecision === target.quantityPrecision &&
      instantMicros(p.validFrom) <= BigInt(L) &&
      (p.validUntil === null || instantMicros(p.validUntil) > BigInt(U)),
  );
  if (matching.length !== 1)
    throw new AuthError("meter_policy_unconfigured", 409);
  return matching[0]!;
}
export async function meterHealth(db: pg.PoolClient, env: ReviewEnvironment) {
  const p = meterConfiguration(env);
  if (!p) return false;
  try {
    await pinMeterPolicy(db, p.scope.stationId, env);
    // SHARE locks prevent a new pump or price from changing supported scope mid-snapshot.
    // One statement instant covers every pump, price cutoff and profile boundary.
    await db.query(
      "LOCK TABLE pump,product,product_price_version IN SHARE MODE",
    );
    const scope = await db.query(
      `SELECT p.id pump_id,p.product_id,v.quantity_precision,v.currency,d.unit,(extract(epoch FROM statement_timestamp())*1000000)::bigint::text now FROM pump p JOIN product d ON d.id=p.product_id LEFT JOIN LATERAL (SELECT quantity_precision,currency FROM product_price_version WHERE station_id=p.station_id AND product_id=p.product_id AND effective_from<=statement_timestamp() ORDER BY version DESC LIMIT 1) v ON true WHERE p.station_id=$1`,
      [p.scope.stationId],
    );
    if (!scope.rowCount) return false;
    for (const s of scope.rows)
      coveringProfile(
        p,
        {
          stationId: p.scope.stationId,
          pumpId: s.pump_id,
          productId: s.product_id,
          currency: s.currency,
          unit: s.unit,
          quantityPrecision: s.quantity_precision,
        },
        s.now,
        s.now,
      );
    return true;
  } catch (e) {
    if (e instanceof AuthError) return false;
    throw e;
  }
}

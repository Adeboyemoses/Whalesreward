import { expect } from "vitest";
import { newId } from "../../src/server/lib/ids";
import { createReviewsService } from "../../src/server/modules/reviews/service";
import { meterReleaseArtifact } from "../../src/server/modules/reviews/meter-release";
import { reviewEvidenceReleaseArtifact } from "../../src/server/modules/reviews/release";
import {
  meterReleaseDigest,
  profileContent,
  profileDigest,
  type MeterProfile,
  type MeterPolicy,
} from "../../src/server/modules/reviews/meter-policy";
import {
  evidenceDatabase,
  evidenceFixture,
  seedHistorical,
  sourceAudit,
  state,
  S,
} from "./review-evidence-fixture";
import { fixtureId } from "./sync-fixture";
export { evidenceDatabase as meterDatabase };
/** Fictional test-only measurements. Never imported by app, seeds or operational defaults. */
export async function installMeterPolicy(
  x: Pick<MeterFixture, "pool" | "f" | "config">,
  profiles: MeterProfile[],
  revision = 1,
  active = true,
) {
  for (const p of profiles) {
    const content = profileContent(p);
    await x.pool.query(
      "INSERT INTO meter_verification(id,station_id,content,authorization_reference) VALUES($1,$2,$3,'Fictional test measurement') ON CONFLICT(id) DO NOTHING",
      [
        p.verificationReference,
        p.stationId,
        {
          profileContent: content,
          measuredMeterIdentity: "Fictional fixture meter",
          measurementReference: newId(),
          verificationNotes:
            "Test-only measured common underlying sale nearest displays",
        },
      ],
    );
    await x.pool.query(
      "INSERT INTO meter_profile_approval(id,station_id,profile_id,profile_version,digest,profile_content,authorization_reference) VALUES($1,$2,$3,$4,$5,$6,'Fictional test approval') ON CONFLICT(id) DO NOTHING",
      [p.approvalReference, p.stationId, p.id, p.version, p.digest, content],
    );
  }
  const policy: MeterPolicy = {
    release: "meter-reconciliation-v1",
    digest: meterReleaseDigest,
    revision,
    scope: { stationId: x.f.stationId, environment: "test" },
    resolver: { release: "review-evidence-v1", digest: x.config.digest },
    profiles,
    activation: active
      ? { state: "active", approvalReference: newId(), activatedAt: S }
      : { state: "inactive", approvalReference: null, activatedAt: null },
  };
  if (policy.activation.state === "active")
    await x.pool.query(
      "INSERT INTO meter_policy_approval(id,station_id,environment,revision,configuration,artifact,resolver_artifact,authorization_reference) VALUES($1,$2,'test',$3,$4,$5,$6,'Fictional test policy approval')",
      [
        policy.activation.approvalReference,
        x.f.stationId,
        revision,
        policy,
        meterReleaseArtifact,
        reviewEvidenceReleaseArtifact,
      ],
    );
  await x.pool.query(
    "INSERT INTO meter_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,'test',$3,$4,'Fictional test policy configuration')",
    [newId(), x.f.stationId, revision, policy],
  );
  return policy;
}
export function profileVariant(
  p: MeterProfile,
  changes: Partial<MeterProfile> = {},
) {
  const next = {
    ...p,
    id: newId(),
    approvalReference: newId(),
    verificationReference: newId(),
    ...changes,
  };
  next.digest = profileDigest(next);
  return next;
}
export async function addMeterPrice(
  x: Pick<MeterFixture, "pool" | "f">,
  at: string,
  rate = "110000",
  precision = 3,
  version = 2,
) {
  const id = newId();
  await x.pool.query(
    "INSERT INTO product_price_version(id,station_id,product_id,version,rate_kobo,currency,quantity_precision,effective_from,actor_id,reason) VALUES($1,$2,$3,$4,$5,'NGN',$6,$7,$8,'Fictional meter price history')",
    [
      id,
      x.f.stationId,
      fixtureId(9),
      version,
      rate,
      precision,
      at,
      fixtureId(5),
    ],
  );
  await sourceAudit(
    x.pool,
    "price_activated",
    "product",
    fixtureId(9),
    {
      priceVersionId: id,
      version,
      rateKobo: rate,
      quantityPrecision: precision,
    },
    at,
  );
  return id;
}
export async function meterFixture(
  db: Awaited<ReturnType<typeof evidenceDatabase>>,
  options: {
    rate?: string;
    quantity?: string;
    amountKobo?: string;
    precision?: number;
    unit?: "litre" | "kilogram";
    amountStepKobo?: string;
    quantityStep?: string;
    priceAt?: string;
  } = {},
) {
  const x = await evidenceFixture(db),
    precision = options.precision ?? 3,
    unit = options.unit ?? "litre";
  await seedHistorical(
    x.pool,
    "product_price_version",
    "UPDATE product_price_version SET quantity_precision=$2 WHERE id=$1",
    [x.f.priceId, precision],
  );
  await seedHistorical(
    x.pool,
    "audit_event",
    "UPDATE audit_event SET after=jsonb_set(after,'{quantityPrecision}',$2::jsonb) WHERE id=$1",
    [x.priceAudit, JSON.stringify(precision)],
  );
  if (unit !== "litre")
    await seedHistorical(
      x.pool,
      "product",
      "UPDATE product SET unit=$2,code='cooking_gas' WHERE id=$1",
      [fixtureId(9), unit],
    );
  await seedHistorical(
    x.pool,
    "purchase",
    "UPDATE purchase SET quantity_precision=$2,unit=$3,medium=$4,amount_kobo=1100000,entered_amount_kobo=1100000,quantity=11 WHERE id=$1",
    [
      x.sale.purchaseId,
      precision,
      unit,
      unit === "litre" ? "vehicle" : "cylinder",
    ],
  );
  await seedHistorical(
    x.pool,
    "purchase_revision",
    "UPDATE purchase_revision SET quantity_precision=$2,unit=$3,medium=$4,amount_kobo=1100000,entered_amount_kobo=1100000,quantity=11 WHERE purchase_id=$1",
    [
      x.sale.purchaseId,
      precision,
      unit,
      unit === "litre" ? "vehicle" : "cylinder",
    ],
  );
  await x.pool.query(
    "UPDATE purchase_hold SET reason_code='price_uncertain' WHERE id=$1",
    [x.holdId],
  );
  await addMeterPrice(
    x,
    options.priceAt ?? "2026-11-10T11:00:00Z",
    options.rate ?? "110000",
    precision,
  );
  const profile: MeterProfile = {
    id: newId(),
    version: 1,
    digest: "0".repeat(64),
    stationId: x.f.stationId,
    pumpId: x.f.original.pumpId,
    productId: fixtureId(9),
    currency: "NGN",
    unit,
    quantityPrecision: precision,
    validFrom: "2026-11-01T00:00:00Z",
    validUntil: null,
    amountStepKobo: options.amountStepKobo ?? "1",
    quantityStep:
      options.quantityStep ??
      (precision === 0 ? "1" : "0." + "0".repeat(precision - 1) + "1"),
    displayModel: "common_sale_nearest_steps",
    verificationReference: newId(),
    approvalReference: newId(),
  };
  profile.digest = profileDigest(profile);
  const meterPolicy = await installMeterPolicy(x, [profile]);
  const body = {
    ...(await x.h.guard(x.sale.purchaseId)),
    expectedHoldVersion: 1,
    decision: {
      outcome: "correct_meter" as const,
      amountKobo: options.amountKobo ?? "1100000",
      quantity: options.quantity ?? "10.000",
    },
    evidence: x.evidence,
  };
  const env = {
    ...process.env,
    WHR_ENV: "test",
    WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(x.config),
    WHR_METER_POLICY: JSON.stringify(meterPolicy),
  };
  return { ...x, profile, meterPolicy, body, env };
}
export type MeterFixture = Awaited<ReturnType<typeof meterFixture>>;
export function meterService(
  x: MeterFixture,
  env: Record<string, string | undefined> = x.env,
  storage = x.h.storage,
) {
  return createReviewsService({ pool: x.pool, storage, env });
}
export function meterDecide(
  x: MeterFixture,
  body: unknown = x.body,
  svc = meterService(x),
) {
  return svc.decidePrice(x.token, x.sale.purchaseId, x.holdId, body);
}
export async function meterState(x: MeterFixture) {
  return {
    legacy: await state(x),
    meter: (
      await x.pool.query(
        "SELECT * FROM meter_evaluation WHERE purchase_id=$1 ORDER BY decision_id",
        [x.sale.purchaseId],
      )
    ).rows,
    snapshots: (
      await x.pool.query(
        "SELECT to_jsonb(s) value FROM giveaway_snapshot s ORDER BY id",
      )
    ).rows,
  };
}
export async function meterDenied(
  x: MeterFixture,
  operation: () => Promise<unknown>,
  code = "evidence_insufficient",
  status = 422,
) {
  const before = await meterState(x);
  await expect(operation()).rejects.toMatchObject(
    code === "invalid_request" ? { name: "ZodError" } : { code, status },
  );
  expect(await meterState(x)).toEqual(before);
}
export async function meterSucceeded(
  x: MeterFixture,
  body: unknown = x.body,
  svc = meterService(x),
) {
  const original = async () =>
    (
      await x.pool.query(
        "SELECT to_jsonb(p)-ARRAY['status','version','current_revision_id','resolution_candidate_revision_id','verified_sale_date','cancellation_reason','correction_cutoff_at','correction_time_policy_version','correction_date_reliable'] facts FROM purchase p WHERE id=$1",
        [x.sale.purchaseId],
      )
    ).rows;
  const before = await original(),
    snapshots = (await meterState(x)).snapshots;
  const result = await meterDecide(x, body, svc);
  expect(await original()).toEqual(before);
  expect((await meterState(x)).snapshots).toEqual(snapshots);
  const rows = (
    await x.pool.query("SELECT * FROM meter_evaluation WHERE purchase_id=$1", [
      x.sale.purchaseId,
    ])
  ).rows;
  expect(rows).toHaveLength(1);
  const saved = await meterState(x);
  expect(await meterDecide(x, body, svc)).toEqual(result);
  expect(await meterState(x)).toEqual(saved);
  expect(
    (
      await x.pool.query(
        "SELECT count(*)::int n FROM sale_decision WHERE purchase_id=$1",
        [x.sale.purchaseId],
      )
    ).rows[0].n,
  ).toBe(1);
  for (const action of [
    "UPDATE meter_evaluation SET provenance='{}' WHERE purchase_id=$1",
    "DELETE FROM meter_evaluation WHERE purchase_id=$1",
  ])
    await expect(x.pool.query(action, [x.sale.purchaseId])).rejects.toThrow();
  return {
    result,
    provenance: rows[0].provenance,
    revisionId: rows[0].revision_id,
  };
}

import type pg from "pg";
import { AuthError } from "../auth/errors";
import { evaluateMeterHistory } from "./evidence-evaluator";
import { coveringProfile, pinMeterPolicy } from "./meter-config";
import type { ReviewEnvironment } from "./config";
import { compareMeterPair } from "./meter-math";
import type { ReviewEvidence } from "./evidence";
export async function evaluateMeter(
  db: pg.PoolClient,
  request: {
    purchaseId: string;
    stationId: string;
    decisionId: string;
    evidence: ReviewEvidence;
    amountKobo: string;
    quantity: string;
  },
  env: ReviewEnvironment,
) {
  const pinned = await pinMeterPolicy(db, request.stationId, env);
  const conclusion = await evaluateMeterHistory(db, {
    purchaseId: request.purchaseId,
    decisionId: request.decisionId,
    kind: "price",
    outcome: "correct_meter",
    evidence: request.evidence,
    policy: pinned.resolver,
  });
  const p = conclusion.sources.find(
    (s) => s.category === "original_purchase",
  )!.snapshot;
  const profile = coveringProfile(
    pinned.policy,
    {
      stationId: String(p.station_id),
      pumpId: String(p.pump_id),
      productId: String(p.product_id),
      currency: String(p.currency),
      unit: String(p.unit),
      quantityPrecision: p.quantity_precision as number,
    },
    conclusion.interval.L,
    conclusion.interval.U,
  );
  const price = conclusion.conclusions.find(
    (c) => c.tag === "price_valid_throughout",
  );
  if (!price || price.tag !== "price_valid_throughout")
    throw new AuthError("evidence_insufficient", 422);
  const comparison = compareMeterPair(
    request.amountKobo,
    request.quantity,
    price.rateKobo,
    profile.amountStepKobo,
    profile.quantityStep,
    profile.quantityPrecision,
  );
  if (!comparison.reconciled) throw new AuthError("evidence_insufficient", 422);
  return {
    conclusion,
    policy: pinned.resolver,
    meter: {
      policy: pinned.policy,
      resolver: pinned.resolver,
      artifacts: {
        evaluator: pinned.artifact,
        resolver: pinned.resolverArtifact,
      },
      profileRecords: pinned.profiles,
      transcription: {
        kind: "human",
        submitted: {
          amountKobo: request.amountKobo,
          quantity: request.quantity,
        },
      },
      reconciliation: {
        conclusion: "meter_pair_reconciled",
        rateKobo: price.rateKobo,
        priceSegments: price.priceSegments,
        profile,
        interval: conclusion.interval,
        ...comparison,
      },
    },
  };
}

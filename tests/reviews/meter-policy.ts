import {
  meterReleaseDigest,
  profileDigest,
  type MeterProfile,
} from "../../src/server/modules/reviews/meter-policy";
import { browserReviewPolicy } from "./policy";
import { seedId } from "../station/helpers";
const profiles: MeterProfile[] = [2, 3].map((precision) => {
  const p: MeterProfile = {
    id: seedId(9320 + precision),
    version: 1,
    digest: "0".repeat(64),
    stationId: seedId(8),
    pumpId: seedId(14),
    productId: seedId(9),
    currency: "NGN",
    unit: "litre",
    quantityPrecision: precision,
    validFrom: "2026-11-01T00:00:00.000Z",
    validUntil: null,
    amountStepKobo: "1",
    quantityStep: precision === 2 ? "0.01" : "0.001",
    displayModel: "common_sale_nearest_steps",
    verificationReference: seedId(9330 + precision),
    approvalReference: seedId(9340 + precision),
  };
  p.digest = profileDigest(p);
  return p;
});
/** Fictional browser measurements only. Never imported by operational configuration. */
export const browserMeterPolicy = {
  release: "meter-reconciliation-v1" as const,
  digest: meterReleaseDigest,
  revision: 1,
  scope: browserReviewPolicy.scope,
  resolver: {
    release: browserReviewPolicy.release,
    digest: browserReviewPolicy.digest,
  },
  profiles,
  activation: {
    state: "active" as const,
    approvalReference: seedId(9350),
    activatedAt: "2026-11-04T00:00:00.000Z",
  },
};

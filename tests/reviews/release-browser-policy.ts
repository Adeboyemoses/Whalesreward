import { createHash } from "node:crypto";
import { reviewEvidenceV2ReleaseArtifact } from "../../src/server/modules/reviews/release-v2";

/** Fictional complete local-stack v2 approval. Never deploy this policy. */
export const browserReleasePolicy = {
  release: "review-evidence-v2",
  digest: createHash("sha256")
    .update(reviewEvidenceV2ReleaseArtifact)
    .digest("hex"),
  revision: 2,
  scope: {
    stationId: "019a5000-0000-7000-8000-000000000008",
    environment: "development",
  },
  activation: {
    state: "active",
    approvalReference: "019a5000-0000-7000-8000-000000009172",
    activatedAt: "2026-11-04T00:00:00.000Z",
  },
} as const;

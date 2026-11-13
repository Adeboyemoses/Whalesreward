import { createHash } from "node:crypto";
import { reviewEvidenceReleaseArtifact } from "../../src/server/modules/reviews/release";

/** Fictional local-browser approval. Never used by a deployed configuration. */
export const browserReviewPolicy = {
  release: "review-evidence-v1",
  digest: createHash("sha256")
    .update(reviewEvidenceReleaseArtifact)
    .digest("hex"),
  revision: 1,
  scope: {
    stationId: "019a5000-0000-7000-8000-000000000008",
    environment: "development",
  },
  activation: {
    state: "active",
    approvalReference: "019a5000-0000-7000-8000-000000009170",
    activatedAt: "2026-11-04T00:00:00.000Z",
  },
} as const;

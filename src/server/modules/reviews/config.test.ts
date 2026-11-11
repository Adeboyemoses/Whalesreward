import { describe, expect, it } from "vitest";
import {
  reviewEvidenceConfiguration,
  reviewEvidencePolicySchema,
  reviewEvidenceReleaseDigest,
} from "./config";
const policy = {
  release: "review-evidence-v1",
  digest: reviewEvidenceReleaseDigest,
  revision: 1,
  scope: {
    stationId: "00000000-0000-4000-8000-000000000001",
    environment: "test",
  },
  activation: {
    state: "active",
    approvalReference: "00000000-0000-4000-8000-000000000002",
    activatedAt: "2026-11-11T00:00:00Z",
  },
};
describe("review evidence deployment configuration", () => {
  it("admits only the exact reviewed release and deployment scope", () => {
    expect(
      reviewEvidenceConfiguration({
        WHR_ENV: "test",
        WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(policy),
      }),
    ).toEqual(policy);
    expect(
      reviewEvidenceConfiguration({
        WHR_ENV: "production",
        WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(policy),
      }),
    ).toBeNull();
    expect(
      reviewEvidenceConfiguration({
        WHR_ENV: "test",
        WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify({
          ...policy,
          digest: "a".repeat(64),
        }),
      }),
    ).toBeNull();
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null])(
    "refuses revision %s without coercion",
    (revision) => {
      expect(
        reviewEvidencePolicySchema.safeParse({ ...policy, revision }).success,
      ).toBe(false);
    },
  );
  it("refuses extra nested fields, partial activation and unsupported identities", () => {
    for (const value of [
      null,
      { ...policy, extra: true },
      { ...policy, scope: { ...policy.scope, extra: true } },
      { ...policy, activation: { ...policy.activation, extra: true } },
      { ...policy, activation: { state: "active" } },
      { ...policy, release: "review-evidence-v2" },
      { ...policy, scope: { ...policy.scope, stationId: "bad" } },
      {
        ...policy,
        activation: {
          state: "inactive",
          approvalReference: policy.activation.approvalReference,
          activatedAt: null,
        },
      },
    ]) {
      expect(reviewEvidencePolicySchema.safeParse(value).success).toBe(false);
    }
  });
  it("keeps inactive configuration valid but distinct from activation", () => {
    expect(
      reviewEvidencePolicySchema.parse({
        ...policy,
        activation: {
          state: "inactive",
          approvalReference: null,
          activatedAt: null,
        },
      }).activation.state,
    ).toBe("inactive");
  });
});

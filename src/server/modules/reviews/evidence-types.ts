export type EvidenceKind = "price" | "card" | "date" | "capture";
export type EvidenceCategory =
  | "original_purchase"
  | "capturing_context"
  | "frozen_lookup_verification"
  | "price_history"
  | "card_history"
  | "assignment_history"
  | "campaign_history"
  | "domain_audit"
  | "validated_photo"
  | "derived_evidence";
export type EvidenceInterval = {
  S: string;
  R: string;
  expiry: string;
  L: string;
  U: string;
  precision: "microsecond";
};
export type Source = {
  category: EvidenceCategory;
  id: string;
  version: string;
  recordedAt: string;
  scope: Record<string, string>;
  dependencies: string[];
  snapshot: Record<string, unknown>;
};
export type BoundConclusion = {
  sourceIds: string[];
  interval: EvidenceInterval;
};
export type TypedConclusion = BoundConclusion &
  (
    | {
        tag: "price_valid_throughout";
        rateKobo: string;
        currency: string;
        priceSegments: string[];
        precision: "microsecond";
      }
    | {
        tag: "card_before_replacement" | "card_after_replacement";
        cardId: string;
        customerId: string;
        linkId: string;
        replacementAt: string;
        precision: "microsecond";
      }
    | {
        tag: "sale_day";
        day: string;
        timezone: "Africa/Lagos";
        precision: "day";
      }
    | {
        tag:
          "capture_authorized_throughout" | "capture_unauthorized_throughout";
        accountId: string;
        contextId: string;
        stationId: string;
        pumpId: string;
        productId: string;
        precision: "microsecond";
      }
    | {
        tag: "campaign_membership_uniform";
        campaignIds: string[];
        configurationIds: string[];
        inside: boolean;
        precision: "microsecond";
      }
  );
export type PolicyIdentity = {
  release: string;
  digest: string;
  revision: number;
  scope: { stationId: string; environment: string };
  activation: {
    state: string;
    approvalReference: string | null;
    activatedAt: string | null;
  };
};
export type EvidenceRequest = {
  purchaseId: string;
  kind: EvidenceKind;
  outcome: string;
  evidence: { assetId: string; referenceIds: readonly string[] };
  verifiedSaleDate?: string;
  decisionId: string;
  policy: PolicyIdentity;
};
export type EvidenceEvaluation = {
  policyVersion: string;
  referenceIds: string[];
  validPrice?: boolean;
  invalidSale?: boolean;
  authorizedCapture?: boolean;
  campaignEligible?: boolean;
  verifiedSaleDate?: string;
  beforeReplacement?: boolean;
  interval: EvidenceInterval;
  lookup: {
    status: "frozen" | "fallback";
    id: string | null;
    version: string | null;
  };
  sources: Source[];
  conclusions: TypedConclusion[];
  historyGeneration: string;
};
export type Fact = Record<string, unknown> & { id: string };
export type ResolvedEvidence = {
  original: Fact;
  context: Fact;
  assignment: Fact;
  prices: Fact[];
  assignments: Fact[];
  settings: Fact[];
  links: Fact[];
  card: Fact | null;
  audits: Fact[];
  photo: Fact;
  sources: Source[];
  historyGeneration: string;
  derived: Fact[];
};

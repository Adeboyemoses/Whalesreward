import { campaignMembershipProofSchema } from "../reviews/provenance";

/** Input contains only immutable server capture facts and protected conclusions. */
export type CampaignBounds = {
  id: string;
  settingsVersionId: string;
  launch: string;
  start: string;
  cutoff: string;
  deadline: string;
};
export type MembershipFacts = {
  lower: string;
  upper: string;
  details: string;
  photo: string | null;
  conclusions: unknown[];
};
export function membership(f: MembershipFacts, c: CampaignBounds) {
  const l = BigInt(f.lower),
    u = BigInt(f.upper),
    start =
      BigInt(c.start) > BigInt(c.launch) ? BigInt(c.start) : BigInt(c.launch),
    end = BigInt(c.cutoff);
  const proofs = f.conclusions.map((v) =>
    campaignMembershipProofSchema.safeParse(v),
  );
  if (proofs.some((v) => !v.success)) return "timing_unresolved" as const;
  const bound = proofs
    .flatMap((v) => (v.success ? [v.data] : []))
    .filter(
      (v) =>
        v.campaignIds.includes(c.id) &&
        v.configurationIds.includes(c.settingsVersionId),
    );
  if (l > u || bound.some((v) => v.inside !== bound[0]!.inside))
    return "timing_unresolved" as const;
  const inside = bound.length ? bound[0]!.inside : l >= start && u <= end;
  if (!inside) {
    if (bound.length || u < start || l > end)
      return u < BigInt(c.launch)
        ? ("before_launch" as const)
        : ("outside_period" as const);
    return "timing_unresolved" as const;
  }
  if (BigInt(f.details) > BigInt(c.deadline)) return "upload_late" as const;
  if (f.photo === null) return "evidence_deadline_unresolved" as const;
  if (BigInt(f.photo) > BigInt(c.deadline)) return "upload_late" as const;
  return null;
}

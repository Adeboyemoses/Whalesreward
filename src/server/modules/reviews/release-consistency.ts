import { AuthError } from "../auth/errors";

export type AttestedPredicate =
  | { kind: "rate"; rateKobo: string; currency: string }
  | { kind: "card"; cardId: string; customerId: string }
  | { kind: "day"; day: string }
  | {
      kind: "authorization";
      accountId: string;
      pumpId: string;
      authorized: boolean;
    }
  | { kind: "campaign"; campaignId: string; inside: boolean };
export type AppliedAttestation = {
  decisionId: string;
  version: number;
  fromMicros: string;
  throughMicros: string;
  predicates: AttestedPredicate[];
  sourceIds: string[];
};
function invalid(): never {
  throw new AuthError("evidence_insufficient", 422);
}
/** Constraint only: this certificate never supplies another target's proof. */
export function releaseConsistency(
  original: { L: string; U: string },
  applied: readonly AppliedAttestation[],
  purchaseId?: string,
) {
  let lower: bigint, upper: bigint;
  try {
    lower = BigInt(original.L);
    upper = BigInt(original.U);
  } catch {
    return invalid();
  }
  if (lower > upper) return invalid();
  const ids = new Set<string>();
  const predicates = new Map<string, string>();
  for (const a of applied) {
    if (
      !a.decisionId ||
      ids.has(a.decisionId) ||
      !Number.isSafeInteger(a.version) ||
      a.version < 1 ||
      !a.sourceIds.length ||
      a.sourceIds.some(
        (id) =>
          !id ||
          (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
          ) &&
            !(
              purchaseId &&
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                purchaseId,
              ) &&
              id === `${purchaseId}:lookup` &&
              a.sourceIds.includes(purchaseId)
            )),
      ) ||
      !a.predicates.length
    )
      return invalid();
    ids.add(a.decisionId);
    let from: bigint, through: bigint;
    try {
      from = BigInt(a.fromMicros);
      through = BigInt(a.throughMicros);
    } catch {
      return invalid();
    }
    if (
      from > through ||
      from < BigInt(original.L) ||
      through > BigInt(original.U)
    )
      return invalid();
    lower = from > lower ? from : lower;
    upper = through < upper ? through : upper;
    for (const p of a.predicates) {
      let key: string, value: string;
      switch (p.kind) {
        case "rate":
          key = "rate";
          value = JSON.stringify([p.rateKobo, p.currency]);
          break;
        case "card":
          key = "card";
          value = JSON.stringify([p.cardId, p.customerId]);
          break;
        case "day":
          key = "day";
          value = p.day;
          break;
        case "authorization":
          key = "authorization";
          value = JSON.stringify([p.accountId, p.pumpId, p.authorized]);
          break;
        case "campaign":
          key = `campaign:${p.campaignId}`;
          value = String(p.inside);
          break;
        default:
          return invalid();
      }
      if (predicates.has(key) && predicates.get(key) !== value)
        return invalid();
      predicates.set(key, value);
    }
  }
  if (lower > upper) return invalid();
  return {
    fromMicros: String(lower),
    throughMicros: String(upper),
    decisions: applied.map((a) => ({ id: a.decisionId, version: a.version })),
    compatible: true as const,
  };
}

import { describe, expect, it } from "vitest";
import {
  releaseConsistency,
  type AppliedAttestation,
} from "./release-consistency";
const original = { L: "0", U: "7200000000" };
function attestation(
  id: string,
  from: string,
  through = from,
): AppliedAttestation {
  return {
    decisionId: id,
    version: 1,
    fromMicros: from,
    throughMicros: through,
    sourceIds: ["source"],
    predicates: [{ kind: "day", day: "2026-11-15" }],
  };
}
describe("P-29 joint attestation constraint", () => {
  it("SR-02a price at 10:45 and old card at 09:45 cannot coexist in either order", () => {
    const card = attestation("card", "2700000000");
    const price = attestation("price", "6300000000");
    for (const applied of [
      [card, price],
      [price, card],
    ])
      expect(() => releaseConsistency(original, applied)).toThrow(
        expect.objectContaining({ code: "evidence_insufficient" }),
      );
  });
  it("SR-02a overlapping ranges cannot carry contradictory day or campaign predicates", () => {
    for (const predicates of [
      [{ kind: "day" as const, day: "2026-11-14" }],
      [{ kind: "campaign" as const, campaignId: "campaign", inside: false }],
    ]) {
      const a = attestation("a", "100", "200");
      a.predicates.push({
        kind: "campaign",
        campaignId: "campaign",
        inside: true,
      });
      const b = { ...attestation("b", "150", "200"), predicates };
      expect(() => releaseConsistency(original, [a, b])).toThrow();
    }
  });
  it("SR-02a missing provenance and duplicated decisions cannot fabricate consistency", () => {
    const a = attestation("a", "100", "200");
    for (const applied of [
      [{ ...a, sourceIds: [] }],
      [{ ...a, predicates: [] }],
      [a, a],
    ])
      expect(() => releaseConsistency(original, applied)).toThrow();
  });
  it("SR-02a compatible intersection retains decision versions and leaves original interval unchanged", () => {
    const before = { ...original };
    const result = releaseConsistency(original, [
      attestation("a", "100", "200"),
      attestation("b", "200", "300"),
    ]);
    expect(result).toEqual({
      fromMicros: "200",
      throughMicros: "200",
      decisions: [
        { id: "a", version: 1 },
        { id: "b", version: 1 },
      ],
      compatible: true,
    });
    expect(original).toEqual(before);
  });
});

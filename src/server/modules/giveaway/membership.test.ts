import { expect, it } from "vitest";
import { membership, type MembershipFacts } from "./membership";
const c = {
  id: "c",
  settingsVersionId: "s",
  launch: "10",
  start: "20",
  cutoff: "50",
  deadline: "60",
};
const f: MembershipFacts = {
  lower: "20",
  upper: "50",
  details: "60",
  photo: "60",
  conclusions: [],
};
it("includes exact cutoff and both deadline equalities but excludes one microsecond late", () => {
  expect(membership(f, c)).toBeNull();
  expect(membership({ ...f, photo: "61" }, c)).toBe("upload_late");
  expect(membership({ ...f, details: "61" }, c)).toBe("upload_late");
});
it("never treats missing photo proof or crossing interval as settled", () => {
  expect(membership({ ...f, photo: null }, c)).toBe(
    "evidence_deadline_unresolved",
  );
  expect(membership({ ...f, lower: "19" }, c)).toBe("timing_unresolved");
});
it("uses only matching typed campaign provenance and rejects conflicting answers", () => {
  const proof = { campaignIds: ["c"], configurationIds: ["s"], inside: true };
  expect(membership({ ...f, lower: "19", conclusions: [proof] }, c)).toBeNull();
  expect(
    membership(
      {
        ...f,
        lower: "19",
        conclusions: [{ ...proof, configurationIds: ["old"] }],
      },
      c,
    ),
  ).toBe("timing_unresolved");
  expect(
    membership({ ...f, conclusions: [proof, { ...proof, inside: false }] }, c),
  ).toBe("timing_unresolved");
});

import { expect, it } from "vitest";
import { parseArguments, formatResult } from "../../scripts/ops/person.mjs";
const scope = [
  "--station",
  "019a5000-0000-7000-8000-000000000008",
  "--environment",
  "test",
];
const create = [
  "create",
  ...scope,
  "--person",
  "019a5000-0000-7000-8000-000000000801",
  "--authorization",
  "FIXTURE-01",
  "--reason-code",
  "initial_provisioning",
];
it("WHR-227 defaults to preview and requires the exact next revision for apply", () => {
  expect(parseArguments(create)).toMatchObject({
    action: "create",
    apply: false,
    expectedRevision: null,
  });
  expect(() => parseArguments([...create, "--apply"])).toThrow();
  expect(
    parseArguments([...create, "--apply", "--expected-revision", "1"]),
  ).toMatchObject({ apply: true, expectedRevision: 1 });
});
it.each(
  [
    ["--database-url", "private"],
    ["--authorization", "https://private.invalid"],
    ["--dry-run", "--apply", "--expected-revision", "1"],
    ["--expected-revision", "0"],
    ["--expected-binding-version", "0"],
    ["--person", "invalid"],
    ["extra"],
  ].map((flags) => ({ flags })),
)(
  "WHR-227 refuses unknown, duplicate, conflicting or unsafe arguments",
  ({ flags }) => {
    expect(() => parseArguments([...create, ...flags])).toThrow();
  },
);
it("WHR-227 list cannot accept mutation references or conflicting reconciliation filters", () => {
  expect(() =>
    parseArguments(["list", ...scope, "--authorization", "PRIVATE"]),
  ).toThrow();
  expect(() =>
    parseArguments(["list", ...scope, "--revision", "1", "--history"]),
  ).toThrow();
  expect(parseArguments(["list", ...scope])).toMatchObject({ limit: 25 });
});
it("WHR-227 output has no error or profile fallback", () => {
  expect(formatResult({ result: "not_recorded", revision: 1 })).toBe(
    '{"result":"not_recorded","revision":1}',
  );
});

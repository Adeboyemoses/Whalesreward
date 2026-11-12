import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  parseArguments,
  releaseDigest,
} from "../../scripts/ops/review-evidence.mjs";

const args = [
  "activate",
  "--station",
  "00000000-0000-4000-8000-000000000001",
  "--environment",
  "test",
  "--digest",
  "5441b61f25cbf2be012fbc8d695ae003ac7a6ff583ffd285ef4a75b2b38e9d1a",
  "--activated-at",
  "2026-11-11T12:00:00Z",
  "--authorization",
  "WHR-114",
];
it("defaults to dry run and requires an explicit apply", () => {
  expect(parseArguments(args).apply).toBe(false);
  expect(
    parseArguments([...args, "--apply", "--expected-revision", "1"]).apply,
  ).toBe(true);
  expect(parseArguments([...args, "--dry-run"]).apply).toBe(false);
});
it("checks the supplied digest against the built-in release", () => {
  expect(parseArguments(args).digest).toBe(releaseDigest);
  expect(() =>
    parseArguments(args.map((x) => (x === releaseDigest ? "a".repeat(64) : x))),
  ).toThrow("Release digest does not match");
});
it.each(
  [
    [...args, "--apply", "--dry-run"],
    [...args, "--station", "invalid"],
    [...args, "--unknown", "secret"],
    args.filter((x) => x !== "--environment" && x !== "test"),
    args.map((x) =>
      x === "2026-11-11T12:00:00Z" ? "2026-02-30T12:00:00Z" : x,
    ),
  ].map((bad) => [bad]),
)("rejects malformed or ambiguous input without echoing it", (bad) => {
  expect(() => parseArguments(bad)).toThrow();
});
it("requires no activation instant for inactive policy", () => {
  const inactive = args.filter(
    (x) => x !== "--activated-at" && x !== "2026-11-11T12:00:00Z",
  );
  inactive[0] = "deactivate";
  expect(parseArguments(inactive).activatedAt).toBeNull();
  expect(() => parseArguments(["deactivate", ...args.slice(1)])).toThrow();
});
it("runs --help without a database and never echoes malformed arguments or connection secrets", () => {
  const run = (argv: string[], databaseUrl = "") =>
    spawnSync(process.execPath, ["scripts/ops/review-evidence.mjs", ...argv], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
      },
    });
  const help = run(["--help"]);
  expect(help.status).toBe(0);
  expect(help.stdout).toContain("Default: dry run");
  const sentinel = "NEVER_PRINT_FICTIONAL_SECRET";
  const invalid = run([...args, "--bad", sentinel]);
  expect(invalid.status).toBe(1);
  expect(invalid.stdout + invalid.stderr).not.toContain(sentinel);
  const connection = run(
    args,
    `postgresql://fake:${sentinel}@127.0.0.1:1/absent`,
  );
  expect(connection.status).toBe(1);
  expect(connection.stdout).toBe("");
  expect(connection.stderr).not.toContain(sentinel);
  expect(connection.stderr).not.toContain("postgresql:");
  const copiedSecret = run(
    args.map((value) =>
      value === "WHR-114"
        ? `postgresql://fake:${sentinel}@example.com/database`
        : value,
    ),
  );
  expect(copiedSecret.status).toBe(1);
  expect(copiedSecret.stdout + copiedSecret.stderr).not.toContain(sentinel);
});

it("preserves microseconds and refuses silently rounded activation instants", () => {
  const micro = args.map((x) =>
    x === "2026-11-11T12:00:00Z" ? "2026-11-11T12:00:00.123456Z" : x,
  );
  expect(parseArguments(micro).activatedAt).toBe("2026-11-11T12:00:00.123456Z");
  expect(() =>
    parseArguments(micro.map((x) => x.replace("123456Z", "1234567Z"))),
  ).toThrow();
});

it("requires a strict expected revision when applying", () => {
  expect(() => parseArguments([...args, "--apply"])).toThrow();
  for (const value of ["0", "1.5", "-1", "9007199254740992", "1e2"])
    expect(() =>
      parseArguments([...args, "--apply", "--expected-revision", value]),
    ).toThrow();
});

import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
it.each(["orphans", "reconcile-uploads"])(
  "scheduled %s launcher executes locally and fails closed without configuration",
  (job) => {
    const result = spawnSync(
      process.execPath,
      ["jobs/run-maintenance.mjs", job],
      {
        encoding: "utf8",
        env: { NODE_ENV: "test", PATH: process.env.PATH, WHR_ENV: "test" },
        timeout: 10000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"errorCode":"invalid_configuration"');
    expect(result.stdout + result.stderr).not.toMatch(
      /MODULE_NOT_FOUND|ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/,
    );
  },
);

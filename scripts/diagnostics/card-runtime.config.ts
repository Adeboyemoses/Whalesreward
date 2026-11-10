import { defineConfig } from "@playwright/test";
import base from "../../tests/customers-cards/s02.config";

// Local fixture only: setup rejects databases outside whr_app6_*.
export default defineConfig({
  ...base,
  testDir: "../../tests/customers-cards",
  globalSetup: "../../tests/customers-cards/setup.ts",
  webServer: {
    ...base.webServer,
    stdout: "pipe",
    command:
      'NODE_OPTIONS="--max-old-space-size=128 --require=./scripts/diagnostics/card-pool-limit.cjs --require=./scripts/diagnostics/runtime-memory.cjs" pnpm start --hostname 127.0.0.1',
    cwd: new URL("../../", import.meta.url).pathname,
  },
});

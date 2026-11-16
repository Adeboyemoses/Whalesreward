import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "../e2e",
  testMatch: ["leaderboards-real.spec.ts", "leaderboards-protocol.spec.ts"],
  workers: 1,
  retries: 0,
  use: {
    ...devices["Desktop Chrome"],
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});

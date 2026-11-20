import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "../e2e",
  testMatch: [
    "giveaway-checklist-protocol.spec.ts",
    "giveaway-checklist-real.spec.ts",
  ],
  workers: 1,
  retries: 0,
  use: {
    ...devices["Desktop Chrome"],
    trace: "off",
    screenshot: "off",
    video: "off",
    ...(process.env.WHR_PLAYWRIGHT_WS
      ? {
          connectOptions: {
            wsEndpoint: process.env.WHR_PLAYWRIGHT_WS,
            exposeNetwork: "<loopback>",
          },
        }
      : {}),
  },
});

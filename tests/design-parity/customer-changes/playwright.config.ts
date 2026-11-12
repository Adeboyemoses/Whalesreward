import { defineConfig } from "@playwright/test";
import base from "../../customer-changes/playwright.config";
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "capture.spec.ts",
  globalSetup: "../../customers-cards/setup.ts",
  projects: [
    {
      name: "parity",
      use: {
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: 2,
        trace: "off",
        video: "off",
        screenshot: "off",
      },
    },
  ],
});

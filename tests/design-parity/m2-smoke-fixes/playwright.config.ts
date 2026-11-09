import { defineConfig } from "@playwright/test";
import base from "../../customers-cards/playwright.config";
const server = base.webServer as {
  command: string;
  url: string;
  timeout: number;
  env: Record<string, string>;
};

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: ["capture.spec.ts", "export-unavailable.spec.ts"],
  globalSetup: "../../customers-cards/setup.ts",
  use: {
    ...base.use,
    ...(process.env.WHR_TEST_BROWSER_WS
      ? { connectOptions: { wsEndpoint: process.env.WHR_TEST_BROWSER_WS } }
      : {}),
  },
  webServer: {
    ...server,
    ...(process.env.WHR_USE_BUILT_APP === "1"
      ? { command: "pnpm start --hostname 0.0.0.0" }
      : {}),
  },
  projects: [
    {
      name: "parity",
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        trace: "off",
        screenshot: "off",
        video: "off",
        permissions: ["camera"],
      },
    },
  ],
});

import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const server = base.webServer as {
  command: string;
  url: string;
  timeout: number;
  env: Record<string, string>;
};
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "policy.spec.ts",
  projects: [
    { name: "policy", use: { viewport: { width: 390, height: 844 } } },
  ],
  globalSetup: "./setup.ts",
  webServer: {
    ...server,
    env: {
      ...server.env,
      WHR_PHONE_POLICY: "unconfigured-fixture",
      WHR_CARD_PRINT_LAYOUT: "",
      WHR_CARD_EXPORT_LIFETIME_SECONDS: "1",
    },
  },
});

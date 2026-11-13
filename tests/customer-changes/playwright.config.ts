import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";
const database =
  process.env.DATABASE_URL ??
  "postgresql://whr:whr@127.0.0.1:5433/whr_app6_customer_changes";
process.env.DATABASE_URL = database;
const server = base.webServer as {
  command: string;
  url: string;
  timeout: number;
  env: Record<string, string>;
};
export default defineConfig({
  ...base,
  testDir: "../e2e",
  testMatch: "customer-changes.spec.ts",
  globalSetup: "../customers-cards/setup.ts",
  workers: 1,
  retries: 0,
  timeout: 60000,
  use: { ...base.use, trace: "off", screenshot: "off", video: "off" },
  projects: [
    {
      name: "customer-changes",
      use: { viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: { ...server, env: { ...server.env, DATABASE_URL: database } },
});

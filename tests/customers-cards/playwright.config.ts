import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";
const server = base.webServer as {
  command: string;
  url: string;
  timeout: number;
  env: Record<string, string>;
};
const database =
  process.env.DATABASE_URL ??
  "postgresql://whr:whr@127.0.0.1:5433/whr_app6_customers";
process.env.DATABASE_URL = database;
export default defineConfig({
  ...base,
  testDir: "../e2e",
  testMatch: ["customer-registration.spec.ts", "customers-cards.spec.ts"],
  globalSetup: "./setup.ts",
  workers: 1,
  retries: 0,
  use: {
    ...base.use,
    trace: "off",
    permissions: ["camera"],
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
    screenshot: "off",
    video: "off",
  },
  webServer: {
    ...server,
    env: {
      ...server.env,
      DATABASE_URL: database,
      WHR_PHONE_POLICY: "ng-mobile-v1",
      WHR_CARD_PRINT_LAYOUT: JSON.stringify({
        pageWidthMm: 210,
        pageHeightMm: 297,
        cardWidthMm: 85.6,
        cardHeightMm: 54,
        marginMm: 10,
        gapMm: 2,
      }),
      STORAGE_ENDPOINT: "http://127.0.0.1:9000",
      STORAGE_REGION: "us-east-1",
      STORAGE_BUCKET: "whr-e2e-cards",
      STORAGE_ACCESS_KEY_ID: "whr-local",
      STORAGE_SECRET_ACCESS_KEY: "local-development-only",
    },
  },
});

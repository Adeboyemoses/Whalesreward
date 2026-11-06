import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
const database =
  process.env.WHR_ADMIN_TEST_DATABASE_URL ??
  "postgresql://whr:whr@127.0.0.1:5433/whr_admin_browser";
process.env.DATABASE_URL = database;
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3104";
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
process.env.WHR_ENV = "local";
process.env.EMAIL_PROVIDER = "mailpit";
export default defineConfig({
  testDir: ".",
  testMatch: "admin-access.spec.ts",
  workers: 1,
  globalSetup: "./admin-access.setup.ts",
  use: {
    baseURL: process.env.BETTER_AUTH_URL,
    actionTimeout: 15000,
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 2,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  webServer: {
    command: "pnpm build && pnpm start --hostname 127.0.0.1 --port 3104",
    url: process.env.BETTER_AUTH_URL,
    timeout: 180000,
    env: {
      DATABASE_URL: database,
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
      WHR_ENV: "local",
      EMAIL_PROVIDER: "mailpit",
    },
  },
});

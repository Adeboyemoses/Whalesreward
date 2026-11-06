import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: [
    `${import.meta.dirname}/.worktrees/**`,
    `${import.meta.dirname}/product-docs/**`,
  ],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "attendant", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    env: {
      WHR_ENV: "local",
      EMAIL_PROVIDER: "noop",
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    },
    command: "pnpm build && pnpm start --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

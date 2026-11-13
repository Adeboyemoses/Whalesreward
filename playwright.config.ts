import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { browserReviewPolicy } from "./tests/reviews/policy";

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
      WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(browserReviewPolicy),
      WHR_TRUSTED_IP_HEADER: "x-test-ip",
      // Explicit fictional local policies/storage; never configure a deployed app.
      WHR_PHONE_POLICY: "ng-mobile-v1",
      WHR_CARD_PRINT_LAYOUT:
        '{"pageWidthMm":210,"pageHeightMm":297,"cardWidthMm":85.6,"cardHeightMm":54,"marginMm":10,"gapMm":2}',
      STORAGE_ENDPOINT: "http://127.0.0.1:9000",
      STORAGE_REGION: "us-east-1",
      STORAGE_BUCKET: "whr-e2e-cards",
      STORAGE_ACCESS_KEY_ID: "whr-local",
      STORAGE_SECRET_ACCESS_KEY: "local-development-only",
      EMAIL_PROVIDER: "noop",
      BETTER_AUTH_URL: "http://127.0.0.1:3000",
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      // Ephemeral local signing configuration exercises P-23 in ordinary CI.
      WHR_LOOKUP_RECEIPT_KEYS: JSON.stringify({
        browser: randomBytes(32).toString("base64url"),
      }),
      WHR_LOOKUP_RECEIPT_ACTIVE_KID: "browser",
    },
    command: "pnpm build && pnpm start --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});

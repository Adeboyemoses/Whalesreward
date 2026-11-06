import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "timings.spec.ts",
  workers: 1,
  retries: 0,
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
  ],
});

import { defineConfig } from "@playwright/test";
import base from "../../price-adoption/playwright.config";
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "capture.spec.ts",
});

import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "s02.spec.ts",
  projects: [{ name: "s02-api" }],
});

import { defineConfig } from "@playwright/test";
import release from "./playwright.release.config";

// A fresh disposable schema per invocation keeps historical campaign/snapshot
// fixtures and the later inactive policy selection out of the ordinary v2 suite.
export default defineConfig({
  ...release,
  testDir: "./tests/campaign-proof-e2e",
});

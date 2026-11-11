import { defineConfig } from "@playwright/test";
import base from "../../../playwright.config";
export default defineConfig({
  ...base,
  testDir: ".",
  projects: [
    {
      name: "review-fidelity",
      use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 },
    },
  ],
  workers: 1,
});

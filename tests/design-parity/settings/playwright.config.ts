import { defineConfig } from "@playwright/test";
import base from "../../../playwright.config";
export default defineConfig({
  ...base,
  testDir: ".",
  workers: 1,
  projects: [
    {
      name: "settings-fidelity",
      use: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 },
    },
  ],
});

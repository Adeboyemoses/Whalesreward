import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "signed-upload.spec.ts",
  workers: 1,
  use: {
    browserName: "chromium",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "gallery.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3101",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev --hostname 127.0.0.1 --port 3101",
    url: "http://127.0.0.1:3101/dev/gallery",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

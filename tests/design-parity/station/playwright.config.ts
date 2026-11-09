import { defineConfig } from "@playwright/test";
import base from "../../../playwright.config";
const server = base.webServer as {
  command: string;
  url: string;
  timeout: number;
  env: Record<string, string>;
};
const database =
  process.env.WHR_STATION_PARITY_DATABASE_URL ??
  "postgresql://whr:whr@127.0.0.1:5433/whr_app5_parity_local";
process.env.DATABASE_URL = database;
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "station.spec.ts",
  globalSetup: "../../station/setup.ts",
  workers: 1,
  retries: 0,
  projects: [
    {
      name: "parity",
      use: {
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: 2,
        trace: "off",
        video: "off",
        screenshot: "off",
        permissions: ["camera"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
  ],
  webServer: { ...server, env: { ...server.env, DATABASE_URL: database } },
});

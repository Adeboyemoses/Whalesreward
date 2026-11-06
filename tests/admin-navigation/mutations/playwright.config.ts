import { defineConfig } from "@playwright/test";
import base from "../../../playwright.config";
const server = base.webServer as {
  command: string;
  url: string;
  timeout: number;
  env: Record<string, string>;
};
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "mutations.spec.ts",
  workers: 1,
  retries: 0,
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: {
    ...server,
    env: { ...server.env, EMAIL_PROVIDER: "mailpit" },
  },
});

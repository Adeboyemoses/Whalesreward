import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";
const database = new URL(
  process.env.DATABASE_URL ?? "postgresql://localhost/missing",
);
if (!/^whr128_price_[a-z0-9_]+$/.test(database.pathname.slice(1)))
  throw new Error(
    "Price activation browser tests require their dedicated local whr128_price_* database",
  );
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  fullyParallel: false,
  projects: [
    {
      name: "price-phone",
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        permissions: ["camera"],
      },
    },
  ],
});

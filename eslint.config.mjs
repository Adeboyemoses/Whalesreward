import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    ".worktrees/**",
    "product-docs/**",
    "next-env.d.ts",
    "public/attendant/sw.js",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

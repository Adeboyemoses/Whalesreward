import { defineConfig, env } from "prisma/config";
import { prismaDatabaseUrl } from "./scripts/deploy/entrypoint.mjs";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "node prisma/seed.ts" },
  datasource: {
    url: prismaDatabaseUrl(
      env("DATABASE_URL"),
      process.env.WHR_ENV === "staging",
    ),
  },
});

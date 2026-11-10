import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { PHASE_PRODUCTION_SERVER } from "next/constants";

// Created once while Next loads its config, then embedded in both assets and headers.
// No deployment credentials or host-specific values enter the stamp.
export default function configure(phase: string): NextConfig {
  const buildId =
    phase === PHASE_PRODUCTION_SERVER
      ? readFileSync(".next/BUILD_ID", "utf8").trim()
      : (process.env.NEXT_PUBLIC_WHR_BUILD ?? crypto.randomUUID());
  process.env.NEXT_PUBLIC_WHR_BUILD = buildId;
  const config: NextConfig = {
    env: { NEXT_PUBLIC_WHR_BUILD: buildId },
    generateBuildId: async () => buildId,
    async headers() {
      return [
        {
          source: "/api/:path*",
          headers: [{ key: "x-whr-build", value: buildId }],
        },
      ];
    },
  };
  return config;
}

import { configDefaults, defineConfig } from "vitest/config";

const exclude = [...configDefaults.exclude, ".worktrees/**", "product-docs/**"];

export default defineConfig({
  test: {
    exclude,
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
          exclude,
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          exclude,
        },
      },
      // No domain time rules exist yet; this becomes mandatory once the time helper lands.
      {
        test: {
          name: "time",
          include: ["src/**/*.time.test.ts", "tests/time/**/*.test.ts"],
          exclude,
        },
      },
    ],
  },
});

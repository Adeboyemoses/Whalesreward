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
      // Calendar rules must pass in both configured timezones.
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

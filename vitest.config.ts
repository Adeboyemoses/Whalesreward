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
          exclude: [
            ...exclude,
            "src/server/modules/reports/renderer-timing.test.ts",
          ],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          exclude,
        },
      },
      // Wall-clock ceiling timing assertions (Earl's worst-case export and
      // the REPORT_LIMITS.sources ceiling) measure real render time against
      // the cardStorageDeadline budget. Running them inside the main
      // parallel unit run contends with every sibling test file's worker
      // processes — contention that doesn't exist in production, where one
      // export renders per claimed row via SKIP LOCKED — and that
      // contention alone can push a measurement past its margin. Isolate
      // them to a single, non-parallel fork so the measurement reflects the
      // renderer's own cost, not CI scheduling noise.
      {
        test: {
          name: "timing",
          include: ["src/server/modules/reports/renderer-timing.test.ts"],
          exclude,
          pool: "forks",
          // Vitest 5 dropped poolOptions.forks.singleFork; fileParallelism:
          // false pins maxWorkers to 1 for this project, so its two tests
          // run alone in one fork with no sibling-file worker contention.
          fileParallelism: false,
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

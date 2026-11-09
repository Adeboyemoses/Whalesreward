import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({
  next: vi.fn(),
  end: vi.fn(),
  pool: vi.fn(),
  storage: vi.fn(),
}));
vi.mock("pg", () => ({
  default: {
    Pool: class extends EventEmitter {
      constructor(options: unknown) {
        super();
        fake.pool(options, this);
      }
      end() {
        return fake.end();
      }
    },
  },
}));
vi.mock("./exports", () => ({
  prepareCardExport: (...args: unknown[]) => fake.next(...args),
}));
vi.mock("../../adapters/card-artifacts", () => ({
  createCardArtifactStorage: () => fake.storage(),
}));
import { startAutomaticCardExports } from "./runtime";
const globals = globalThis as typeof globalThis & {
  __whrCardExports?: { stop(): Promise<void> };
};
const saved = {
  SIGTERM: process.rawListeners("SIGTERM"),
  SIGINT: process.rawListeners("SIGINT"),
};
beforeEach(() => {
  vi.useFakeTimers();
  fake.next.mockReset().mockResolvedValue({ processed: false });
  fake.end.mockReset().mockResolvedValue(undefined);
  fake.pool.mockClear();
  fake.storage.mockReset().mockReturnValue({ fictional: true });
  vi.stubEnv("STORAGE_ENDPOINT", "http://127.0.0.1:9000");
  vi.stubEnv("DATABASE_URL", "postgresql://fixture@127.0.0.1/fictional");
  vi.stubEnv("WHR_CARD_PRINT_LAYOUT", undefined);
  vi.stubEnv("NEXT_PHASE", undefined);
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.removeAllListeners(signal);
  delete globals.__whrCardExports;
});
afterEach(async () => {
  await globals.__whrCardExports?.stop();
  delete globals.__whrCardExports;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.removeAllListeners(signal);
    for (const listener of saved[signal])
      process.on(signal, listener as NodeJS.SignalsListener);
  }
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
it("opens no resources during build or without storage/database configuration", () => {
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  expect(startAutomaticCardExports()).toBeUndefined();
  vi.stubEnv("NEXT_PHASE", undefined);
  vi.stubEnv("STORAGE_ENDPOINT", undefined);
  expect(startAutomaticCardExports()).toBeUndefined();
  vi.stubEnv("STORAGE_ENDPOINT", "http://127.0.0.1:9000");
  vi.stubEnv("DATABASE_URL", undefined);
  expect(startAutomaticCardExports()).toBeUndefined();
  expect(fake.pool).not.toHaveBeenCalled();
  expect(fake.storage).not.toHaveBeenCalled();
});
it("starts once, bounds the pool and binds automatic restart work without PDF configuration", async () => {
  const loop = startAutomaticCardExports();
  expect(startAutomaticCardExports()).toBe(loop);
  await vi.advanceTimersByTimeAsync(0);
  expect(fake.pool).toHaveBeenCalledTimes(1);
  expect(fake.pool.mock.calls[0]?.[0]).toMatchObject({
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 6000,
  });
  expect(fake.next).toHaveBeenCalledWith(
    fake.pool.mock.calls[0]?.[1],
    expect.objectContaining({
      storage: { fictional: true },
      layout: undefined,
    }),
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(fake.next).toHaveBeenCalledTimes(2);
});
it("never overlaps slow render batches and limits successful work per tick", async () => {
  let release!: (r: { processed: boolean }) => void;
  fake.next.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  startAutomaticCardExports();
  await vi.advanceTimersByTimeAsync(20000);
  expect(fake.next).toHaveBeenCalledTimes(1);
  release({ processed: true });
  await vi.advanceTimersByTimeAsync(0);
  fake.next.mockResolvedValue({ processed: true });
  await vi.advanceTimersByTimeAsync(5000);
  expect(fake.next).toHaveBeenCalledTimes(3);
});
it("drains active preparation before invoking prior mail/Next signal handlers once", async () => {
  let release!: (r: { processed: boolean }) => void;
  fake.next.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const prior = vi.fn(function (this: unknown, signal: unknown) {
    expect(this).toBe(process);
    expect(signal).toBe("SIGTERM");
  });
  process.once("SIGTERM", prior);
  startAutomaticCardExports();
  process.emit("SIGTERM", "SIGTERM");
  process.emit("SIGTERM", "SIGTERM");
  expect(prior).not.toHaveBeenCalled();
  expect(fake.end).not.toHaveBeenCalled();
  release({ processed: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(prior).toHaveBeenCalledTimes(1);
  expect(fake.end).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(70000);
  expect(fake.next).toHaveBeenCalledTimes(1);
});

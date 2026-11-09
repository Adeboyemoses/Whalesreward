import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  pools: vi.fn(),
  end: vi.fn(async () => {}),
  on: vi.fn(),
  processNext: vi.fn(async (): Promise<boolean> => false),
  service: vi.fn(),
  config: vi.fn(() => {
    throw new Error("Storage configuration unavailable");
  }),
}));
vi.mock("pg", () => ({
  default: {
    Pool: class {
      constructor(options: unknown) {
        doubles.pools(options);
      }
      on = doubles.on;
      end = doubles.end;
    },
  },
}));
vi.mock("../../src/server/modules/corrections/service", () => ({
  createCorrectionsService: (options: unknown) => {
    doubles.service(options);
    return { processNext: doubles.processNext };
  },
}));
vi.mock("../../src/server/adapters/storage", () => ({
  storageConfig: doubles.config,
  createStorage: vi.fn(),
}));
vi.mock("../../src/server/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));
import { startAutomaticCorrections } from "../../src/server/modules/corrections/runtime";

type Runtime = typeof globalThis & {
  __whrCorrections?: { stop(): Promise<void> };
};
let previous: Map<NodeJS.Signals, ReturnType<typeof process.rawListeners>>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  doubles.processNext.mockResolvedValue(false);
  vi.stubEnv("NEXT_PHASE", "");
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://whr:whr@127.0.0.1:5433/fictional_runtime",
  );
  previous = new Map(
    (["SIGTERM", "SIGINT"] as const).map((signal) => [
      signal,
      process.rawListeners(signal),
    ]),
  );
  delete (globalThis as Runtime).__whrCorrections;
});
afterEach(async () => {
  await (globalThis as Runtime).__whrCorrections?.stop();
  delete (globalThis as Runtime).__whrCorrections;
  for (const [signal, listeners] of previous) {
    process.removeAllListeners(signal);
    for (const listener of listeners)
      process.on(signal, listener as NodeJS.SignalsListener);
  }
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("I-52 automatic correction processing lifecycle", () => {
  it.each(["build", "no database"])("opens no resources during %s", (mode) => {
    if (mode === "build") vi.stubEnv("NEXT_PHASE", "phase-production-build");
    else vi.stubEnv("DATABASE_URL", "");
    expect(startAutomaticCorrections()).toBeUndefined();
    expect(doubles.pools).not.toHaveBeenCalled();
    expect(doubles.service).not.toHaveBeenCalled();
  });

  it("starts durable processing without storage configuration, never overlaps and drains before closing", async () => {
    let finish!: (value: boolean) => void;
    doubles.processNext.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const loop = startAutomaticCorrections()!;
    expect(startAutomaticCorrections()).toBe(loop);
    expect(doubles.pools).toHaveBeenCalledTimes(1);
    expect(doubles.processNext).toHaveBeenCalledTimes(1);
    expect(doubles.config).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(doubles.processNext).toHaveBeenCalledTimes(1);
    const stopped = loop.stop();
    expect(doubles.end).not.toHaveBeenCalled();
    finish(false);
    await stopped;
    expect(doubles.end).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(doubles.processNext).toHaveBeenCalledTimes(1);
  });

  it("drains correction work before invoking the process's previous shutdown listener", async () => {
    const prior = vi.fn();
    process.on("SIGTERM", prior);
    startAutomaticCorrections();
    const shutdown = process.rawListeners("SIGTERM");
    expect(shutdown).toHaveLength(1);
    Reflect.apply(shutdown[0]!, process, ["SIGTERM"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(doubles.end).toHaveBeenCalledTimes(1);
    expect(prior).toHaveBeenCalledWith("SIGTERM");
    expect(doubles.end.mock.invocationCallOrder[0]).toBeLessThan(
      prior.mock.invocationCallOrder[0]!,
    );
  });
});

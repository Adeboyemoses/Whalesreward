import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ next: vi.fn(), end: vi.fn(), pool: vi.fn() }));
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
vi.mock("./mail", () => ({
  processMail: (...args: unknown[]) => fake.next(...args),
}));
vi.mock("./config", () => ({
  adminConfig: () => ({
    secret: "fictional-secret",
    origin: "http://127.0.0.1:3000",
    production: false,
  }),
}));
import { startAutomaticAdminMail } from "./mail-runtime";
import { logger } from "../../lib/logger";
const globals = globalThis as typeof globalThis & {
  __whrAutomaticAdminMail?: unknown;
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
  vi.stubEnv("WHR_ENV", "local");
  vi.stubEnv("EMAIL_PROVIDER", "mailpit");
  vi.stubEnv("DATABASE_URL", "postgresql://fixture@127.0.0.1/fictional");
  vi.stubEnv("NEXT_PHASE", undefined);
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
  delete globals.__whrAutomaticAdminMail;
});
afterEach(async () => {
  const state = globals.__whrAutomaticAdminMail as
    { loop: { stop(): Promise<void> } } | undefined;
  await state?.loop.stop();
  delete globals.__whrAutomaticAdminMail;
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    for (const listener of saved[signal])
      process.on(signal, listener as NodeJS.SignalsListener);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
it("does not open a pool for absent/noop provider or during build", () => {
  for (const provider of [undefined, "", "noop"]) {
    vi.stubEnv("EMAIL_PROVIDER", provider);
    expect(startAutomaticAdminMail()).toBeUndefined();
  }
  vi.stubEnv("EMAIL_PROVIDER", "mailpit");
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  expect(startAutomaticAdminMail()).toBeUndefined();
  expect(fake.pool).not.toHaveBeenCalled();
});
it("starts one loop across repeat registration and isolates bounded database connections", async () => {
  const a = startAutomaticAdminMail();
  expect(startAutomaticAdminMail()).toBe(a);
  expect(fake.pool).toHaveBeenCalledTimes(1);
  expect(fake.pool.mock.calls[0]?.[0]).toMatchObject({
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 6000,
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(fake.next).toHaveBeenCalledTimes(1);
  const log = vi.spyOn(logger, "error").mockImplementation(() => {});
  fake.pool.mock.calls[0]?.[1].emit(
    "error",
    new Error("private@example.com secret"),
  );
  expect(log).toHaveBeenCalledWith({ event: "email.loop_pool", errors: 1 });
});
it("gates native shutdown until an active attempt drains and ignores repeated signals", async () => {
  let release!: (value: { processed: boolean }) => void;
  fake.next.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const native = vi.fn(function (this: unknown, signal: unknown) {
    expect(this).toBe(process);
    expect(signal).toBe("SIGTERM");
  });
  process.once("SIGTERM", native);
  const log = vi.spyOn(logger, "info").mockImplementation(() => {});
  startAutomaticAdminMail();
  process.emit("SIGTERM", "SIGTERM");
  process.emit("SIGTERM", "SIGTERM");
  expect(native).not.toHaveBeenCalled();
  expect(fake.end).not.toHaveBeenCalled();
  release({ processed: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(native).toHaveBeenCalledTimes(1);
  expect(fake.end).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith({ event: "email.loop_shutdown", errors: 0 });
  await vi.advanceTimersByTimeAsync(40000);
  expect(fake.next).toHaveBeenCalledTimes(1);
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createMailLoop } from "./mail-loop";
afterEach(() => vi.useRealTimers());
describe("bounded automatic mail loop", () => {
  it("does one empty check per interval and stops its timer", async () => {
    vi.useFakeTimers();
    const processNext = vi.fn(async () => ({ processed: false }));
    const close = vi.fn(async () => {});
    const loop = createMailLoop({ processNext, close, report: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(processNext).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(processNext).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(processNext).toHaveBeenCalledTimes(2);
    await loop.stop();
    await loop.stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(processNext).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("bounds each batch and reports only counts", async () => {
    vi.useFakeTimers();
    const processNext = vi.fn(async () => ({
      processed: true,
      delivered: true,
    }));
    const report = vi.fn();
    const loop = createMailLoop({ processNext, close: async () => {}, report });
    await vi.advanceTimersByTimeAsync(0);
    expect(processNext).toHaveBeenCalledTimes(10);
    expect(report).toHaveBeenCalledWith({
      processed: 10,
      delivered: 10,
      failed: 0,
      errors: 0,
    });
    await loop.stop();
  });
  it("never overlaps and drains the active attempt before closing", async () => {
    vi.useFakeTimers();
    let finish!: (value: { processed: boolean; delivered: boolean }) => void;
    const processNext = vi.fn(
      () =>
        new Promise<{ processed: boolean; delivered: boolean }>((resolve) => {
          finish = resolve;
        }),
    );
    const close = vi.fn(async () => {});
    const loop = createMailLoop({ processNext, close, report: vi.fn() });
    await vi.advanceTimersByTimeAsync(20000);
    expect(processNext).toHaveBeenCalledTimes(1);
    const stopped = loop.stop();
    expect(close).not.toHaveBeenCalled();
    finish({ processed: true, delivered: false });
    await stopped;
    expect(close).toHaveBeenCalledTimes(1);
    expect(processNext).toHaveBeenCalledTimes(1);
  });
  it("waits after a thrown failure and never reports its private details", async () => {
    vi.useFakeTimers();
    const processNext = vi.fn(async () => {
      throw new Error("private@example.com token");
    });
    const report = vi.fn();
    const loop = createMailLoop({ processNext, close: async () => {}, report });
    await vi.advanceTimersByTimeAsync(0);
    expect(processNext).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({
      processed: 0,
      delivered: 0,
      failed: 0,
      errors: 1,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(processNext).toHaveBeenCalledTimes(2);
    await loop.stop();
  });
  it("stops claiming when the batch time budget is spent", async () => {
    vi.useFakeTimers();
    let now = 0;
    const processNext = vi.fn(async () => {
      now += 20000;
      return { processed: true };
    });
    const loop = createMailLoop({
      processNext,
      close: async () => {},
      report: vi.fn(),
      now: () => now,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(processNext).toHaveBeenCalledTimes(1);
    await loop.stop();
  });
});

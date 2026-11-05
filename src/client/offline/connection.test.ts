import { describe, expect, it } from "vitest";
import { ConnectionMonitor } from "./connection";

describe("connection hints", () => {
  it("publishes browser events immediately and ignores older request completions", () => {
    let browserOnline = true;
    const monitor = new ConnectionMonitor(() => browserOnline);
    const states: boolean[] = [];
    monitor.subscribe(() => states.push(monitor.isOnline()));
    const old = monitor.beginRequest();
    browserOnline = false;
    monitor.browserChanged();
    old(true);
    expect(states).toEqual([false]);
    expect(monitor.isOnline()).toBe(false);
    browserOnline = true;
    monitor.browserChanged();
    old(false);
    expect(states).toEqual([false, true]);
    expect(monitor.isOnline()).toBe(true);
  });

  it("an older failure cannot overwrite a newer successful request", () => {
    const monitor = new ConnectionMonitor(() => true);
    const old = monitor.beginRequest();
    const recent = monitor.beginRequest();
    recent(true);
    old(false);
    expect(monitor.isOnline()).toBe(true);
    monitor.beginRequest()(false);
    expect(monitor.isOnline()).toBe(false);
    // Browser transport remains allowed for session revalidation and recovery.
    expect(monitor.browserOnline()).toBe(true);
    monitor.beginRequest()(true);
    expect(monitor.isOnline()).toBe(true);
  });
});

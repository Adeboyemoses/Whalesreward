import { describe, expect, it } from "vitest";
import { advanceWindow, requestDuration } from "./window";
import type { OfflineWindow } from "../types";
const anchor = Date.parse("2026-11-04T10:00:00Z");
const row = {
  captureContextId: "context-one",
  lastOnlineSignInAt: new Date(anchor).toISOString(),
  offlineExpiresAt: new Date(anchor + 86400000).toISOString(),
  lastTrustedServerTime: new Date(anchor).toISOString(),
  elapsedAtCheckpointMs: 0,
  wallTimeAtCheckpoint: new Date(anchor).toISOString(),
  runtimeId: "one",
  locked: false,
  logoutPending: false,
} as OfflineWindow;
const baseline = {
  captureContextId: "context-one",
  runtimeId: "one",
  mono: 0,
  elapsedMs: 0,
};
describe("offline window", () => {
  it("expires at exactly 24 hours without changing the sign-in anchor", () => {
    const result = advanceWindow(
      row,
      { wall: anchor + 86400000, mono: 86400000, runtimeId: "one" },
      baseline,
    );
    expect(result.locked).toBe(true);
    expect(result.lastOnlineSignInAt).toBe(row.lastOnlineSignInAt);
  });
  it("locks rollback and never subtracts elapsed time", () => {
    expect(
      advanceWindow(
        row,
        { wall: anchor - 1, mono: 100, runtimeId: "one" },
        baseline,
      ).locked,
    ).toBe(true);
  });
  it("survives restart without renewing time", () => {
    const next = advanceWindow(
      row,
      { wall: anchor + 3600000, mono: 0, runtimeId: "two" },
      baseline,
    );
    expect(next.elapsedAtCheckpointMs).toBe(3600000);
    expect(next.locked).toBe(false);
  });
  it("monotonic elapsed catches frozen wall time", () => {
    expect(
      advanceWindow(
        row,
        { wall: anchor, mono: 86400000, runtimeId: "one" },
        baseline,
      ).locked,
    ).toBe(true);
  });
});

describe("request transit age", () => {
  it("uses monotonic elapsed when wall time is frozen", () => {
    expect(
      requestDuration(
        { wall: anchor, mono: 100, runtimeId: "one" },
        { wall: anchor, mono: 60100, runtimeId: "one" },
      ),
    ).toBe(60000);
  });
  it("rejects negative elapsed or a runtime discontinuity", () => {
    expect(
      requestDuration(
        { wall: anchor, mono: 100, runtimeId: "one" },
        { wall: anchor - 1, mono: 101, runtimeId: "one" },
      ),
    ).toBeNull();
    expect(
      requestDuration(
        { wall: anchor, mono: 100, runtimeId: "one" },
        { wall: anchor + 1, mono: 0, runtimeId: "two" },
      ),
    ).toBeNull();
  });
});

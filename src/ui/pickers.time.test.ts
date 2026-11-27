import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  wallClockToInstant,
  instantToWallClock,
  timezoneOptions,
  offsetMinutesInZone,
} from "./pickers";

// Proves the wire format truly hasn't changed: the same `instant` shape the
// server schema expects (z.iso.datetime({ offset: true })), used directly
// inside timingReviewSchema's launchAt/purchaseStart/purchaseCutoff fields.
const instant = z.iso.datetime({ offset: true });

describe("wallClockToInstant / instantToWallClock round-trip", () => {
  it("round-trips a fixed +01:00 zone with no DST (Africa/Lagos), winter and summer dates", () => {
    for (const [date, time] of [
      ["2026-01-15", "09:30:00"],
      ["2026-07-15", "09:30:00"],
    ]) {
      const iso = wallClockToInstant(date!, time!, "Africa/Lagos");
      expect(iso).not.toBeNull();
      expect(iso).toMatch(/\+01:00$/);
      expect(instant.safeParse(iso).success).toBe(true);
      expect(instantToWallClock(iso, "Africa/Lagos")).toEqual({ date, time });
    }
  });

  it("round-trips a DST-observing zone (America/New_York) across winter (EST, -05:00) and summer (EDT, -04:00)", () => {
    const winter = wallClockToInstant("2026-01-15", "09:30:00", "America/New_York");
    expect(winter).toMatch(/-05:00$/);
    expect(instant.safeParse(winter).success).toBe(true);
    expect(instantToWallClock(winter, "America/New_York")).toEqual({
      date: "2026-01-15",
      time: "09:30:00",
    });

    const summer = wallClockToInstant("2026-07-15", "09:30:00", "America/New_York");
    expect(summer).toMatch(/-04:00$/);
    expect(instant.safeParse(summer).success).toBe(true);
    expect(instantToWallClock(summer, "America/New_York")).toEqual({
      date: "2026-07-15",
      time: "09:30:00",
    });
  });

  it("round-trips a second DST zone (Europe/London) across winter (GMT, +00:00) and summer (BST, +01:00)", () => {
    const winter = wallClockToInstant("2026-01-15", "09:30:00", "Europe/London");
    expect(winter).toMatch(/\+00:00$/);
    expect(instantToWallClock(winter, "Europe/London")).toEqual({
      date: "2026-01-15",
      time: "09:30:00",
    });

    const summer = wallClockToInstant("2026-07-15", "09:30:00", "Europe/London");
    expect(summer).toMatch(/\+01:00$/);
    expect(instantToWallClock(summer, "Europe/London")).toEqual({
      date: "2026-07-15",
      time: "09:30:00",
    });
  });
});

describe("DST transition boundaries (America/New_York)", () => {
  // 2026 US spring-forward is 2026-03-08 02:00 local -> 03:00 local (nonexistent 02:00-03:00).
  // 2026 US fall-back is 2026-11-01 02:00 local (ambiguous 01:00-02:00 occurs twice).
  it("resolves a nonexistent wall-clock time at the spring-forward gap deterministically and round-trips", () => {
    const iso = wallClockToInstant("2026-03-08", "02:30:00", "America/New_York");
    expect(iso).not.toBeNull();
    expect(instant.safeParse(iso!).success).toBe(true);
    // Documented convention: the algorithm's first guess treats the wall
    // clock as UTC, subtracts the offset found there, then re-checks the
    // offset at the corrected instant once. At a nonexistent local time this
    // converges on the pre-transition (EST, -05:00) offset because the UTC
    // guess (2026-03-08T02:30:00Z) still reads as EST-side when the -05:00
    // offset is subtracted from it a second time; whichever offset it picks,
    // it must be one of the zone's two real offsets and must be stable.
    const offset = /([+-]\d{2}:\d{2})$/.exec(iso!)![1];
    expect(["-05:00", "-04:00"]).toContain(offset);
    // Re-running must be deterministic (same input -> same output).
    expect(wallClockToInstant("2026-03-08", "02:30:00", "America/New_York")).toBe(iso);
    // 02:30 local never occurred (clocks jump 02:00 -> 03:00), so reading the
    // resolved instant back as wall-clock legitimately returns a different,
    // *real* local time (01:30, the nearest valid moment at the same UTC
    // instant) rather than the nonexistent 02:30 that was asked for. The
    // invariant that must hold is on the underlying instant, not the string:
    // feeding that recovered real wall-clock back through wallClockToInstant
    // must reproduce the exact same instant (same epoch millisecond).
    const back = instantToWallClock(iso, "America/New_York")!;
    const reDerived = wallClockToInstant(back.date, back.time, "America/New_York");
    expect(reDerived).not.toBeNull();
    expect(new Date(reDerived!).getTime()).toBe(new Date(iso!).getTime());
  });

  it("resolves an ambiguous wall-clock time at the fall-back overlap deterministically and round-trips", () => {
    const iso = wallClockToInstant("2026-11-01", "01:30:00", "America/New_York");
    expect(iso).not.toBeNull();
    expect(instant.safeParse(iso!).success).toBe(true);
    const offset = /([+-]\d{2}:\d{2})$/.exec(iso!)![1];
    expect(["-05:00", "-04:00"]).toContain(offset);
    expect(wallClockToInstant("2026-11-01", "01:30:00", "America/New_York")).toBe(iso);
    const back = instantToWallClock(iso, "America/New_York")!;
    const reDerived = wallClockToInstant(back.date, back.time, "America/New_York");
    expect(reDerived).toBe(iso);
  });

  it("offsetMinutesInZone reports the two distinct real offsets either side of the transition", () => {
    const before = offsetMinutesInZone(Date.UTC(2026, 2, 8, 6, 0, 0), "America/New_York"); // well before 07:00Z transition
    const after = offsetMinutesInZone(Date.UTC(2026, 2, 8, 8, 0, 0), "America/New_York"); // well after
    expect(before).toBe(-300); // EST
    expect(after).toBe(-240); // EDT
  });
});

describe("timezoneOptions()", () => {
  it("puts Africa/Lagos first and sorts the rest alphabetically", () => {
    const options = timezoneOptions();
    expect(options[0]).toBe("Africa/Lagos");
    const rest = options.slice(1);
    const sorted = [...rest].sort((a, b) => a.localeCompare(b));
    expect(rest).toEqual(sorted);
    expect(new Set(options).size).toBe(options.length);
  });

  it("always includes the campaign's currently-stored zone even if it is not in the source list", () => {
    const fictionalZone = "Zz/Fictional_Stored_Zone_WHR230";
    const options = timezoneOptions(fictionalZone);
    expect(options).toContain(fictionalZone);
    expect(options[0]).toBe("Africa/Lagos");
  });

  it("does not duplicate Africa/Lagos when it is passed as the current zone", () => {
    const options = timezoneOptions("Africa/Lagos");
    expect(options.filter((z) => z === "Africa/Lagos")).toHaveLength(1);
    expect(options[0]).toBe("Africa/Lagos");
  });
});

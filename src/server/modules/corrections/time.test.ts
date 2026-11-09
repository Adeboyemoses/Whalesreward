import { describe, expect, it } from "vitest";
import { correctionTiming, reliableCutoff } from "./time";
describe("correction authoritative time", () => {
  it("proves a day only from original bounded interval, never upload or phone time", () => {
    expect(
      reliableCutoff(
        new Date("2026-11-09T06:00Z"),
        new Date("2026-11-09T22:59Z"),
        new Date("2026-11-10T06:00Z"),
      )?.toISOString(),
    ).toBe("2026-11-09T23:00:00.000Z");
    expect(
      reliableCutoff(
        new Date("2026-11-09T06:00Z"),
        new Date("2026-11-10T07:00Z"),
        new Date("2026-11-10T06:00Z"),
      ),
    ).toBeNull();
  });
  it("classifies actual 23:59:59.999 before and exactly 00:00 late in Lagos", () => {
    const cutoff = new Date("2026-11-09T23:00Z");
    expect(correctionTiming(cutoff, new Date("2026-11-09T22:59:59.999Z"))).toBe(
      "before_midnight",
    );
    expect(correctionTiming(cutoff, cutoff)).toBe("late");
    expect(correctionTiming(null, cutoff)).toBe("unresolved");
  });
});

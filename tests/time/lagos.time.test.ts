import { describe, expect, it } from "vitest";
import {
  stationDate,
  nextStationMidnight,
  canAutoApplyCorrection,
  formatStationDateTime,
} from "../../src/server/lib/time";

describe("Lagos trusted receipt calendar (I-37 helper)", () => {
  it("uses Africa/Lagos regardless of process timezone", () => {
    expect(stationDate(new Date("2026-10-20T23:00:00Z"))).toBe("2026-10-21");
    expect(formatStationDateTime(new Date("2026-10-21T09:42:00Z"))).toBe(
      "21 Oct 2026 · 10:42 AM",
    );
    expect(
      nextStationMidnight(new Date("2026-12-31T22:59:59Z")).toISOString(),
    ).toBe("2026-12-31T23:00:00.000Z");
  });
  it("accepts same-day receipt before midnight and routes midnight and later to review", () => {
    const sale = new Date("2026-10-21T10:00:00Z");
    expect(
      canAutoApplyCorrection(sale, new Date("2026-10-21T22:59:59.999Z")),
    ).toBe(true);
    expect(canAutoApplyCorrection(sale, new Date("2026-10-21T23:00:00Z"))).toBe(
      false,
    );
    expect(canAutoApplyCorrection(sale, new Date("2026-10-22T10:00:00Z"))).toBe(
      false,
    );
    expect(canAutoApplyCorrection(sale, new Date("2026-10-21T09:59:59Z"))).toBe(
      false,
    );
  });
  it("handles leap day and rejects invalid instants", () => {
    expect(
      nextStationMidnight(new Date("2028-02-29T12:00:00Z")).toISOString(),
    ).toBe("2028-02-29T23:00:00.000Z");
    expect(() => stationDate(new Date(NaN))).toThrow();
    expect(() => canAutoApplyCorrection(new Date(), new Date(NaN))).toThrow();
  });
});

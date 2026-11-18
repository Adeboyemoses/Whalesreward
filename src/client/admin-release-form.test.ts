import { describe, expect, it } from "vitest";
import {
  releaseRange,
  releaseDecimal,
  releaseCanPropose,
} from "./admin-release-form";
describe("paper attestation precision", () => {
  it("encodes the whole Lagos day without clamping to receipt", () =>
    expect(
      releaseRange({
        timeMode: "date",
        date: "2026-11-16",
        precision: "",
        fromDate: "",
        fromTime: "",
        throughDate: "",
        throughTime: "",
      }),
    ).toEqual({
      from: "2026-11-15T23:00:00.000Z",
      through: "2026-11-16T22:59:59.999Z",
      timezone: "Africa/Lagos",
    }));
  it("expands minute and second evidence instead of inventing exact instants", () => {
    expect(
      releaseRange({
        timeMode: "range",
        precision: "minute",
        date: "",
        fromDate: "2026-11-16",
        fromTime: "10:42",
        throughDate: "2026-11-16",
        throughTime: "10:42",
      }),
    ).toMatchObject({
      from: "2026-11-16T09:42:00.000Z",
      through: "2026-11-16T09:42:59.999Z",
    });
    expect(
      releaseRange({
        timeMode: "range",
        precision: "second",
        date: "",
        fromDate: "2026-11-16",
        fromTime: "10:42:05",
        throughDate: "2026-11-16",
        throughTime: "10:42:05",
      }),
    ).toMatchObject({ through: "2026-11-16T09:42:05.999Z" });
  });
  it("rejects impossible dates, unsupported precision and backwards ranges", () => {
    for (const date of ["2026-02-30", "2026-13-01"])
      expect(() =>
        releaseRange({
          timeMode: "date",
          date,
          precision: "",
          fromDate: "",
          fromTime: "",
          throughDate: "",
          throughTime: "",
        }),
      ).toThrow();
    expect(() =>
      releaseRange({
        timeMode: "range",
        date: "",
        precision: "minute",
        fromDate: "2026-11-16",
        fromTime: "10:42:01",
        throughDate: "2026-11-16",
        throughTime: "10:42:01",
      }),
    ).toThrow();
  });
  it("keeps exact decimal strings and rejects zero exponent negative or excess precision even zeroes", () => {
    expect(releaseDecimal("20000.01", "money", 2)).toBe("2000001");
    expect(releaseDecimal("1.234", "quantity", 3)).toBe("1.234");
    for (const s of ["0", "-1", "1e3", "1.000"])
      expect(() => releaseDecimal(s, "money", 2)).toThrow();
    expect(() => releaseDecimal("1.000", "quantity", 2)).toThrow();
  });
  it("never treats ordinary insufficiency as positive admission", () => {
    const p = {
      admission: { state: "ordinary_review_required" },
      proposerAccess: { allowed: true },
    };
    expect(releaseCanPropose(p as never, false)).toBe(false);
    p.admission.state = "structurally_admissible";
    expect(releaseCanPropose(p as never, false)).toBe(true);
    expect(releaseCanPropose(p as never, true)).toBe(false);
    p.proposerAccess.allowed = false;
    expect(releaseCanPropose(p as never, false)).toBe(false);
  });
});

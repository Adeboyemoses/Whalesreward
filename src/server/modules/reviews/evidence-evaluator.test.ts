import { describe, expect, it } from "vitest";
import {
  uniformSegments,
  intervalBounds,
  cardRelation,
  intervalDay,
} from "./evidence-evaluator";
describe("review-evidence-v1 exact closed interval", () => {
  it("uses frozen lookup only and caps receipt at original expiry", () => {
    expect(intervalBounds("10", "30", "20", "15")).toEqual({
      S: "10",
      R: "30",
      expiry: "20",
      L: "15",
      U: "20",
      precision: "microsecond",
    });
    expect(intervalBounds("10", "20", "20", null).U).toBe("20");
    expect(() => intervalBounds("30", "20", "40", null)).toThrow();
  });
  it("includes a rate activation at U and excludes strictly later events", () => {
    expect(
      uniformSegments(
        [
          { at: "0", value: "a" },
          { at: "20", value: "b" },
        ],
        "10",
        "20",
      ),
    ).toBeNull();
    expect(
      uniformSegments(
        [
          { at: "0", value: "a" },
          { at: "21", value: "b" },
        ],
        "10",
        "20",
      ),
    ).toBe("a");
    expect(
      uniformSegments(
        [
          { at: "0", value: "a" },
          { at: "20", value: "b" },
        ],
        "20",
        "20",
      ),
    ).toBe("b");
  });
  it("rejects missing anchors and contradictory timestamps", () => {
    expect(uniformSegments([{ at: "11", value: "a" }], "10", "20")).toBeNull();
    expect(
      uniformSegments(
        [
          { at: "0", value: "a" },
          { at: "0", value: "b" },
        ],
        "10",
        "20",
      ),
    ).toBeNull();
  });
  it("U=E cannot confirm, L=E cancels including singleton", () => {
    expect(cardRelation("10", "19", "20", "30")).toBe("before");
    expect(cardRelation("10", "20", "20", "30")).toBeNull();
    expect(cardRelation("20", "20", "20", "30")).toBe("after");
    expect(cardRelation("20", "20", "21", "20")).toBeNull();
  });
  it("midnight at U crosses calendar day at microsecond precision", () => {
    const m = BigInt(Date.parse("2026-11-05T23:00:00Z")) * 1000n;
    expect(intervalDay(String(m - 1n), String(m))).toBeNull();
    expect(intervalDay(String(m), String(m))).toBe("2026-11-06");
  });
});

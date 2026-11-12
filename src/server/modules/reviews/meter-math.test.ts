import { describe, expect, it } from "vitest";
import { compareMeterPair } from "./meter-math";
describe("P-26 exact unrounded meter arithmetic", () => {
  it.each([
    [
      "1234567",
      "11.223",
      "110000",
      "1",
      "0.001",
      true,
      "37000000",
      "111000000",
    ],
    [
      "1234585",
      "11.223",
      "110000",
      "1",
      "0.001",
      true,
      "55000000",
      "111000000",
    ],
    [
      "1234586",
      "11.223",
      "110000",
      "1",
      "0.001",
      false,
      "56000000",
      "111000000",
    ],
    [
      "1234475",
      "11.223",
      "110000",
      "1",
      "0.001",
      true,
      "55000000",
      "111000000",
    ],
    [
      "1234474",
      "11.223",
      "110000",
      "1",
      "0.001",
      false,
      "56000000",
      "111000000",
    ],
    [
      "1852000",
      "12.347",
      "150000",
      "1",
      "0.001",
      true,
      "50000000",
      "151000000",
    ],
    ["101152", "1.001", "101000", "1", "0.001", true, "51000000", "102000000"],
    ["101153", "1.001", "101000", "1", "0.001", false, "52000000", "102000000"],
    ["1", "0.005", "100", "1", "0.001", true, "500000", "1100000"],
  ])("compares %s/%s at %s exactly", (a, q, r, sa, sq, pass, d, t) => {
    const v = compareMeterPair(a, q, r, sa, sq, 3);
    expect(v.reconciled).toBe(pass);
    expect(v.residual).toEqual({ numerator: d, denominator: "1000000" });
    expect(v.allowance).toEqual({ numerator: t, denominator: "2000000" });
  });
  it.each([
    ["101", "1", "5", "0.001", 3],
    ["100", "1.001", "1", "0.010", 3],
    ["100", "1.001", "1", "0.01", 2],
  ])("rejects incompatible exact displays", (a, q, sa, sq, p) => {
    expect(() =>
      compareMeterPair(
        String(a),
        String(q),
        "100",
        String(sa),
        String(sq),
        Number(p),
      ),
    ).toThrow();
  });
});

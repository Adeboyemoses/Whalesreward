import { afterEach, describe, expect, it, vi } from "vitest";
import { cardOptions } from "./config";
afterEach(() => vi.unstubAllEnvs());
describe("D08 card export configuration", () => {
  it.each([
    undefined,
    "invalid",
    "{}",
    JSON.stringify({
      pageWidthMm: 0,
      pageHeightMm: 297,
      cardWidthMm: 85.6,
      cardHeightMm: 54,
      marginMm: 10,
      gapMm: 2,
    }),
    JSON.stringify({
      pageWidthMm: 40,
      pageHeightMm: 40,
      cardWidthMm: 85.6,
      cardHeightMm: 54,
      marginMm: 10,
      gapMm: 2,
    }),
  ])(
    "unconfigured/invalid layout remains unavailable while XLSX configuration works: %s",
    (raw) => {
      vi.stubEnv("WHR_CARD_PRINT_LAYOUT", raw);
      expect(cardOptions()).toMatchObject({
        layout: undefined,
        artifactLifetimeMs: 86400000,
      });
    },
  );
  it("accepts explicitly configured fitting physical dimensions and positive lifetime", () => {
    const layout = {
      pageWidthMm: 210,
      pageHeightMm: 297,
      cardWidthMm: 85.6,
      cardHeightMm: 54,
      marginMm: 10,
      gapMm: 2,
    };
    vi.stubEnv("WHR_CARD_PRINT_LAYOUT", JSON.stringify(layout));
    vi.stubEnv("WHR_CARD_EXPORT_LIFETIME_SECONDS", "60");
    expect(cardOptions()).toEqual({ layout, artifactLifetimeMs: 60000 });
  });
  it.each(["0", "-1", "NaN", "1.5", "Infinity"])(
    "rejects malformed artifact lifetime %s",
    (value) => {
      vi.stubEnv("WHR_CARD_EXPORT_LIFETIME_SECONDS", value);
      expect(() => cardOptions()).toThrow();
    },
  );
});

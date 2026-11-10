import { afterEach, describe, expect, it, vi } from "vitest";
import { getHealth } from "./service";

describe("deployment health", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("reports a successful database probe and the deployed version", async () => {
    vi.stubEnv("WHR_CARD_PRINT_LAYOUT", undefined);
    vi.stubEnv("APP_VERSION", "fictional-commit");
    expect(await getHealth(async () => {})).toEqual({
      ok: true,
      version: "fictional-commit",
      db: "ok",
      cardPrint: "unconfigured",
    });
    vi.unstubAllEnvs();
  });
  it("returns only a generic failure when database access fails", async () => {
    const result = await getHealth(async () => {
      throw new Error("postgresql://fictional:password@example.com/database");
    });
    expect(result).toMatchObject({ ok: false, db: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("password");
    expect(JSON.stringify(result)).not.toContain("example.com");
  });
});

const layout = {
  pageWidthMm: 210,
  pageHeightMm: 297,
  cardWidthMm: 85.6,
  cardHeightMm: 54,
  marginMm: 10,
  gapMm: 2,
};
it.each([
  undefined,
  "",
  "private-layout-canary",
  "null",
  JSON.stringify({ ...layout, pageWidthMm: 0 }),
])("WHR-99 health reports invalid layout without values: %s", async (raw) => {
  vi.stubEnv("WHR_CARD_PRINT_LAYOUT", raw);
  try {
    const health = await getHealth(async () => {});
    expect(health).toMatchObject({ ok: true, cardPrint: "unconfigured" });
    expect(JSON.stringify(health)).not.toContain("private-layout-canary");
    expect(JSON.stringify(health)).not.toContain("pageWidthMm");
  } finally {
    vi.unstubAllEnvs();
  }
});
it("WHR-99 valid layout flag is independent of export lifetime and database health", async () => {
  vi.stubEnv("WHR_CARD_PRINT_LAYOUT", JSON.stringify(layout));
  vi.stubEnv("WHR_CARD_EXPORT_LIFETIME_SECONDS", "invalid");
  try {
    for (const probe of [
      async () => {},
      async () => {
        throw new Error("private-canary");
      },
    ]) {
      const health = await getHealth(probe);
      expect(health).toMatchObject({ cardPrint: "configured" });
      expect(JSON.stringify(health)).not.toContain("pageWidthMm");
      expect(JSON.stringify(health)).not.toContain("private-canary");
    }
  } finally {
    vi.unstubAllEnvs();
  }
});

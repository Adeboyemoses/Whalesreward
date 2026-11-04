import { describe, expect, it, vi } from "vitest";
import { getHealth } from "./service";

describe("deployment health", () => {
  it("reports a successful database probe and the deployed version", async () => {
    vi.stubEnv("APP_VERSION", "fictional-commit");
    expect(await getHealth(async () => {})).toEqual({
      ok: true,
      version: "fictional-commit",
      db: "ok",
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

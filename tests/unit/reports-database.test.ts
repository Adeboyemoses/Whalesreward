import { afterEach, describe, expect, it, vi } from "vitest";
import { localTestDatabase } from "../reports/local-database";

// This pure guard imports no driver, fixture or process launcher: no network is used.
describe("WHR-149 reports fixture database boundary", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("accepts the ordinary bare local test database URL without opening a connection", () => {
    vi.stubEnv("WHR_ENV", "local");
    const raw = "postgresql://whr:whr@127.0.0.1:5433/whr_e2e";
    expect(localTestDatabase(raw).toString()).toBe(raw);
  });
  it.each([
    "?host=remote.example.com",
    "?%68ost=remote.example.com",
    "?host=localhost&host=remote.example.com",
    "?application_name=caller-supplied",
  ])(
    "rejects caller query parameters before a pg connection can be constructed: %s",
    (query) => {
      vi.stubEnv("WHR_ENV", "local");
      expect(() =>
        localTestDatabase(
          `postgresql://whr:whr@127.0.0.1:5433/whr_e2e${query}`,
        ),
      ).toThrow("explicitly local test database");
    },
  );
  it("continues to reject a remote host and deployed environment", () => {
    vi.stubEnv("WHR_ENV", "local");
    expect(() =>
      localTestDatabase("postgresql://whr:whr@remote.example.com/whr_e2e"),
    ).toThrow();
    vi.stubEnv("WHR_ENV", "production");
    expect(() =>
      localTestDatabase("postgresql://whr:whr@127.0.0.1/whr_e2e"),
    ).toThrow();
  });
});

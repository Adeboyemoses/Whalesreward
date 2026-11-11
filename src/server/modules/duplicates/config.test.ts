import { describe, it, expect } from "vitest";
import { duplicateWindow } from "./config";
const station = "019a0000-0000-7000-8000-000000000001";
const env = {
  DUPLICATE_WINDOW_STATION_ID: station,
  DUPLICATE_WINDOW_POLICY: JSON.stringify({ version: 1, windowSeconds: 600 }),
};
describe("P-24 duplicate window configuration", () => {
  it("requires explicit station binding and valid policy", () => {
    expect(duplicateWindow(env, station)).toEqual({
      version: 1,
      windowSeconds: 600,
    });
    expect(
      duplicateWindow(env, "019a0000-0000-7000-8000-000000000002"),
    ).toBeNull();
    expect(duplicateWindow({})).toBeNull();
  });
  it.each([
    null,
    {},
    { version: 1, windowSeconds: "600" },
    { version: 1, windowSeconds: 0 },
    { version: 1, windowSeconds: 86401 },
    { version: 1.5, windowSeconds: 600 },
    { version: 1, windowSeconds: 600, extra: true },
  ])("rejects malformed %j", (policy) => {
    expect(
      duplicateWindow({
        ...env,
        DUPLICATE_WINDOW_POLICY: JSON.stringify(policy),
      }),
    ).toBeNull();
  });
});

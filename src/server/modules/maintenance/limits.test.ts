import { expect, it } from "vitest";
import { maintenanceLimits } from "./types";
it("maintenance bounds cannot exceed ten minutes or provider/page safety caps", () => {
  expect(maintenanceLimits().sliceMs).toBe(600000);
  expect(() => maintenanceLimits({ sliceMs: 600001 })).toThrow();
  expect(() => maintenanceLimits({ pageSize: 1001 })).toThrow();
  expect(() => maintenanceLimits({ maxPages: 0 })).toThrow();
  expect(() => maintenanceLimits({ objectDeadlineMs: Infinity })).toThrow();
});

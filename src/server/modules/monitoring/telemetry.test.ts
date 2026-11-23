import { expect, it } from "vitest";
import { createTelemetry, withOperationalTelemetry } from "./telemetry";
it("keeps five bounded minute counters, separates faults from 4xx, and expires old data", () => {
  const t = createTelemetry();
  for (let i = 0; i < 20; i++) t.record(i === 0 ? 500 : i === 1 ? 429 : 200, 0);
  expect(t.snapshot(0)).toMatchObject({
    requests: 20,
    serverErrors: 1,
    throttled: 1,
    alert: true,
  });
  expect(t.snapshot(300000)).toMatchObject({
    requests: 0,
    serverErrors: 0,
    alert: false,
  });
});
it("counts final response status and catches unhandled exceptions without revealing request/error", async (_request: Request) => {
  const response = await withOperationalTelemetry(async (_request: Request) => {
    throw new Error("PRIVATE_08012345678");
  })(new Request("http://localhost/?secret=PRIVATE"));
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("PRIVATE");
  expect(response.headers.get("cache-control")).toBe("no-store");
});

import { expect, it } from "vitest";
import { createTelemetry, withOperationalTelemetry } from "./telemetry";
it("keeps bounded five-minute counters, separates faults from 4xx, and expires old data", () => {
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
it("counts final response status and catches unhandled exceptions without revealing request/error", async () => {
  const response = await withOperationalTelemetry(async (_request: Request) => {
    void _request;
    throw new Error("PRIVATE_08012345678");
  })(new Request("http://localhost/?secret=PRIVATE"));
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("PRIVATE");
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("sanitizes errors raised after response return and preserves headers and null bodies", async () => {
  const wrapped = withOperationalTelemetry(
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new Error("STREAM_SECRET_08012345678"));
          },
        }),
        { headers: { "X-Fixture": "preserved" } },
      ),
  );
  const response = await wrapped();
  expect(response.headers.get("x-fixture")).toBe("preserved");
  await expect(response.text()).rejects.toThrow("Response stream unavailable");
  const empty = await withOperationalTelemetry(
    () => new Response(null, { status: 204 }),
  )();
  expect(empty.status).toBe(204);
  expect(empty.body).toBeNull();
});
it("retains all errors within the exact five-minute window across a minute boundary", () => {
  const t = createTelemetry();
  for (let i = 0; i < 5; i++) t.record(500, 59000);
  expect(t.snapshot(300000)).toMatchObject({
    requests: 5,
    serverErrors: 5,
    alert: true,
  });
  expect(t.snapshot(358999)).toMatchObject({
    requests: 5,
    serverErrors: 5,
    alert: true,
  });
  expect(t.snapshot(359000)).toMatchObject({
    requests: 0,
    serverErrors: 0,
    alert: false,
  });
});
it("expires only events at or before the rolling cutoff and preserves status totals", () => {
  const t = createTelemetry();
  t.record(500, 0);
  t.record(200, 59000);
  t.record(429, 60000);
  expect(t.snapshot(300000)).toMatchObject({
    requests: 2,
    serverErrors: 0,
    throttled: 1,
    alert: false,
  });
  expect(t.snapshot(359000)).toMatchObject({
    requests: 1,
    serverErrors: 0,
    throttled: 1,
  });
  expect(t.snapshot(360000)).toMatchObject({
    requests: 0,
    serverErrors: 0,
    throttled: 0,
  });
});
it("resets incomplete coverage on a backward clock jump instead of retaining future events", () => {
  const t = createTelemetry();
  t.record(500, 100);
  expect(t.snapshot(99)).toMatchObject({ requests: 0, serverErrors: 0 });
  t.record(429, 99);
  expect(t.snapshot(100)).toMatchObject({
    requests: 1,
    serverErrors: 0,
    throttled: 1,
  });
});

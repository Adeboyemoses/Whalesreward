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

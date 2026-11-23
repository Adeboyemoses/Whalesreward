import { logger } from "../../lib/logger";
/** Five minute, pathless per-process counters. Restarts reset coverage; never a fleet total. */
export function createTelemetry() {
  const buckets = new Map<
    number,
    { requests: number; serverErrors: number; throttled: number }
  >();
  const prune = (now: number) => {
    for (const minute of buckets.keys())
      if (
        minute <= Math.floor(now / 60000) - 5 ||
        minute > Math.floor(now / 60000)
      )
        buckets.delete(minute);
  };
  return {
    record(status: number, now = Date.now()) {
      prune(now);
      const minute = Math.floor(now / 60000);
      const b = buckets.get(minute) ?? {
        requests: 0,
        serverErrors: 0,
        throttled: 0,
      };
      b.requests++;
      if (status >= 500) b.serverErrors++;
      if (status === 429) b.throttled++;
      buckets.set(minute, b);
    },
    snapshot(now = Date.now()) {
      prune(now);
      const total = { requests: 0, serverErrors: 0, throttled: 0 };
      for (const b of buckets.values()) {
        total.requests += b.requests;
        total.serverErrors += b.serverErrors;
        total.throttled += b.throttled;
      }
      return {
        ...total,
        alert:
          total.serverErrors >= 5 ||
          (total.requests >= 20 &&
            total.serverErrors * 100 > total.requests * 2),
      };
    },
  };
}
const state = globalThis as typeof globalThis & {
  __whrTelemetry?: ReturnType<typeof createTelemetry>;
};
export const operationalTelemetry = (state.__whrTelemetry ??=
  createTelemetry());
export function withOperationalTelemetry<Args extends unknown[]>(
  handler: (...args: Args) => Response | Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    let response: Response;
    try {
      response = await handler(...args);
    } catch {
      logger.error({ event: "api.unhandled_failure", errors: 1 });
      response = Response.json(
        {
          error: {
            code: "temporarily_unavailable",
            message: "This request could not be completed.",
            retryable: true,
          },
        },
        {
          status: 500,
          headers: { "Cache-Control": "no-store", Vary: "Cookie" },
        },
      );
    }
    const previouslyAlerting = operationalTelemetry.snapshot().alert;
    operationalTelemetry.record(response.status);
    if (!previouslyAlerting && operationalTelemetry.snapshot().alert)
      logger.warn({
        event: "api.error_threshold",
        ...operationalTelemetry.snapshot(),
      });
    if (!response.body) return response;
    const reader = response.body.getReader();
    const safeBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            controller.close();
            reader.releaseLock();
          } else controller.enqueue(chunk.value);
        } catch {
          logger.error({ event: "api.stream_failed", errors: 1 });
          controller.error(new Error("Response stream unavailable"));
          reader.releaseLock();
        }
      },
      async cancel() {
        try {
          await reader.cancel();
        } catch {
          /* Never propagate provider errors to framework logs. */
        } finally {
          reader.releaseLock();
        }
      },
    });
    return new Response(safeBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

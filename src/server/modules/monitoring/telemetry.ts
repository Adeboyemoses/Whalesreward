import { logger } from "../../lib/logger";
/** Exact (now-300000ms, now] pathless per-process counters; never fleet totals.
 * Restarts and backward wall-clock jumps reset incomplete coverage. Equal-ms
 * observations share one bucket, so integer timestamps bound the FIFO to at most
 * 300000 buckets. Linked eviction plus running totals makes updates amortized O(1).
 */
export function createTelemetry() {
  type Counts = { requests: number; serverErrors: number; throttled: number };
  type Bucket = Counts & { at: number; next?: Bucket };
  let first: Bucket | undefined;
  let last: Bucket | undefined;
  let lastNow: number | undefined;
  const total: Counts = { requests: 0, serverErrors: 0, throttled: 0 };
  const prune = (now: number) => {
    if (!Number.isSafeInteger(now))
      throw new RangeError("Invalid telemetry clock");
    if (lastNow !== undefined && now < lastNow) {
      first = last = undefined;
      total.requests = total.serverErrors = total.throttled = 0;
    }
    lastNow = now;
    while (first && first.at <= now - 300000) {
      total.requests -= first.requests;
      total.serverErrors -= first.serverErrors;
      total.throttled -= first.throttled;
      first = first.next;
    }
    if (!first) last = undefined;
  };
  return {
    record(status: number, now = Date.now()) {
      prune(now);
      if (!last || last.at !== now) {
        const bucket: Bucket = {
          at: now,
          requests: 0,
          serverErrors: 0,
          throttled: 0,
        };
        if (last) last.next = bucket;
        else first = bucket;
        last = bucket;
      }
      last.requests++;
      total.requests++;
      if (status >= 500) {
        last.serverErrors++;
        total.serverErrors++;
      }
      if (status === 429) {
        last.throttled++;
        total.throttled++;
      }
    },
    snapshot(now = Date.now()) {
      prune(now);
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

import { afterEach, expect, it, vi } from "vitest";
import { installHandover } from "./handover.js";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup(responses: (boolean | null)[]) {
  const listeners: Record<string, (event: never) => void> = {};
  vi.stubGlobal(
    "MessageChannel",
    class {
      port1 = {
        onmessage: null as null | ((event: { data: boolean }) => void),
        close() {},
      };
      port2 = {
        postMessage: (data: boolean) => this.port1.onmessage?.({ data }),
      };
    },
  );
  const clients = responses.map((answer, i) => ({
    id: String(i),
    url: `https://fixture.example/attendant/sale`,
    postMessage: vi.fn((_data, ports) => {
      if (ports && answer !== null) ports[0].postMessage(answer);
    }),
  }));
  const scope = {
    addEventListener: (type: string, callback: never) => {
      listeners[type] = callback;
    },
    location: { origin: "https://fixture.example" },
    clients: {
      matchAll: vi.fn(async () => clients),
      claim: vi.fn(async () => {}),
    },
    skipWaiting: vi.fn(async () => {}),
  };
  installHandover(scope);
  let done: Promise<void> = Promise.resolve();
  function request(source = clients[0]) {
    listeners.message!({
      data: { type: "WHR_REQUEST_UPDATE" },
      source,
      waitUntil: (promise: Promise<void>) => {
        done = promise;
      },
    } as never);
    return () => done;
  }
  return { scope, request, clients };
}
it("never skips waiting on installation alone", () => {
  expect(setup([true]).scope.skipWaiting).not.toHaveBeenCalled();
});
it("activates only after every attendant tab confirms safe", async () => {
  const { scope, request } = setup([true, true]);
  await request()();
  expect(scope.skipWaiting).toHaveBeenCalledTimes(1);
});
it("refuses activation when any tab is capturing or has queued sales", async () => {
  const { scope, request } = setup([true, false]);
  await request()();
  expect(scope.skipWaiting).not.toHaveBeenCalled();
});
it("fails closed for an old or unresponsive attendant tab", async () => {
  vi.useFakeTimers();
  const { scope, request } = setup([true, null]);
  const done = request();
  await vi.advanceTimersByTimeAsync(2500);
  await done();
  expect(scope.skipWaiting).not.toHaveBeenCalled();
});
it("fails closed if a new attendant window appears during preparation", async () => {
  const { scope, request, clients } = setup([true]);
  scope.clients.matchAll
    .mockResolvedValueOnce(clients)
    .mockResolvedValueOnce([...clients, { ...clients[0]!, id: "new" }]);
  await request()();
  expect(scope.skipWaiting).not.toHaveBeenCalled();
});

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  route: vi.fn(),
  precache: vi.fn(),
}));
vi.mock("workbox-routing", () => ({ registerRoute: mocks.route }));
vi.mock("workbox-precaching", () => ({
  precacheAndRoute: vi.fn(),
  cleanupOutdatedCaches: vi.fn(),
  matchPrecache: mocks.precache,
}));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("generic attendant navigation deadline", () => {
  it("returns the cached capture shell after 1200 ms even when navigation never answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("self", {
      __WB_MANIFEST: [],
      location: { origin: "https://fixture.example" },
    });
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const shell = new Response("generic capture shell");
    mocks.precache.mockImplementation(async (path: string) =>
      path === "/attendant/sale" ? shell : undefined,
    );
    await import("./worker.js");
    const handler = mocks.route.mock.calls[0]![1];
    let result: Response | undefined;
    void handler({
      request: new Request(
        "https://fixture.example/attendant/sale/test/recorded",
      ),
      url: new URL("https://fixture.example/attendant/sale/test/recorded"),
    }).then((response: Response) => {
      result = response;
    });
    await vi.advanceTimersByTimeAsync(1199);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe(shell);
  });
  it("also bounds a stalled HTML body after the headers arrive", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("self", {
      __WB_MANIFEST: [],
      location: { origin: "https://fixture.example" },
    });
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream()));
    const shell = new Response("generic capture shell");
    mocks.precache.mockImplementation(async () => shell);
    await import("./worker.js");
    let result: Response | undefined;
    void mocks.route.mock.calls[0]![1]({
      request: new Request(
        "https://fixture.example/attendant/sale/test/recorded",
      ),
      url: new URL("https://fixture.example/attendant/sale/test/recorded"),
    }).then((response: Response) => {
      result = response;
    });
    await vi.advanceTimersByTimeAsync(1200);
    expect(result).toBe(shell);
  });
  it("preserves a received HTTP denial rather than falling back over it", async () => {
    vi.stubGlobal("self", {
      __WB_MANIFEST: [],
      location: { origin: "https://fixture.example" },
    });
    vi.stubGlobal("fetch", async () => new Response("Denied", { status: 403 }));
    await import("./worker.js");
    const result: Response = await mocks.route.mock.calls[0]![1]({
      request: new Request(
        "https://fixture.example/attendant/sale/test/recorded",
      ),
      url: new URL("https://fixture.example/attendant/sale/test/recorded"),
    });
    expect(result.status).toBe(403);
    expect(await result.text()).toBe("Denied");
    expect(mocks.precache).not.toHaveBeenCalled();
  });
});

it("serves only the generic registration shell offline and never intercepts phone lookup APIs", async () => {
  vi.stubGlobal("self", {
    __WB_MANIFEST: [],
    location: { origin: "https://fixture.example" },
  });
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
  const register = new Response("generic register shell");
  mocks.precache.mockImplementation(async (path: string) =>
    path === "/attendant/register" ? register : undefined,
  );
  await import("./worker.js");
  const [match, handle] = mocks.route.mock.calls[0]!;
  const url = new URL("https://fixture.example/attendant/register");
  expect(match({ request: { mode: "navigate" }, url })).toBe(true);
  expect(
    match({
      request: { mode: "cors" },
      url: new URL("https://fixture.example/api/attendant/customers/lookup"),
    }),
  ).toBe(false);
  const result = await handle({
    request: new Request(url),
    url: new URL(url + "/customer/done"),
  });
  expect(result).toBe(register);
  expect(mocks.precache).not.toHaveBeenCalledWith(
    "/api/attendant/customers/lookup",
  );
});

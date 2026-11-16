import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../auth/errors";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  permission: vi.fn(),
  limits: vi.fn(),
  propose: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  decide: vi.fn(),
  photoAccess: vi.fn(),
  reserve: vi.fn(),
  uploadUrl: vi.fn(),
  finalize: vi.fn(),
}));
vi.mock("../../lib/db", () => ({ database: () => ({}) }));
vi.mock("../sync/repo", () => ({
  transaction: (_: unknown, run: (db: unknown) => unknown) => run({}),
}));
vi.mock("../../lib/authz", () => ({
  securityLock: vi.fn(),
  requireAdminSession: mocks.session,
  requirePermission: mocks.permission,
}));
vi.mock("../admin-access/config", () => ({
  adminConfig: () => ({
    origin: "https://station.example.com",
    secret: "fictional-test-secret",
  }),
}));
vi.mock("../admin-access/http", () => ({
  cookieToken: () => "fictional-session",
}));
vi.mock("../auth/rate-limit", () => ({ consumeLimits: mocks.limits }));
vi.mock("../corrections/http", () => ({ correctionStorage: {} }));
vi.mock("./release-service", () => ({ createHeldReleaseService: () => mocks }));
vi.mock("./release-uploads", () => ({
  createReleaseUploadsService: () => mocks,
}));
import { handleHeldRelease } from "./release-http";
import { handleReleaseUpload } from "./release-upload-http";
const id = "019a5000-0000-7000-8000-000000000001";
const reservation = {
  operationId: id,
  target: { kind: "price", holdId: id, expectedHoldVersion: 1 },
  sha256: "a".repeat(64),
  bytes: 10,
  contentType: "image/jpeg",
};
const actions = [
  "propose",
  "list",
  "get",
  "decide",
  "photoAccess",
  "reserve",
  "url",
  "finalize",
] as const;
type Action = (typeof actions)[number];
function request(
  action: Action,
  body?: string,
  headers: Record<string, string> = {},
  query = "",
) {
  return new Request(`https://station.example.com/api/test${query}`, {
    method: action === "list" || action === "get" ? "GET" : "POST",
    headers: {
      origin: "https://station.example.com",
      "content-type": "application/json",
      ...headers,
    },
    ...(action === "list" || action === "get"
      ? {}
      : {
          body: body ?? JSON.stringify(action === "reserve" ? reservation : {}),
        }),
  });
}
function handle(action: Action, req: Request, purchaseId = id) {
  return action === "reserve" || action === "url" || action === "finalize"
    ? handleReleaseUpload(req, purchaseId, action, id)
    : handleHeldRelease(req, action, purchaseId, id);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user_id: id });
  mocks.propose.mockResolvedValue({ proposal: { id }, replayed: false });
  mocks.reserve.mockResolvedValue({
    data: { uploadId: id, assetId: id },
    replayed: false,
  });
  for (const key of [
    "list",
    "get",
    "decide",
    "photoAccess",
    "uploadUrl",
    "finalize",
  ] as const)
    mocks[key].mockResolvedValue({ id });
});
describe("held release HTTP boundaries", () => {
  it.each(actions)(
    "SR-03 %s requires a fresh session and emits only safe failure metadata",
    async (action) => {
      mocks.session.mockRejectedValue(new AuthError("session_required", 401));
      const response = await handle(action, request(action));
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(await response.json()).toMatchObject({
        error: { code: "session_required", retryable: false },
      });
      expect(mocks.limits).not.toHaveBeenCalled();
    },
  );
  it.each(actions)(
    "SR-03 %s rejects malformed route identity before authority or service execution",
    async (action) => {
      expect(
        (await handle(action, request(action), "foreign-secret")).status,
      ).toBe(400);
      expect(mocks.session).not.toHaveBeenCalled();
    },
  );
  it.each(actions)(
    "SR-04 %s hides unexpected server details and returns retryable503",
    async (action) => {
      mocks.limits.mockRejectedValue(new Error("private-sheet-path-canary"));
      const response = await handle(action, request(action));
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(text).toContain('"retryable":true');
      expect(text).not.toContain("private-sheet-path-canary");
    },
  );
  it.each(actions)(
    "SR-04 %s preserves rate-limit retry timing without invoking the service",
    async (action) => {
      mocks.limits.mockRejectedValue(new AuthError("rate_limited", 429, 17));
      const response = await handle(action, request(action));
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("17");
      expect(mocks.propose).not.toHaveBeenCalled();
      expect(mocks.reserve).not.toHaveBeenCalled();
    },
  );
  const mutations = actions.filter((a) => a !== "list" && a !== "get");
  it.each(mutations)(
    "SR-03 %s rejects cross-origin writes before loading authority",
    async (action) => {
      const response = await handle(
        action,
        request(action, undefined, { origin: "https://foreign.example.com" }),
      );
      expect(response.status).toBe(403);
      expect(mocks.session).not.toHaveBeenCalled();
    },
  );
  it.each(mutations)(
    "SR-04 %s enforces streamed32KiB metadata and JSON content type",
    async (action) => {
      expect(
        (await handle(action, request(action, "x".repeat(32769)))).status,
      ).toBe(413);
      expect((await handle(action, request(action, "{broken"))).status).toBe(
        400,
      );
      expect(
        (
          await handle(
            action,
            request(action, "{}", { "content-type": "text/plain" }),
          )
        ).status,
      ).toBe(400);
    },
  );
  it("SR-08 duplicate list query keys are rejected rather than silently overwritten", async () => {
    const response = await handle(
      "list",
      request("list", undefined, {}, "?limit=1&limit=100"),
    );
    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("SR-05 creation returns201 but a durable proposal or reservation replay returns200", async () => {
    for (const action of ["propose", "reserve"] as const) {
      expect((await handle(action, request(action))).status).toBe(201);
      mocks[action].mockResolvedValue({
        proposal: { id },
        data: { assetId: id, uploadId: id },
        replayed: true,
      });
      expect((await handle(action, request(action))).status).toBe(200);
    }
  });
  it("SR-04 URL issuance applies its purchase-bound10request limit", async () => {
    for (const action of ["photoAccess", "url"] as const) {
      await handle(action, request(action));
      expect(mocks.limits.mock.lastCall?.[2]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            capacity: 10,
            key: expect.stringContaining(id),
          }),
        ]),
      );
    }
  });
});

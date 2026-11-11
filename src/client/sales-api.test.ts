import { describe, expect, it } from "vitest";
import { v7 } from "uuid";
import { HttpAttendantSalesApi } from "./sales-api";
import { ClientError } from "./types";
const envelope = (data: unknown) =>
  JSON.stringify({ data, serverTime: "2026-11-11T10:00:00Z", requestId: v7() });
describe("attendant sales transport", () => {
  it("requests ephemeral same-origin sales without cache and validates strict data", async () => {
    let init: RequestInit | undefined;
    const api = new HttpAttendantSalesApi(
      async (_url, options) => {
        init = options;
        return new Response(envelope({ items: [], nextCursor: null }));
      },
      () => () => {},
    );
    expect(await api.list()).toEqual({ items: [], nextCursor: null });
    expect(init).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    const invalid = new HttpAttendantSalesApi(
      async () =>
        new Response(
          envelope({ items: [], nextCursor: null, phone: "forbidden" }),
        ),
      () => () => {},
    );
    await expect(invalid.list()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
  it("fetches only a same-origin photo stream and rejects non-JPEG success bodies", async () => {
    let path: RequestInfo | URL | undefined;
    const api = new HttpAttendantSalesApi(
      async (url) => {
        path = url;
        return new Response("jpeg", {
          headers: { "Content-Type": "image/jpeg" },
        });
      },
      () => () => {},
    );
    expect((await api.photo(v7())).type).toBe("image/jpeg");
    expect(String(path)).toMatch(/^\/api\/attendant\/sales\/[^/]+\/photo$/);
    const invalid = new HttpAttendantSalesApi(
      async () => new Response("<html>"),
      () => () => {},
    );
    await expect(invalid.photo(v7())).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
  it.each([
    "correction_pending",
    "sale_not_correctable",
    "no_change",
    "base_revision_changed",
    "version_conflict",
    "evidence_unavailable",
  ])("preserves %s domain code without server narrative", async (code) => {
    const api = new HttpAttendantSalesApi(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code,
              message: "private server narrative",
              retryable: false,
            },
          }),
          { status: 409 },
        ),
      () => () => {},
    );
    await expect(api.detail(v7())).rejects.toMatchObject({ code, status: 409 });
    try {
      await api.detail(v7());
    } catch (e) {
      expect(e).toBeInstanceOf(ClientError);
      expect((e as Error).message).not.toContain("private server narrative");
    }
  });
  it("treats unreadable failure and malformed success as uncertain without inventing domain absence", async () => {
    const api = new HttpAttendantSalesApi(
      async () => new Response("unavailable", { status: 503 }),
      () => () => {},
    );
    await expect(api.correction(v7(), v7())).rejects.toMatchObject({
      code: "temporarily_unavailable",
      status: 503,
    });
    const malformed = new HttpAttendantSalesApi(
      async () => new Response("broken"),
      () => () => {},
    );
    await expect(malformed.list()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { HttpAttendantApi } from "./api";
import { sessionFixture } from "../../tests/fixtures/attendant-client-fake";
const session = sessionFixture(Date.parse("2026-11-04T10:00:00Z"));
function reply(data: unknown) {
  return new Response(
    JSON.stringify({
      data,
      serverTime: session.serverTime,
      requestId: uuidv7(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
describe("M1 typed HTTP adapter", () => {
  it("reports transport failure without turning an HTTP revocation into an offline result", async () => {
    const outcome = vi.fn();
    const unavailable = new HttpAttendantApi(
      async () => {
        throw new TypeError("connection lost");
      },
      () => outcome,
    );
    await expect(unavailable.session()).rejects.toMatchObject({
      code: "network_unavailable",
    });
    expect(outcome).toHaveBeenLastCalledWith(false);
    const revoked = new HttpAttendantApi(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "unauthenticated",
              message: "Sign in",
              retryable: false,
            },
          }),
          { status: 401 },
        ),
      () => outcome,
    );
    await expect(revoked.session()).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(outcome).toHaveBeenLastCalledWith(true);
  });
  it("does not announce offline when a caller cancels an upload request", async () => {
    const outcome = vi.fn();
    const controller = new AbortController();
    const api = new HttpAttendantApi(
      async () => {
        controller.abort();
        throw new DOMException("Cancelled", "AbortError");
      },
      () => outcome,
    );
    await expect(
      api.saleStatus(uuidv7(), controller.signal),
    ).rejects.toMatchObject({ code: "network_unavailable" });
    expect(outcome).not.toHaveBeenCalled();
  });
  it("uses no-store same-origin cookie transport and a sign-in idempotency key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply(session));
    const api = new HttpAttendantApi(fetcher);
    const key = uuidv7();
    const body = {
      username: "grace.okon",
      password: " fictional ",
      deviceId: uuidv7(),
    };
    expect(await api.signIn(body, key)).toEqual(session);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/attendant/sign-in",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      }),
    );
  });
  it("rejects contract-shaped but untrusted session extension and unknown fields", async () => {
    const api = new HttpAttendantApi(async () =>
      reply({ ...session, offlineExpiresAt: "2026-11-06T10:00:00Z" }),
    );
    await expect(api.session()).rejects.toMatchObject({
      code: "invalid_response",
    });
    const other = new HttpAttendantApi(async () =>
      reply({ ...session, accessToken: "must-not-be-persisted" }),
    );
    await expect(other.session()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
  it("never echoes server error payload details and distinguishes retryable network from not found", async () => {
    const api = new HttpAttendantApi(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "customer_not_found",
              message: "private submitted content",
              retryable: false,
            },
          }),
          { status: 404 },
        ),
    );
    await expect(
      api.lookup({ source: "code", code: "A7K3M9X" }),
    ).rejects.toMatchObject({
      code: "customer_not_found",
      message:
        "No customer has this card. Check the printed code, or scan the QR.",
    });
    const offline = new HttpAttendantApi(async () => {
      throw new TypeError("offline");
    });
    await expect(offline.session()).rejects.toMatchObject({
      code: "network_unavailable",
    });
  });
  it("requires 204 for signout and sends its key without storing credentials", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    await new HttpAttendantApi(fetcher).signOut("operation-key");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/attendant/sign-out",
      expect.objectContaining({
        body: "{}",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "operation-key",
        },
      }),
    );
  });
});

describe("M2 attendant restricted access", () => {
  it("validates restricted responses without inventing ready capture data", async () => {
    const restricted = {
      state: "password_change_required",
      account: session.account,
      serverTime: session.serverTime,
      sessionExpiresAt: new Date(
        Date.parse(session.serverTime) + 900000,
      ).toISOString(),
    };
    expect(
      await new HttpAttendantApi(async () => reply(restricted)).session(),
    ).toEqual(restricted);
    await expect(
      new HttpAttendantApi(async () =>
        reply({ ...restricted, captureContextId: uuidv7() }),
      ).session(),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("posts exact first-password fields and accepts only an empty 204 completion", async () => {
    const input = {
      operationId: uuidv7(),
      currentPassword: " fictional current ",
      newPassword: " different 密碼 ",
      confirmPassword: " different 密碼 ",
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    await new HttpAttendantApi(fetcher).completeFirstPassword(input);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/attendant/first-password",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        body: JSON.stringify(input),
      }),
    );
    await expect(
      new HttpAttendantApi(async () => reply(null)).completeFirstPassword(
        input,
      ),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("keeps an unassigned sign-in failure generic instead of echoing server identity or history", async () => {
    const api = new HttpAttendantApi(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "assignment_unavailable",
              message: "private offboarding reason and pump",
              retryable: false,
            },
          }),
          { status: 422 },
        ),
    );
    await expect(
      api.signIn(
        { username: "fictional", password: "fictional", deviceId: uuidv7() },
        uuidv7(),
      ),
    ).rejects.toMatchObject({
      code: "assignment_unavailable",
      message: "Sign-in is unavailable. Ask a station manager for help.",
    });
  });
});

describe("build mismatch", () => {
  it.each(["session", "signIn"] as const)(
    "explains a newer server shape for %s",
    async (method) => {
      const response = reply({ unknownNewState: true });
      response.headers.set("x-whr-build", "new-server-build");
      const api = new HttpAttendantApi(async () => response);
      await expect(
        method === "session"
          ? api.session()
          : api.signIn(
              {
                username: "grace.okon",
                password: "fictional",
                deviceId: uuidv7(),
              },
              uuidv7(),
            ),
      ).rejects.toMatchObject({
        code: "app_update_required",
        message: "A newer version is ready. Reload to continue.",
      });
    },
  );
});

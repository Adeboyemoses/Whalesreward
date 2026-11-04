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

import { describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { HttpAttendantApi } from "./api";
import type { SaleStatus } from "./types";
const now = "2026-11-05T00:00:00Z";
const status: SaleStatus = {
  purchaseId: uuidv7(),
  operationId: uuidv7(),
  saleCode: "S001",
  version: 1,
  state: "photo_pending",
  detailsReceived: true,
  photoValidated: false,
  credited: false,
  currentRevisionId: null,
  customer: { id: uuidv7(), name: "Amina Bello", category: "car_owner" },
  holds: [],
  cancellationReason: null,
  pendingReason: "photo_required",
  serverReceivedAt: now,
};
function response(data: unknown, httpStatus = 200, headers = {}) {
  return new Response(
    JSON.stringify({ data, serverTime: now, requestId: uuidv7() }),
    { status: httpStatus, headers },
  );
}
describe("M1 sync transport", () => {
  it("rejects credit without validated photo, customer, revision and clear holds", async () => {
    const api = new HttpAttendantApi(async () =>
      response({ ...status, state: "credited", credited: true }),
    );
    await expect(api.saleStatus(status.operationId)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
  it("keeps Retry-After from accepted finalizing responses", async () => {
    const api = new HttpAttendantApi(async () =>
      response(
        { ...status, state: "finalizing", pendingReason: "validation_pending" },
        202,
        { "Retry-After": "12" },
      ),
    );
    expect((await api.saleStatus(status.operationId)).retryAfterMs).toBe(12000);
  });
  it("keeps throttling metadata without exposing server message", async () => {
    const api = new HttpAttendantApi(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "rate_limited",
              message: "private",
              retryable: true,
            },
            serverTime: now,
            requestId: uuidv7(),
          }),
          { status: 429, headers: { "Retry-After": "30" } },
        ),
    );
    await expect(api.saleStatus(status.operationId)).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
      retryAfterMs: 30000,
      retryable: true,
    });
  });
  it("uploads bytes with signed headers and no cookies, redirect or HTTP cache", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const blob = new Blob(["photo"], { type: "image/jpeg" });
    const permission = {
      uploadId: uuidv7(),
      method: "PUT" as const,
      url: "https://storage.example.com/staging",
      headers: { "Content-Type": "image/jpeg" },
      expiresAt: now,
      maxBytes: 100,
    };
    await new HttpAttendantApi(transport).uploadPhoto(permission, blob);
    expect(transport).toHaveBeenCalledWith(
      permission.url,
      expect.objectContaining({
        method: "PUT",
        body: blob,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        headers: permission.headers,
      }),
    );
  });
  it("rejects unsafe upload permissions and unknown status fields", async () => {
    const api = new HttpAttendantApi(async () =>
      response({
        uploadId: uuidv7(),
        method: "PUT",
        url: "http://example.com/private",
        headers: {},
        expiresAt: now,
        maxBytes: 100,
      }),
    );
    await expect(
      api.uploadPermission(status.purchaseId, {
        operationId: uuidv7(),
        sha256: "a".repeat(64),
        bytes: 5,
        mediaType: "image/jpeg",
      }),
    ).rejects.toMatchObject({ code: "invalid_response" });
    const other = new HttpAttendantApi(async () =>
      response({ ...status, secret: "x" }),
    );
    await expect(other.saleStatus(status.operationId)).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});

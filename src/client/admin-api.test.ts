import { afterEach, expect, it, vi } from "vitest";
import { adminRequest, AdminError } from "./admin-api";
import { z } from "zod";
import {
  CustomerAdminApi,
  freezeCustomerChange,
  customerChangeIsUncertain,
  customerMessage,
} from "./customer-admin-api";

afterEach(() => vi.unstubAllGlobals());

it.each([502, 503, 504])(
  "classifies a non-JSON HTTP %i as unavailable without exposing its body",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>private edge details</html>", {
            status,
            headers: { "Content-Type": "text/html" },
          }),
      ),
    );
    const error = await adminRequest("card-batches/example/exports", {
      operationId: "fictional",
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AdminError);
    expect(error).toMatchObject({ code: "unavailable", status });
    expect(customerChangeIsUncertain(error)).toBe(true);
    expect(customerMessage(error)).toContain("do not assume it failed");
    expect(customerMessage(error)).toContain("Retry the same request");
    expect(String(error)).not.toContain("private edge details");
  },
);

it("retains the frozen operation after an unreadable non-OK response rather than authorizing a new operation", async () => {
  const change = freezeCustomerChange("card-batches/example/exports", {
    format: "pdf",
    expectedVersion: 1,
  });
  const transport = vi
    .fn()
    .mockResolvedValueOnce(
      new Response("<html>private rejection details</html>", { status: 400 }),
    )
    .mockResolvedValueOnce(Response.json({ data: { id: "same-export" } }));
  vi.stubGlobal("fetch", transport);
  const api = new CustomerAdminApi();
  const schema = z.strictObject({ id: z.string() });
  const error = await api
    .commit(change, schema)
    .catch((failure: unknown) => failure);
  expect(error).toMatchObject({ code: "unavailable", status: 400 });
  expect(customerChangeIsUncertain(error)).toBe(true);
  await expect(api.commit(change, schema)).resolves.toEqual({
    id: "same-export",
  });
  expect(transport.mock.calls[0]).toEqual(transport.mock.calls[1]);
  expect(JSON.parse(transport.mock.calls[1]![1].body)).toEqual(change.body);
});

it.each([
  "{",
  "null",
  "{}",
  "[]",
  '"unexpected"',
  '{"error":{"code":"unavailable"}}',
])(
  "keeps an OK malformed JSON or envelope %s invalid and uncertain",
  async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            status: 202,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const error = await adminRequest("card-batches/example/exports", {
      operationId: "fictional",
    }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "invalid_response", status: 202 });
    expect(customerChangeIsUncertain(error)).toBe(true);
  },
);

it.each(["null", "{}", '{"error":{"code":42,"message":"private"}}'])(
  "treats an unreadable non-OK error envelope %s as unavailable",
  async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status: 503 })),
    );
    await expect(
      adminRequest("card-batches/example/exports", {}),
    ).rejects.toMatchObject({ code: "unavailable", status: 503 });
  },
);

it.each(["version_conflict", "permission_denied", "print_layout_unconfigured"])(
  "preserves structured domain refusal %s",
  async (code) => {
    const status = code === "print_layout_unconfigured" ? 503 : 409;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code, message: "private domain details" } },
          { status },
        ),
      ),
    );
    const error = await adminRequest("card-batches/example/exports", {}).catch(
      (failure: unknown) => failure,
    );
    expect(error).toMatchObject({ code, status });
    expect(customerChangeIsUncertain(error)).toBe(false);
    expect(customerMessage(error)).not.toContain("private domain details");
  },
);
it("uses no-store and never exposes server error details", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { error: { code: "last_owner", message: "private" } },
        { status: 409 },
      ),
    ),
  );
  await expect(adminRequest("users")).rejects.toMatchObject({
    message: "At least one active Owner must remain.",
  });
  expect(fetch).toHaveBeenCalledWith(
    "/api/admin/users",
    expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
  );
  vi.unstubAllGlobals();
});
it("network failure is an uncertain result without request details", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("private");
    }),
  );
  await expect(adminRequest("users", {})).rejects.toBeInstanceOf(AdminError);
  vi.unstubAllGlobals();
});

it("issues operation keys accepted by the server UUIDv7 contract", async () => {
  const { adminOperationId } = await import("./admin-api");
  const { authId } = await import("../shared/contracts/auth");
  const keys = Array.from({ length: 10 }, () => adminOperationId());
  expect(keys.every((key) => authId.safeParse(key).success)).toBe(true);
  expect(new Set(keys).size).toBe(keys.length);
});
it("formats trusted instants using the station calendar and readable action labels", async () => {
  const { adminTime, adminAction } = await import("./admin-display");
  expect(adminTime("2026-10-21T09:42:00.000Z")).toBe("21 Oct 2026 · 10:42 AM");
  expect(adminTime("2026-10-20T23:05:00.000Z")).toBe("21 Oct 2026 · 12:05 AM");
  expect(adminAction("password_changed")).toBe("Password changed");
});

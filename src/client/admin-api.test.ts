import { expect, it, vi } from "vitest";
import { adminRequest, AdminError } from "./admin-api";
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

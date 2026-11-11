import { afterEach, describe, expect, it, vi } from "vitest";
import { v7 } from "uuid";
import { AdminError, adminRequest } from "./admin-api";
import {
  customerChangeIsUncertain,
  customerFile,
  customerMessage,
} from "./customer-admin-api";
import { HttpRegistrationApi, registrationUncertain } from "./registration-api";
import { ClientError } from "./types";

const privateDetail = "private configuration canary";
const refusal = (code: string) =>
  Response.json(
    {
      error: { code, message: privateDetail, retryable: false },
      serverTime: "2026-11-11T00:00:00Z",
      requestId: v7(),
    },
    { status: 409 },
  );
afterEach(() => vi.unstubAllGlobals());

describe("WHR-100 actionable policy responses", () => {
  it.each([
    [
      "auth_policy_unconfigured",
      "sign-in",
      "Sign-in isn't set up on this server yet. Contact your system administrator.",
    ],
    [
      "delegation_policy_unconfigured",
      "assignable-roles",
      "Access settings aren't set up on this server, so roles can't be changed. Contact your system administrator.",
    ],
    [
      "delivery_unconfigured",
      "users/fictional/verification-requests",
      "Email delivery is unavailable. The address remains unverified.",
    ],
  ])(
    "I-07 I-12 admin 409 %s preserves the code and approved safe copy",
    async (code, path, message) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => refusal(code!)),
      );
      const error = await adminRequest(path!).catch((value: unknown) => value);
      expect(error).toBeInstanceOf(AdminError);
      expect(error).toMatchObject({ code, status: 409, message });
      expect(customerChangeIsUncertain(error)).toBe(false);
      expect(String(error)).not.toContain(privateDetail);
    },
  );

  it.each(["registration", "lookup"])(
    "I-15 phone 409 remains a definitive policy refusal during %s",
    async (operation) => {
      const outcome = vi.fn();
      const transport = vi.fn<typeof fetch>(async () =>
        refusal("phone_policy_unconfigured"),
      );
      const api = new HttpRegistrationApi(transport, () => outcome);
      const pending =
        operation === "lookup"
          ? api.lookupPhone("08000000101")
          : api.register({
              operationId: v7(),
              name: "Amina Bello",
              phone: "08000000101",
              category: "car_owner",
              card: { source: "code", code: "A7K3M9Q" },
            });
      const error = await pending.catch((value: unknown) => value);
      expect(error).toBeInstanceOf(ClientError);
      expect(error).toMatchObject({
        code: "phone_policy_unconfigured",
        status: 409,
        retryable: false,
        message:
          "Registration is not configured. Ask a station manager for help.",
      });
      expect(registrationUncertain(error)).toBe(false);
      expect(outcome).toHaveBeenCalledWith(true);
      expect(String(error)).not.toContain(privateDetail);
    },
  );

  it("I-20 failed file 409 preserves the export explanation without yielding bytes", async () => {
    const transport = vi.fn(async () => refusal("export_failed"));
    vi.stubGlobal("fetch", transport);
    const error = await customerFile(v7(), v7(), "pdf", () => true).catch(
      (value: unknown) => value,
    );
    expect(error).toMatchObject({ code: "export_failed", status: 409 });
    expect(customerChangeIsUncertain(error)).toBe(false);
    expect(customerMessage(error)).toBe(
      "File preparation failed. Prepare a new export.",
    );
    expect(customerMessage(error)).not.toContain(privateDetail);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

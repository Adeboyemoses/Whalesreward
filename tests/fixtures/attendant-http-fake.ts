import { expect, type BrowserContext, type Route } from "@playwright/test";

import { v7 as uuidv7 } from "uuid";
import type { Session } from "../../src/client/types";

// Test transport only. Production always calls the real M1 HTTP adapter.
export const ids = {
  grace: "019a5000-0000-7000-8000-000000000001",
  favour: "019a5000-0000-7000-8000-000000000002",
  station: "019a5000-0000-7000-8000-000000000003",
  pump: "019a5000-0000-7000-8000-000000000004",
  gasPump: "019a5000-0000-7000-8000-000000000005",
  assignment: "019a5000-0000-7000-8000-000000000006",
  gasAssignment: "019a5000-0000-7000-8000-000000000007",
  product: "019a5000-0000-7000-8000-000000000008",
  gasProduct: "019a5000-0000-7000-8000-000000000009",
  price: "019a5000-0000-7000-8000-000000000010",
  gasPrice: "019a5000-0000-7000-8000-000000000011",
  customer: "019a5000-0000-7000-8000-000000000012",
  request: "019a5000-0000-7000-8000-000000000013",
  context: "019a5000-0000-7000-8000-000000000014",
};

export function sessionFixture(
  username = "grace.okon",
  now = Date.now(),
): Session {
  const gas = username === "favour.james";
  const time = new Date(now).toISOString();
  return {
    account: {
      id: gas ? ids.favour : ids.grace,
      staffCode: gas ? "STAFF005" : "STAFF002",
      name: gas ? "Favour James" : "Grace Okon",
      username,
    },
    station: {
      id: ids.station,
      code: "STATION001",
      name: "Station 01",
      timezone: "Africa/Lagos",
    },
    assignment: { id: gas ? ids.gasAssignment : ids.assignment, version: 1 },
    pump: {
      id: gas ? ids.gasPump : ids.pump,
      code: gas ? "Pump 05" : "Pump 02",
    },
    product: {
      id: gas ? ids.gasProduct : ids.product,
      code: gas ? ("cooking_gas" as const) : ("pms" as const),
      unit: gas ? ("kilogram" as const) : ("litre" as const),
    },
    price: {
      priceVersionId: gas ? ids.gasPrice : ids.price,
      version: 1,
      rateKobo: gas ? "150000" : "100000",
      currency: "NGN" as const,
      quantityPrecision: gas ? 2 : 3,
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      fetchedAt: time,
    },
    captureContextId: uuidv7(),
    lastOnlineSignInAt: time,
    offlineExpiresAt: new Date(now + 86_400_000).toISOString(),
    sessionExpiresAt: new Date(now + 86_400_000).toISOString(),
    serverTime: time,
    reassignmentRequiresSignIn: false,
  };
}

type FixtureSession = ReturnType<typeof sessionFixture>;
export type AttendantFake = Awaited<ReturnType<typeof installAttendantFake>>;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function installAttendantFake(
  context: BrowserContext,
  options: { now?: number; signInAgeMs?: number } = {},
) {
  let active: FixtureSession | null = null;
  let offline = false;
  let lookupFailure: "none" | "missing" | "unavailable" = "none";
  let signOutFailure = false;
  let revoked = false;
  const calls: Array<{ path: string; method: string; source?: string }> = [];
  const signIns = new Map<string, FixtureSession>();
  const now = () => options.now ?? Date.now();
  const headers = {
    "cache-control": "no-store",
    "content-type": "application/json",
  };
  const success = (route: Route, data: unknown) =>
    route.fulfill({
      status: 200,
      headers,
      json: {
        data,
        serverTime: new Date(now()).toISOString(),
        requestId: ids.request,
      },
    });
  const failure = (
    route: Route,
    status: number,
    code: string,
    retryable = false,
  ) =>
    route.fulfill({
      status,
      headers,
      json: {
        error: {
          code,
          message:
            code === "invalid_credentials"
              ? "The username or password is not correct."
              : "The request could not be completed.",
          retryable,
        },
        serverTime: new Date(now()).toISOString(),
        requestId: ids.request,
      },
    });

  await context.route("**/api/attendant/**", async (route) => {
    if (offline) return route.abort("internetdisconnected");
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    calls.push({ path, method });
    if (path === "/api/attendant/sign-in") {
      expect(method).toBe("POST");
      const body = request.postDataJSON();
      expect(Object.keys(body).sort()).toEqual([
        "deviceId",
        "password",
        "username",
      ]);
      expect(body.deviceId).toMatch(uuid);
      const key = request.headers()["idempotency-key"]!;
      expect(key).toMatch(uuid);
      if (
        !["grace.okon", "favour.james"].includes(body.username) ||
        body.password !== "fictional-test-password"
      )
        return failure(route, 401, "invalid_credentials");
      active =
        signIns.get(key) ??
        sessionFixture(body.username, now() - (options.signInAgeMs ?? 0));
      active.serverTime = new Date(now()).toISOString();
      signIns.set(key, active);
      return success(route, active);
    }
    if (path === "/api/attendant/sign-out") {
      expect(method).toBe("POST");
      expect(request.postDataJSON()).toEqual({});
      expect(request.headers()["idempotency-key"]).toMatch(uuid);
      if (signOutFailure)
        return failure(route, 503, "temporarily_unavailable", true);
      active = null;
      return route.fulfill({
        status: 204,
        headers: { "cache-control": "no-store" },
      });
    }
    if (!active) return failure(route, 401, "unauthenticated");
    if (path === "/api/attendant/session") {
      if (revoked) return failure(route, 401, "unauthenticated");
      expect(method).toBe("GET");
      return success(route, {
        ...active,
        serverTime: new Date(now()).toISOString(),
      });
    }
    if (path === "/api/attendant/cards/lookup") {
      expect(method).toBe("POST");
      const body = request.postDataJSON();
      expect(["code", "qr"]).toContain(body.source);
      expect(Object.keys(body).sort()).toEqual(
        body.source === "code" ? ["code", "source"] : ["qr", "source"],
      );
      calls[calls.length - 1]!.source = body.source;
      if (lookupFailure === "unavailable")
        return failure(route, 503, "temporarily_unavailable", true);
      const code = String(body.code ?? body.qr)
        .trim()
        .toUpperCase();
      if (lookupFailure === "missing" || code !== "A7K3M9Q")
        return failure(route, 404, "customer_not_found");
      return success(route, {
        cardCode: code,
        customer: {
          id: ids.customer,
          name: "Amina Bello",
          category: "car_owner",
        },
        lookedUpAt: new Date(now()).toISOString(),
      });
    }
    throw new Error(`Unexpected test API call: ${method} ${path}`);
  });
  await context.route("**/api/sync/**", (route) => {
    calls.push({
      path: new URL(route.request().url()).pathname,
      method: route.request().method(),
    });
    throw new Error("WO-app-2 must not upload or credit a saved sale");
  });
  return {
    calls,
    setOffline(value: boolean) {
      offline = value;
    },
    setLookupFailure(value: typeof lookupFailure) {
      lookupFailure = value;
    },
    setSignOutFailure(value: boolean) {
      signOutFailure = value;
    },
    revoke() {
      revoked = true;
    },
    activeSession() {
      return active;
    },
  };
}

import { createHash } from "node:crypto";
import { expect, type BrowserContext, type Route } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import type { OriginalSale, SaleStatus, Session } from "../../src/client/types";

type RecordState = {
  accountId: string;
  original: OriginalSale;
  status: SaleStatus;
  credits: number;
};
type Permission = {
  purchaseId: string;
  operationId: string;
  uploadId: string;
  body: unknown;
  uploaded: boolean;
};
export type SyncCall = {
  path: string;
  method: string;
  body?: unknown;
  accountId?: string;
};

/** Contract-shaped transport simulation, not proof of the real server's credit logic. */
export async function installSyncFake(
  context: BrowserContext,
  options: {
    enabled: boolean;
    session: () => Session | null;
    offline: () => boolean;
    revoked: () => boolean;
    now: () => number;
  },
) {
  const records = new Map<string, RecordState>();
  const permissions = new Map<string, Permission>();
  const finalized = new Map<string, string>();
  const calls: SyncCall[] = [];
  let outcome: "credited" | "held" | "cancelled" = "credited";
  let holds: SaleStatus["holds"] = [
    { kind: "price", reasonCode: "price_uncertain" },
  ];
  let pauseFinalize = false;
  let loseSubmit = false;
  let loseFinalize = false;
  let failPut = false;
  let expirePermission = false;
  let throttleSeconds = 0;
  let invalidPhoto = false;
  const envelope = (data: unknown) => ({
    data,
    serverTime: new Date(options.now()).toISOString(),
    requestId: uuidv7(),
  });
  const respond = (route: Route, data: unknown, status = 200, extra = {}) =>
    route.fulfill({
      status,
      headers: { "cache-control": "no-store", ...extra },
      json: envelope(data),
    });
  const error = (route: Route, status: number, code: string, seconds = 0) =>
    route.fulfill({
      status,
      headers: {
        "cache-control": "no-store",
        ...(seconds ? { "retry-after": String(seconds) } : {}),
      },
      json: {
        error: {
          code,
          message: "The request could not be completed.",
          retryable: status === 429 || status === 503,
        },
        serverTime: new Date(options.now()).toISOString(),
        requestId: uuidv7(),
      },
    });
  await context.route("https://uploads.example.test/**", async (route) => {
    if (options.offline()) return route.abort("internetdisconnected");
    const request = route.request();
    if (request.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "PUT",
          "access-control-allow-headers": "content-type",
        },
      });
    const uploadId = new URL(request.url()).pathname.slice(1);
    calls.push({ path: `/storage/${uploadId}`, method: request.method() });
    expect(request.method()).toBe("PUT");
    expect(request.headers().cookie).toBeUndefined();
    const permission = [...permissions.values()].find(
      (p) => p.uploadId === uploadId,
    );
    expect(permission).toBeDefined();
    if (failPut) return route.abort("failed");
    const record = [...records.values()].find(
      (r) => r.status.purchaseId === permission!.purchaseId,
    )!;
    const bytes = request.postDataBuffer()!;
    expect(bytes.length).toBe(record.original.photo.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      record.original.photo.sha256,
    );
    expect(request.headers()["content-type"]).toBe("image/jpeg");
    permission!.uploaded = true;
    return route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      body: "",
    });
  });
  await context.route("**/api/sync/**", async (route) => {
    if (options.offline()) return route.abort("internetdisconnected");
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body =
      request.method() === "POST" ? request.postDataJSON() : undefined;
    const session = options.session();
    calls.push({
      path,
      method: request.method(),
      body,
      accountId: session?.account.id,
    });
    if (!options.enabled)
      return error(route, 503, "temporarily_unavailable", 60);
    if (!session || options.revoked())
      return error(route, 401, "unauthenticated");
    if (throttleSeconds)
      return error(route, 429, "rate_limited", throttleSeconds);
    if (path === "/api/sync/sales") {
      expect(request.method()).toBe("POST");
      expect(Object.keys(body).sort()).toEqual(
        [
          "operationId",
          "captureContextId",
          "assignmentId",
          "cardCode",
          "appCapturedAt",
          "priceVersionId",
          "rateKobo",
          "currency",
          "quantityPrecision",
          "unit",
          "medium",
          "entry",
          "photo",
        ].sort(),
      );
      const original = body as OriginalSale;
      const key = `${session.account.id}/${original.operationId}`;
      let record = records.get(key);
      if (
        record &&
        JSON.stringify(record.original) !== JSON.stringify(original)
      )
        return error(route, 409, "operation_conflict");
      if (!record) {
        record = {
          accountId: session.account.id,
          original: structuredClone(original),
          credits: 0,
          status: {
            purchaseId: uuidv7(),
            operationId: original.operationId,
            saleCode: `S${String(records.size + 1).padStart(3, "0")}`,
            version: 1,
            state: outcome === "cancelled" ? "cancelled" : "photo_pending",
            detailsReceived: true,
            photoValidated: false,
            credited: false,
            currentRevisionId: null,
            customer:
              outcome === "cancelled"
                ? null
                : {
                    id: "019a5000-0000-7000-8000-000000000012",
                    name: "Amina Bello",
                    category: "car_owner",
                  },
            holds: [],
            cancellationReason:
              outcome === "cancelled" ? "customer_not_found" : null,
            pendingReason: outcome === "cancelled" ? null : "photo_required",
            serverReceivedAt: new Date(options.now()).toISOString(),
          },
        };
        records.set(key, record);
      }
      if (loseSubmit) {
        loseSubmit = false;
        return route.abort("failed");
      }
      return respond(route, record.status);
    }
    if (path.startsWith("/api/sync/sales/by-operation/")) {
      expect(request.method()).toBe("GET");
      const record = records.get(
        `${session.account.id}/${path.split("/").at(-1)}`,
      );
      return record
        ? respond(route, record.status)
        : error(route, 404, "sale_not_found");
    }
    const purchaseId = path.split("/")[4];
    const record = [...records.values()].find(
      (r) =>
        r.status.purchaseId === purchaseId &&
        r.accountId === session.account.id,
    );
    if (!record) return error(route, 404, "sale_not_found");
    if (path.endsWith("/upload-permission")) {
      expect(Object.keys(body).sort()).toEqual([
        "bytes",
        "mediaType",
        "operationId",
        "sha256",
      ]);
      expect(body).toMatchObject(record.original.photo);
      if (expirePermission) {
        expirePermission = false;
        return error(route, 409, "upload_permission_expired");
      }
      let permission = permissions.get(body.operationId);
      if (
        permission &&
        JSON.stringify(permission.body) !== JSON.stringify(body)
      )
        return error(route, 409, "operation_conflict");
      if (!permission) {
        permission = {
          purchaseId: purchaseId!,
          operationId: body.operationId,
          uploadId: uuidv7(),
          body,
          uploaded: false,
        };
        permissions.set(body.operationId, permission);
      }
      return respond(route, {
        uploadId: permission.uploadId,
        method: "PUT",
        url: `https://uploads.example.test/${permission.uploadId}`,
        headers: { "Content-Type": "image/jpeg" },
        expiresAt: new Date(options.now() + 300000).toISOString(),
        maxBytes: 8388608,
      });
    }
    if (path.endsWith("/finalize")) {
      expect(Object.keys(body).sort()).toEqual([
        "expectedVersion",
        "operationId",
        "uploadId",
      ]);
      const prior = finalized.get(body.operationId);
      if (prior && prior !== JSON.stringify(body))
        return error(route, 409, "operation_conflict");
      finalized.set(body.operationId, JSON.stringify(body));
      const permission = [...permissions.values()].find(
        (p) => p.uploadId === body.uploadId && p.purchaseId === purchaseId,
      );
      expect(permission?.uploaded).toBe(true);
      if (invalidPhoto) return error(route, 422, "photo_invalid");
      if (pauseFinalize) {
        record.status = {
          ...record.status,
          state: "finalizing",
          pendingReason: "validation_pending",
        };
        return respond(route, record.status, 202, { "retry-after": "2" });
      }
      if (!record.status.photoValidated) {
        record.status = {
          ...record.status,
          version: record.status.version + 1,
          state: outcome === "held" ? "held" : "credited",
          photoValidated: true,
          credited: outcome !== "held",
          currentRevisionId: outcome === "held" ? null : uuidv7(),
          holds: outcome === "held" ? holds : [],
          pendingReason: null,
        };
        if (record.status.credited) record.credits++;
      }
      if (loseFinalize) {
        loseFinalize = false;
        return route.abort("failed");
      }
      return respond(route, record.status);
    }
    throw new Error(`Unexpected sync test request: ${path}`);
  });
  return {
    calls,
    records,
    permissions,
    setOutcome(value: typeof outcome, valueHolds = holds) {
      outcome = value;
      holds = valueHolds;
    },
    setFinalizePending(value: boolean) {
      pauseFinalize = value;
      if (!value) {
        for (const record of records.values()) {
          if (record.status.state !== "finalizing") continue;
          record.status = {
            ...record.status,
            version: record.status.version + 1,
            state: outcome === "held" ? "held" : "credited",
            photoValidated: true,
            credited: outcome !== "held",
            currentRevisionId: outcome === "held" ? null : uuidv7(),
            holds: outcome === "held" ? holds : [],
            pendingReason: null,
          };
          if (record.status.credited) record.credits++;
        }
      }
    },
    loseNextSubmit() {
      loseSubmit = true;
    },
    loseNextFinalize() {
      loseFinalize = true;
    },
    setPutFailure(value: boolean) {
      failPut = value;
    },
    expireNextPermission() {
      expirePermission = true;
    },
    setThrottle(seconds: number) {
      throttleSeconds = seconds;
    },
    setInvalidPhoto(value: boolean) {
      invalidPhoto = value;
    },
  };
}

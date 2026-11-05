import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { AttendantClient } from "./client";
import { CaptureDatabase } from "./db";
import { ClientError } from "../types";
import { HttpAttendantApi } from "../api";
import { sessionFixture } from "../../../tests/fixtures/attendant-client-fake";
import { SyncClientFake } from "../../../tests/fixtures/sync-client-fake";
let client: AttendantClient,
  db: CaptureDatabase,
  api: SyncClientFake,
  now: number,
  mono: number,
  online: boolean;
const clients: AttendantClient[] = [];
beforeEach(async () => {
  now = Date.parse("2026-11-05T00:00:00Z");
  mono = 0;
  online = true;
  api = new SyncClientFake(sessionFixture(now));
  db = new CaptureDatabase("sync-" + uuidv7());
  client = new AttendantClient(
    api,
    db,
    () => ({ wall: now, mono, runtimeId: "one" }),
    () => online,
  );
  clients.push(client);
  await client.initialize();
  await client.signIn("grace.okon", "fictional");
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const c of clients) c.close();
  clients.length = 0;
  await db.delete();
});
function advance(ms = 70000) {
  now += ms;
  mono += ms;
}
async function save() {
  const blob = new Blob(["jpeg"], { type: "image/jpeg" });
  const sha256 = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
  return client.saveCapture(await client.beginCapture(), {
    cardCode: "A7K3M9X",
    customerCache: await client.lookup("A7K3M9X"),
    medium: "vehicle",
    basis: "amount",
    value: "20000",
    photo: { blob, sha256, bytes: blob.size, mediaType: "image/jpeg" },
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
describe("durable sync", () => {
  it("submits original, uploads photo and persists authoritative credit without deleting evidence", async () => {
    const row = await save();
    await client.retryUploads();
    const stored = (await client.ownSale(row.operationId))!;
    expect(stored.state).toBe("credited");
    expect(stored.serverStatus?.credited).toBe(true);
    expect(stored.original).toEqual(row.original);
    expect(stored.photoBlob.size).toBe(row.photoBlob.size);
    expect(stored.finalizeRequest).toEqual(api.finalizeBodies[0]);
    expect(JSON.stringify(stored)).not.toContain("https://");
  });
  it("keeps partial uploads pending and manual retry respects Retry-After", async () => {
    const row = await save();
    api.throttle = 30000;
    await client.retryUploads();
    expect((await client.ownSale(row.operationId))?.nextAttemptAt).toBe(
      new Date(now + 30000).toISOString(),
    );
    await client.retryUploads();
    expect(api.calls).toEqual(["submit"]);
    advance();
    api.throttle = null;
    api.failPut = true;
    await client.retryUploads();
    expect(
      (await client.ownSale(row.operationId))?.serverStatus?.credited,
    ).toBe(false);
    expect((await client.ownSale(row.operationId))?.photoBlob.size).toBe(4);
  });
  it("reconciles a lost submit response before reusing the same original", async () => {
    const row = await save();
    api.loseSubmit = true;
    await client.retryUploads();
    advance();
    await client.retryUploads();
    expect(api.calls.slice(0, 3)).toEqual(["submit", "status", "permission"]);
    expect(api.originals.size).toBe(1);
    expect((await client.ownSale(row.operationId))?.state).toBe("credited");
  });
  it("reconciles a lost finalize after restart without reupload or new credit", async () => {
    const row = await save();
    api.loseFinalize = true;
    await client.retryUploads();
    const finalize = (await client.ownSale(row.operationId))!.finalizeRequest;
    client.close();
    advance();
    client = new AttendantClient(
      api,
      new CaptureDatabase(db.name),
      () => ({ wall: now, mono: 0, runtimeId: "restart" }),
      () => true,
    );
    clients.push(client);
    await client.initialize();
    await client.retryUploads();
    expect(api.calls.filter((c) => c === "put")).toHaveLength(1);
    expect(api.finalizeBodies).toHaveLength(1);
    expect((await client.ownSale(row.operationId))!.finalizeRequest).toEqual(
      finalize,
    );
    expect((await client.ownSale(row.operationId))!.state).toBe("credited");
  });
  it("uses a fresh permission identity only after expiry and leaves original unchanged", async () => {
    const row = await save();
    api.expirePermission = true;
    await client.retryUploads();
    advance();
    await client.retryUploads();
    expect(api.permissionKeys[1]).not.toBe(api.permissionKeys[0]);
    expect(api.originals.get(row.operationId)).toEqual(row.original);
  });
  it("preserves mixed holds and never retries uploaded evidence to clear them", async () => {
    const row = await save();
    api.finalizeHeld = true;
    await client.retryUploads();
    expect((await client.ownSale(row.operationId))!.state).toBe("held");
    expect(
      (await client.ownSale(row.operationId))!.serverStatus?.holds,
    ).toHaveLength(2);
    advance();
    await client.retryUploads();
    expect(api.calls.filter((c) => c === "put")).toHaveLength(1);
    expect(
      (await client.ownSale(row.operationId))!.serverStatus?.credited,
    ).toBe(false);
  });
  it("allows only one active lease across tabs", async () => {
    await save();
    const gate = deferred();
    api.beforeSubmit = () => gate.promise;
    const running = client.retryUploads();
    while (!api.calls.includes("submit"))
      await new Promise((r) => setTimeout(r, 1));
    const tab = new AttendantClient(
      api,
      new CaptureDatabase(db.name),
      () => ({ wall: now, mono, runtimeId: "two" }),
      () => true,
    );
    clients.push(tab);
    await tab.initialize();
    await tab.retryUploads();
    expect(api.calls).toEqual(["submit"]);
    gate.resolve();
    await running;
  });
  it("stops after signout during PUT and cannot apply a late response", async () => {
    const row = await save();
    const gate = deferred();
    api.beforePut = () => gate.promise;
    const running = client.retryUploads();
    while (!api.calls.includes("put"))
      await new Promise((r) => setTimeout(r, 1));
    await client.signOut();
    gate.resolve();
    await running;
    expect(api.calls).not.toContain("finalize");
    expect(await client.ownSales()).toEqual([]);
    expect(
      (await db.outbox.get([row.originatingAccountId, row.operationId]))
        ?.serverStatus?.credited,
    ).toBe(false);
  });
  it("pauses offline and exactly at the 24-hour window", async () => {
    await save();
    online = false;
    await client.retryUploads();
    expect(api.calls).toEqual([]);
    online = true;
    advance(86400000);
    await client.retryUploads();
    expect(api.calls).toEqual([]);
    expect((await client.ownSales())[0]!.photoBlob.size).toBe(4);
  });
  it("cannot finalize or overwrite a lease claimed by another worker during a slow PUT", async () => {
    const row = await save();
    const gate = deferred();
    api.beforePut = () => gate.promise;
    const running = client.retryUploads();
    while (!api.calls.includes("put"))
      await new Promise((r) => setTimeout(r, 1));
    const successor = {
      owner: uuidv7(),
      expiresAt: new Date(now + 60000).toISOString(),
    };
    await db.outbox.update([row.originatingAccountId, row.operationId], {
      syncLease: successor,
    });
    gate.resolve();
    await running;
    expect(api.calls).not.toContain("finalize");
    const stored = await db.outbox.get([
      row.originatingAccountId,
      row.operationId,
    ]);
    expect(stored?.syncLease).toEqual(successor);
    expect(stored?.serverStatus?.credited).toBe(false);
  });
  it("replays the immutable finalize body after an unknown result despite a newer mutable version", async () => {
    const row = await save();
    const finalize = api.finalizeSale.bind(api);
    api.finalizeSale = async (purchaseId, body) => {
      void purchaseId;
      api.finalizeBodies.push(structuredClone(body));
      api.statuses.get(row.operationId)!.version = 2;
      throw new ClientError("network_unavailable", "Lost before response");
    };
    await client.retryUploads();
    const saved = (await client.ownSale(row.operationId))!;
    api.finalizeSale = finalize;
    advance();
    await client.retryUploads();
    expect(api.finalizeBodies).toEqual([
      saved.finalizeRequest,
      saved.finalizeRequest,
    ]);
    expect(saved.finalizeRequest?.expectedVersion).toBe(1);
    expect((await client.ownSale(row.operationId))?.state).toBe("credited");
  });
  it("rejects a valid-looking server receipt belonging to another operation", async () => {
    const row = await save();
    const submit = api.submitSale.bind(api);
    api.submitSale = async (original) => {
      const result = await submit(original);
      return { ...result, status: { ...result.status, operationId: uuidv7() } };
    };
    await client.retryUploads();
    const stored = (await client.ownSale(row.operationId))!;
    expect(stored.serverStatus).toBeNull();
    expect(stored.lastErrorCode).toBe("invalid_response");
    expect(api.calls).not.toContain("permission");
  });
  it("keeps capture access after signed PUT 403 and renews only an expired permission", async () => {
    const original = await save();
    const http = new HttpAttendantApi(
      async () => new Response(null, { status: 403 }),
    );
    const upload = api.uploadPhoto.bind(api);
    api.uploadPhoto = http.uploadPhoto.bind(http);
    await client.retryUploads();
    expect(client.getState().access).toBe("active");
    await expect(client.beginCapture()).resolves.toHaveProperty("operationId");
    const failed = (await client.ownSale(original.operationId))!;
    expect(failed.lastErrorCode).toBe("photo_upload_failed");
    expect(failed.photoBlob.size).toBe(original.photoBlob.size);
    expect(failed.state).toBe("uploading");
    api.uploadPhoto = upload;
    api.expirePermission = true;
    advance();
    await client.retryUploads();
    expect(api.permissionKeys[1]).toBe(api.permissionKeys[0]);
    advance();
    await client.retryUploads();
    expect(api.permissionKeys[2]).not.toBe(api.permissionKeys[1]);
    const complete = (await client.ownSale(original.operationId))!;
    expect(complete.state).toBe("credited");
    expect(complete.original).toEqual(original.original);
  });
  it.each(["PUT", "finalize"] as const)(
    "retains exponential backoff across unchanged status reconciliation after %s failures",
    async (stage) => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const original = await save();
      let retryAfterMs: number | null = null;
      if (stage === "PUT") {
        api.uploadPhoto = async () => {
          throw new ClientError(
            "photo_upload_failed",
            "Failed",
            503,
            retryAfterMs,
            true,
          );
        };
      } else {
        api.finalizeSale = async () => {
          throw new ClientError(
            "storage_unavailable",
            "Failed",
            503,
            retryAfterMs,
            true,
          );
        };
      }
      const delays: number[] = [];
      for (let attempt = 1; attempt <= 8; attempt++) {
        await client.retryUploads();
        const row = (await client.ownSale(original.operationId))!;
        expect(row.attempts).toBe(attempt);
        const delay = Date.parse(row.nextAttemptAt!) - now;
        delays.push(delay);
        advance(delay);
      }
      expect(delays).toEqual([
        6000, 6000, 6000, 8000, 16000, 32000, 60000, 60000,
      ]);
      retryAfterMs = 90000;
      await client.retryUploads();
      expect(
        Date.parse(
          (await client.ownSale(original.operationId))!.nextAttemptAt!,
        ) - now,
      ).toBe(90000);
      expect((await client.ownSale(original.operationId))!.photoBlob.size).toBe(
        original.photoBlob.size,
      );
    },
  );
  it("preserves a permanently rejected photo across receipt refresh and retry until an authoritative terminal outcome", async () => {
    const original = await save();
    api.finalizeSale = async () => {
      api.calls.push("finalize");
      throw new ClientError("photo_invalid", "Photo rejected", 422);
    };
    await client.retryUploads();
    const rejected = (await client.ownSale(original.operationId))!;
    expect(rejected.state).toBe("needs_attention");
    const writes = api.calls.filter((call) => call !== "status");
    await client.refreshSale(original.operationId);
    await client.retryUploads();
    advance();
    await client.retryUploads();
    const refreshed = (await client.ownSale(original.operationId))!;
    expect(refreshed.state).toBe("needs_attention");
    expect(refreshed.lastErrorCode).toBe("photo_invalid");
    expect(api.calls.filter((call) => call !== "status")).toEqual(writes);
    expect(refreshed.original).toEqual(original.original);
    expect(refreshed.photoBlob.size).toBe(original.photoBlob.size);
    expect(refreshed.finalizeRequest).toEqual(rejected.finalizeRequest);
    const status = api.statuses.get(original.operationId)!;
    api.statuses.set(original.operationId, {
      ...status,
      version: status.version + 1,
      state: "cancelled",
      cancellationReason: "invalid_purchase",
      pendingReason: null,
    });
    await client.refreshSale(original.operationId);
    const resolved = (await client.ownSale(original.operationId))!;
    expect(resolved.state).toBe("cancelled");
    expect(resolved.lastErrorCode).toBeNull();
    expect(resolved.original).toEqual(original.original);
    expect(resolved.photoBlob.size).toBe(original.photoBlob.size);
    expect(resolved.finalizeRequest).toEqual(rejected.finalizeRequest);
    expect(api.calls.filter((call) => call !== "status")).toEqual(writes);
  });
});

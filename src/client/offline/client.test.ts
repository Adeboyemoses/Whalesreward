import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { AttendantClient } from "./client";
import { CaptureDatabase } from "./db";
import {
  FakeAttendantApi,
  sessionFixture,
} from "../../../tests/fixtures/attendant-client-fake";
import { ClientError, type CapturedPhoto, type CaptureInput } from "../types";
let now: number,
  mono: number,
  online: boolean,
  api: FakeAttendantApi,
  db: CaptureDatabase,
  client: AttendantClient;
const open: AttendantClient[] = [];
beforeEach(async () => {
  now = Date.parse("2026-11-04T10:00:00Z");
  mono = 0;
  online = true;
  api = new FakeAttendantApi(sessionFixture(now));
  db = new CaptureDatabase("test-" + uuidv7());
  client = new AttendantClient(
    api,
    db,
    () => ({ wall: now, mono, runtimeId: "runtime" }),
    () => online,
  );
  open.push(client);
  await client.initialize();
  await client.signIn("grace.okon", "fictional");
});
afterEach(async () => {
  for (const c of open) c.close();
  open.length = 0;
  await db.delete();
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
async function handoverClient(otherTab: boolean) {
  if (!otherTab) return client;
  const second = new AttendantClient(
    api,
    new CaptureDatabase(db.name),
    () => ({ wall: now, mono, runtimeId: "handover-tab" }),
    () => online,
  );
  open.push(second);
  await second.initialize();
  return second;
}
async function input(): Promise<CaptureInput> {
  const blob = new Blob(["fictional compressed jpeg"], { type: "image/jpeg" });
  const sha256 = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  const photo: CapturedPhoto = {
    blob,
    sha256,
    bytes: blob.size,
    mediaType: "image/jpeg",
  };
  return {
    cardCode: "A7K3M9X",
    customerCache: await client.lookup("A7K3M9X"),
    medium: "vehicle",
    basis: "amount",
    value: "20000.00",
    photo,
  };
}
describe("durable account partition", () => {
  it("saves an already resolved online sale without waiting for another card lookup", async () => {
    const draft = await client.beginCapture();
    const form = await input();
    const entered = deferred<void>();
    const held = deferred<NonNullable<CaptureInput["customerCache"]>>();
    let lookups = 0;
    api.lookup = () => {
      lookups++;
      entered.resolve();
      return held.promise;
    };
    let saved: Awaited<ReturnType<AttendantClient["saveCapture"]>> | undefined;
    const saving = client.saveCapture(draft, form).then((row) => {
      saved = row;
      return row;
    });
    try {
      await entered.promise;
      await expect
        .poll(() => saved?.operationId, { timeout: 1000 })
        .toBe(draft.operationId);
      expect(lookups).toBe(1);
      expect(saved!.original.cardCode).toBe(form.cardCode);
      expect(saved!.customerCache).toEqual(form.customerCache);
      expect(saved!.photoDigest).toBe(form.photo.sha256);
      expect(saved!.photoBlob.size).toBe(form.photo.blob.size);
      expect(saved!.state).toBe("saved");
      expect(saved!.serverStatus).toBeNull();
      expect(await db.outbox.count()).toBe(1);
    } finally {
      held.resolve(form.customerCache!);
      await saving;
    }
  });
  it.each([
    "unauthenticated",
    "permission_denied",
    "assignment_unavailable",
  ] as const)(
    "a delayed Save-time lookup %s locks capture and keeps the saved original/photo",
    async (code) => {
      const draft = await client.beginCapture();
      const form = await input();
      const entered = deferred<void>();
      const release = deferred<void>();
      api.lookup = async () => {
        entered.resolve();
        await release.promise;
        throw new ClientError(code, "Revoked");
      };
      try {
        const saved = await client.saveCapture(draft, form);
        await entered.promise;
        expect(client.getState().access).toBe("active");
        release.resolve();
        await expect.poll(() => client.getState().access).toBe("signed_out");
        await expect(client.beginCapture()).rejects.toMatchObject({
          code: "access_expired",
        });
        // A successful response for this same context never clears the denial.
        await client.refresh();
        expect(client.getState().access).toBe("signed_out");
        expect(client.getState().session).toBeNull();
        const retained = await db.outbox.get([
          saved.originatingAccountId,
          saved.operationId,
        ]);
        expect(retained?.original).toEqual(saved.original);
        expect(retained?.photoDigest).toBe(saved.photoDigest);
        expect(retained?.photoBlob.size).toBe(saved.photoBlob.size);
        expect(retained?.state).toBe("saved");
        expect(retained?.serverStatus).toBeNull();
      } finally {
        release.resolve();
      }
    },
  );
  it("an inferred outage permits local pending capture but never suppresses browser-online revocation checks", async () => {
    const local = new AttendantClient(
      api,
      new CaptureDatabase(db.name),
      () => ({ wall: now, mono, runtimeId: "outage-tab" }),
      () => true,
      () => false,
    );
    open.push(local);
    await local.initialize();
    const form = await input();
    api.lookup = async () => {
      throw new Error("Lookup must stay local while unreachable");
    };
    expect(await local.lookup("A7K3M9Y")).toBeNull();
    const saved = await local.saveCapture(await local.beginCapture(), {
      ...form,
      cardCode: "A7K3M9Y",
      customerCache: null,
    });
    expect(saved.original.entry.amountKobo).toBe("2000000");
    let revalidations = 0;
    api.session = async () => {
      revalidations++;
      throw new ClientError("unauthenticated", "Revoked");
    };
    await local.refresh();
    expect(revalidations).toBe(1);
    expect(local.getState().access).toBe("signed_out");
    await expect(local.beginCapture()).rejects.toMatchObject({
      code: "access_expired",
    });
    expect(await db.outbox.count()).toBe(1);
  });
  it("atomically stores original, attribution and photo, with exact money and same-ID replay", async () => {
    const draft = await client.beginCapture();
    const form = await input();
    const saved = await client.saveCapture(draft, form);
    expect(saved.original.entry).toEqual({
      basis: "amount",
      enteredAmountKobo: "2000000",
      amountKobo: "2000000",
      quantity: "20",
    });
    expect(saved.photoBlob.size).toBe(form.photo.blob.size);
    expect((await client.saveCapture(draft, form)).operationId).toBe(
      saved.operationId,
    );
    expect(await client.ownSales()).toHaveLength(1);
    await expect(
      client.saveCapture(draft, { ...form, value: "20001" }),
    ).rejects.toMatchObject({ code: "operation_conflict" });
  });
  it("survives database reopen and does not renew the offline anchor", async () => {
    const form = await input();
    await client.saveCapture(await client.beginCapture(), form);
    client.close();
    now += 3600000;
    const reopened = new AttendantClient(
      api,
      new CaptureDatabase(db.name),
      () => ({ wall: now, mono: 0, runtimeId: "new" }),
      () => false,
    );
    open.push(reopened);
    await reopened.initialize();
    expect(await reopened.ownSales()).toHaveLength(1);
    expect(reopened.getState().session?.lastOnlineSignInAt).toBe(
      api.current.lastOnlineSignInAt,
    );
  });
  it("another account sees no rows; prior account sees its originals after fresh sign-in", async () => {
    const first = api.current;
    await client.saveCapture(await client.beginCapture(), await input());
    await client.signOut();
    api.current = sessionFixture(now);
    await client.signIn("other", "fictional");
    expect(await client.ownSales()).toEqual([]);
    await client.signOut();
    api.current = { ...first, captureContextId: uuidv7() };
    await client.signIn("grace.okon", "fictional");
    expect(await client.ownSales()).toHaveLength(1);
  });
  it("cross-tab signout rejects a stale draft save and hides counts", async () => {
    const draft = await client.beginCapture();
    const form = await input();
    const second = new AttendantClient(
      api,
      new CaptureDatabase(db.name),
      () => ({ wall: now, mono, runtimeId: "second" }),
      () => online,
    );
    open.push(second);
    await second.initialize();
    await second.signOut();
    await expect(client.saveCapture(draft, form)).rejects.toMatchObject({
      code: "access_expired",
    });
    expect(await client.ownSales()).toEqual([]);
  });
  it("failed revocation leaves a durable lock and must complete before any new sign-in", async () => {
    api.revocationFails = true;
    await client.signOut();
    await expect(client.signIn("other", "fictional")).rejects.toMatchObject({
      code: "network_unavailable",
    });
    expect(client.getState().access).toBe("signed_out");
    expect((await db.meta.get("installation"))?.logoutPending).toBe(true);
  });
  it("quota transaction failure leaves no partial row and permits same draft retry", async () => {
    const draft = await client.beginCapture();
    const form = await input();
    const hook = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    db.outbox.hook("creating", hook);
    await expect(client.saveCapture(draft, form)).rejects.toMatchObject({
      code: "storage_failed",
    });
    expect(await client.ownSales()).toHaveLength(0);
    db.outbox.hook("creating").unsubscribe(hook);
    await client.saveCapture(draft, form);
    expect(await client.ownSales()).toHaveLength(1);
  });
  it("save at exactly 24h is denied with existing photo and record preserved", async () => {
    const form = await input();
    await client.saveCapture(await client.beginCapture(), form);
    const draft = await client.beginCapture();
    now += 86400000;
    mono += 86400000;
    await expect(client.saveCapture(draft, form)).rejects.toMatchObject({
      code: "access_expired",
    });
    expect(await client.ownSales()).toHaveLength(1);
    expect(client.getState().access).toBe("expired");
  });
  it("offline uncached card stays pending lookup; online unresolved customer cannot save", async () => {
    const form = await input();
    await expect(
      client.saveCapture(await client.beginCapture(), {
        ...form,
        customerCache: null,
      }),
    ).rejects.toMatchObject({ code: "lookup_required" });
    online = false;
    expect(await client.lookup("B7K3M9X")).toBeNull();
    const row = await client.saveCapture(await client.beginCapture(), {
      ...form,
      cardCode: "B7K3M9X",
      customerCache: null,
    });
    expect(row.customerCache).toBeNull();
    expect(row.state).toBe("saved");
  });
  it("a session refresh never replaces an in-progress draft price or renews access", async () => {
    const draft = await client.beginCapture();
    api.current = {
      ...api.current,
      price: {
        ...api.current.price,
        rateKobo: "200000",
        priceVersionId: uuidv7(),
      },
    };
    await client.refresh();
    const row = await client.saveCapture(draft, await input());
    expect(row.original.rateKobo).toBe("100000");
    expect(client.getState().session?.price.rateKobo).toBe("200000");
  });
  it("gas uses cylinder and exact kilogram quantity calculations", async () => {
    await client.signOut();
    api.current = {
      ...sessionFixture(now),
      product: { id: uuidv7(), code: "cooking_gas", unit: "kilogram" },
    };
    api.current.price = {
      ...api.current.price,
      rateKobo: "150000",
      quantityPrecision: 2,
    };
    await client.signIn("gas", "fictional");
    const form = await input();
    await expect(
      client.saveCapture(await client.beginCapture(), form),
    ).rejects.toMatchObject({ code: "medium_required" });
    const row = await client.saveCapture(await client.beginCapture(), {
      ...form,
      medium: "cylinder",
      basis: "quantity",
      value: "10.25",
    });
    expect(row.original.entry.amountKobo).toBe("1537500");
    expect(row.original.entry.quantity).toBe("10.25");
  });
  it("a delayed lookup cannot return after same-account reauthentication", async () => {
    const entered = deferred<void>();
    const response =
      deferred<Awaited<ReturnType<FakeAttendantApi["lookup"]>>>();
    const result = await api.lookup({ source: "code", code: "A7K3M9X" });
    api.lookup = () => {
      entered.resolve();
      return response.promise;
    };
    const pending = client.lookup("A7K3M9X");
    const rejected = expect(pending).rejects.toMatchObject({
      code: "account_changed",
    });
    await entered.promise;
    api.current = { ...api.current, captureContextId: uuidv7() };
    await client.signIn("grace", "fictional");
    response.resolve(result);
    await rejected;
  });
  it("immediate same-tab handover cancels sign-in before its first local await completes", async () => {
    let credentialRequests = 0;
    api.signIn = async () => {
      credentialRequests++;
      return { ...api.current, captureContextId: uuidv7() };
    };
    const pending = client.signIn("grace", "fictional");
    const rejected = expect(pending).rejects.toMatchObject({
      code: "account_changed",
    });
    await client.signOut();
    await rejected;
    expect(credentialRequests).toBe(0);
    expect((await client.checkAccess()).access).toBe("signed_out");
  });
  it.each([false, true])(
    "handover during prerequisite revocation cancels the older sign-in before any credential request (other tab: %s)",
    async (otherTab) => {
      const actor = await handoverClient(otherTab);
      // A previous offline sign-out must be revoked before a new credential request.
      online = false;
      await client.signOut();
      online = true;
      const entered = deferred<void>();
      const resume = deferred<void>();
      let revocations = 0;
      let credentialRequests = 0;
      api.signOut = async () => {
        if (++revocations === 1) {
          entered.resolve();
          await resume.promise;
        }
      };
      api.signIn = async () => {
        credentialRequests++;
        return { ...api.current, captureContextId: uuidv7() };
      };
      const pending = client.signIn("grace", "fictional");
      const outcome = pending.then(
        (value) => ({ value, error: null }),
        (error) => ({ value: null, error }),
      );
      await entered.promise;
      await actor.signOut();
      resume.resolve();
      expect((await outcome).error).toMatchObject({ code: "account_changed" });
      expect(credentialRequests).toBe(0);
      expect((await client.checkAccess()).access).toBe("signed_out");
      expect((await db.meta.get("installation"))?.activeAccountId).toBeNull();
    },
  );
  it.each([false, true])(
    "a sign-in response arriving after handover cannot restore a window or usable cookie (other tab: %s)",
    async (otherTab) => {
      const actor = await handoverClient(otherTab);
      const entered = deferred<void>();
      const response = deferred<ReturnType<typeof sessionFixture>>();
      const fresh = { ...api.current, captureContextId: uuidv7() };
      let usableCookie = false;
      api.signIn = async () => {
        entered.resolve();
        const result = await response.promise;
        usableCookie = true;
        return result;
      };
      api.signOut = async () => {
        usableCookie = false;
      };
      const pending = client.signIn("grace", "fictional");
      const rejected = expect(pending).rejects.toMatchObject({
        code: "account_changed",
      });
      await entered.promise;
      await actor.signOut();
      response.resolve(fresh);
      await rejected;
      expect(usableCookie).toBe(false);
      expect((await client.checkAccess()).access).toBe("signed_out");
      expect((await db.meta.get("installation"))?.activeAccountId).toBeNull();
    },
  );
  it.each(["unauthenticated", "permission_denied"])(
    "lookup %s locks capture before propagating and retains saved evidence",
    async (code) => {
      const form = await input();
      const saved = await client.saveCapture(await client.beginCapture(), form);
      const draft = await client.beginCapture();
      api.lookup = async () => {
        throw new ClientError(code, "Access denied");
      };
      await expect(client.lookup("A7K3M9X")).rejects.toMatchObject({ code });
      online = false;
      expect((await client.checkAccess()).access).toBe("signed_out");
      expect(client.getState().session).toBeNull();
      await expect(client.saveCapture(draft, form)).rejects.toMatchObject({
        code: "access_expired",
      });
      expect(await client.ownSale(saved.operationId)).toBeUndefined();
      expect(
        (await db.outbox.get([saved.originatingAccountId, saved.operationId]))
          ?.photoDigest,
      ).toBe(form.photo.sha256);
    },
  );
  it.each([
    ["unauthenticated", false],
    ["permission_denied", false],
    ["mismatch", false],
    ["unauthenticated", true],
    ["permission_denied", true],
    ["mismatch", true],
  ] as const)(
    "old refresh %s cannot lock a new sign-in context (different account: %s)",
    async (code, differentAccount) => {
      const entered = deferred<void>();
      const release = deferred<void>();
      const old = structuredClone(api.current);
      api.session = async () => {
        entered.resolve();
        await release.promise;
        if (code === "mismatch") return sessionFixture(now);
        throw new ClientError(code, "Access denied");
      };
      const pending = client.refresh();
      await entered.promise;
      if (differentAccount) await client.signOut();
      api.current = differentAccount
        ? sessionFixture(now)
        : { ...old, captureContextId: uuidv7() };
      await client.signIn("current", "fictional");
      release.resolve();
      await pending;
      const state = await client.checkAccess();
      expect(state.access).toBe("active");
      expect(state.session?.captureContextId).toBe(
        api.current.captureContextId,
      );
      expect(state.session?.account.id).toBe(api.current.account.id);
    },
  );
  it.each([
    ["unauthenticated", false],
    ["permission_denied", false],
    ["unauthenticated", true],
    ["permission_denied", true],
  ] as const)(
    "old lookup %s cannot lock a new sign-in context (different account: %s)",
    async (code, differentAccount) => {
      const entered = deferred<void>();
      const release = deferred<void>();
      const old = structuredClone(api.current);
      api.lookup = async () => {
        entered.resolve();
        await release.promise;
        throw new ClientError(code, "Access denied");
      };
      const pending = client.lookup("A7K3M9X");
      const rejected = expect(pending).rejects.toMatchObject({ code });
      await entered.promise;
      if (differentAccount) await client.signOut();
      api.current = differentAccount
        ? sessionFixture(now)
        : { ...old, captureContextId: uuidv7() };
      await client.signIn("current", "fictional");
      release.resolve();
      await rejected;
      expect((await client.checkAccess()).access).toBe("active");
    },
  );
  it("alternating live tabs preserve monotonic expiry when the wall clock is frozen", async () => {
    const second = await handoverClient(true);
    mono = 3600000;
    await client.checkAccess();
    await second.checkAccess();
    mono = 86400000;
    expect((await client.checkAccess()).access).toBe("expired");
    expect((await second.checkAccess()).access).toBe("expired");
  });
  it("two tabs reconcile the same elapsed interval without counting it twice", async () => {
    const second = await handoverClient(true);
    mono = 3600000;
    await client.checkAccess();
    await second.checkAccess();
    await client.checkAccess();
    expect(
      (await db.windows.get(api.current.account.id))?.elapsedAtCheckpointMs,
    ).toBe(3600000);
    expect(client.getState().access).toBe("active");
  });
  it("another tab resets its monotonic baseline when the capture context changes", async () => {
    const second = await handoverClient(true);
    now += 43200000;
    mono += 43200000;
    await second.checkAccess();
    await client.checkAccess();
    api.current = sessionFixture(now, api.current.account.id);
    await client.signIn("grace", "fictional");
    await second.checkAccess();
    expect(
      (await db.windows.get(api.current.account.id))?.elapsedAtCheckpointMs,
    ).toBe(0);
    expect(second.getState().access).toBe("active");
  });
  it("a delayed sign-in response expires at the original server deadline", async () => {
    await client.signOut();
    const entered = deferred<void>();
    const response = deferred<ReturnType<typeof sessionFixture>>();
    api.current = sessionFixture(now);
    const signedAt = now;
    api.signIn = () => {
      entered.resolve();
      return response.promise;
    };
    const pending = client.signIn("grace", "fictional");
    await entered.promise;
    now += 60000;
    mono += 60000;
    response.resolve(api.current);
    await pending;
    expect(
      (await db.windows.get(api.current.account.id))?.elapsedAtCheckpointMs,
    ).toBe(60000);
    now = signedAt + 86400000;
    mono = 86400000;
    expect((await client.checkAccess()).access).toBe("expired");
  });
  it("a slow refresh advances trusted age through receipt and never renews the sign-in anchor", async () => {
    const originalAnchor = api.current.lastOnlineSignInAt;
    const entered = deferred<void>();
    const response = deferred<ReturnType<typeof sessionFixture>>();
    const snapshot = {
      ...api.current,
      serverTime: new Date(now + 86340000).toISOString(),
    };
    api.session = () => {
      entered.resolve();
      return response.promise;
    };
    const pending = client.refresh();
    await entered.promise;
    // A frozen wall clock must not discard the response's 60-second transit time.
    mono += 60000;
    response.resolve(snapshot);
    await pending;
    const row = await db.windows.get(api.current.account.id);
    expect(row?.lastOnlineSignInAt).toBe(originalAnchor);
    expect(row?.elapsedAtCheckpointMs).toBe(86400000);
    expect((await client.checkAccess()).access).toBe("expired");
  });
  it("a response obtained across clock rollback locks the new window", async () => {
    await client.signOut();
    api.current = sessionFixture(now);
    const entered = deferred<void>();
    const response = deferred<ReturnType<typeof sessionFixture>>();
    api.signIn = () => {
      entered.resolve();
      return response.promise;
    };
    const pending = client.signIn("grace", "fictional");
    await entered.promise;
    now -= 1000;
    mono += 1000;
    response.resolve(api.current);
    await pending;
    expect((await client.checkAccess()).access).toBe("expired");
  });
  it("an authoritative mismatch hides and locks the context that made the request", async () => {
    api.session = async () => sessionFixture(now);
    expect((await client.refresh()).access).toBe("signed_out");
  });
  it("wrong photo digest cannot be saved", async () => {
    const form = await input();
    await expect(
      client.saveCapture(await client.beginCapture(), {
        ...form,
        photo: { ...form.photo, sha256: "0".repeat(64) },
      }),
    ).rejects.toMatchObject({ code: "photo_invalid" });
    expect(await client.ownSales()).toHaveLength(0);
  });
});

describe("P-23 immutable composition evidence", () => {
  const evidence = `lr1.test.cGF5bG9hZA.${"A".repeat(43)}`;
  async function selected() {
    const form = await input();
    form.customerCache = { ...form.customerCache!, lookupReceipt: evidence };
    api.lookup = async () => structuredClone(form.customerCache!);
    const found = await client.lookup(form.cardCode);
    const draft = client.selectLookup(
      await client.beginCapture(),
      form.cardCode,
      found,
    );
    return { form, draft };
  }
  it("retains cached evidence and original timestamp through offline restart", async () => {
    const { form } = await selected();
    client.close();
    online = false;
    const reopened = new AttendantClient(
      api,
      new CaptureDatabase(db.name),
      () => ({ wall: now, mono, runtimeId: "restart" }),
      () => false,
    );
    open.push(reopened);
    await reopened.initialize();
    const found = await reopened.lookup(form.cardCode);
    expect(found?.lookupReceipt === evidence).toBe(true);
    expect(found?.lookedUpAt).toBe(form.customerCache?.lookedUpAt);
  });
  it("does not reuse cached evidence across contexts or accounts", async () => {
    const { form } = await selected();
    const original = api.current;
    api.current = { ...original, captureContextId: uuidv7() };
    await client.signIn("grace", "fictional");
    online = false;
    expect((await client.lookup(form.cardCode))?.lookupReceipt).toBeNull();
    online = true;
    await client.signOut();
    api.current = sessionFixture(now);
    await client.signIn("other", "fictional");
    online = false;
    expect(await client.lookup(form.cardCode)).toBeNull();
  });
  it("freezes selected evidence before photo/save while lookup refreshes and inputs mutate", async () => {
    const { form, draft } = await selected();
    const newer = `lr1.test.bmV3ZXI.${"B".repeat(43)}`;
    form.customerCache!.lookupReceipt = newer;
    await client.lookup(form.cardCode);
    const saved = await client.saveCapture(draft, form);
    expect(saved.original.lookupReceipt === evidence).toBe(true);
    expect(
      (await client.ownSale(saved.operationId))?.original.lookupReceipt ===
        evidence,
    ).toBe(true);
  });
  it("quota rollback retains draft evidence and retries it unchanged despite a newer cache", async () => {
    const { form, draft } = await selected();
    const hook = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    db.outbox.hook("creating", hook);
    await expect(client.saveCapture(draft, form)).rejects.toMatchObject({
      code: "storage_failed",
    });
    expect(await db.outbox.count()).toBe(0);
    db.outbox.hook("creating").unsubscribe(hook);
    form.customerCache!.lookupReceipt = null;
    const row = await client.saveCapture(draft, form);
    expect(row.original.lookupReceipt === evidence).toBe(true);
    expect(row.photoBlob.size).toBe(form.photo.bytes);
  });
  it("legacy drafts do not acquire later evidence and originals survive database reopen unchanged", async () => {
    const draft = await client.beginCapture();
    const form = await input();
    form.customerCache!.lookupReceipt = evidence;
    const saved = await client.saveCapture(draft, form);
    expect(Object.hasOwn(saved.original, "lookupReceipt")).toBe(false);
    const serialized = JSON.stringify(saved.original);
    client.close();
    const reopened = new CaptureDatabase(db.name);
    await reopened.open();
    const retained = await reopened.outbox.get([
      saved.originatingAccountId,
      saved.operationId,
    ]);
    expect(JSON.stringify(retained?.original) === serialized).toBe(true);
    expect(retained?.photoBlob.size).toBe(form.photo.bytes);
    reopened.close();
  });
});

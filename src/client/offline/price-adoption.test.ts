import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, expect, it } from "vitest";
import { v7 } from "uuid";
import { AttendantClient } from "./client";
import { CaptureDatabase } from "./db";
import {
  FakeAttendantApi,
  sessionFixture,
} from "../../../tests/fixtures/attendant-client-fake";
import {
  ClientError,
  type CaptureInput,
  type Lookup,
  type Session,
} from "../types";

let now: number,
  mono: number,
  api: FakeAttendantApi,
  db: CaptureDatabase,
  client: AttendantClient;
const clients: AttendantClient[] = [];
const legacyDatabases: string[] = [];
function makeClient() {
  const runtimeId = v7();
  const next = new AttendantClient(
    api,
    new CaptureDatabase(db.name),
    () => ({ wall: now, mono, runtimeId }),
    () => true,
  );
  clients.push(next);
  return next;
}
beforeEach(async () => {
  now = Date.parse("2026-11-12T10:00:00Z");
  mono = 0;
  api = new FakeAttendantApi(sessionFixture(now));
  db = new CaptureDatabase(`price-${v7()}`);
  // Stable runtime identities are necessary for the trusted elapsed-time guard.
  const runtimeId = v7();
  client = new AttendantClient(
    api,
    db,
    () => ({ wall: now, mono, runtimeId }),
    () => true,
  );
  clients.push(client);
  await client.initialize();
  await client.signIn("grace.okon", "fictional");
});
afterEach(async () => {
  for (const item of clients) item.close();
  clients.length = 0;
  await db.delete();
  for (const name of legacyDatabases) await Dexie.delete(name);
  legacyDatabases.length = 0;
});
function price(
  version: number,
  rateKobo = "120000",
  quantityPrecision = 3,
): Session["price"] {
  return {
    ...api.current.price,
    priceVersionId: v7(),
    version,
    rateKobo,
    quantityPrecision,
  };
}
function lookup(p = price(2), session = api.current) {
  return {
    cardCode: "A7K3M9X",
    customer: { id: v7(), name: "Amina Bello", category: "car_owner" as const },
    lookedUpAt: new Date(now).toISOString(),
    priceRefresh: {
      captureContextId: session.captureContextId,
      originatingAccountId: session.account.id,
      stationId: session.station.id,
      assignmentId: session.assignment.id,
      pumpId: session.pump.id,
      productId: session.product.id,
      price: p,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function persisted() {
  return (await db.windows.get(api.current.account.id))!;
}

it("P-27 lookup commits the whole newer price before composition without enriching customer storage", async () => {
  const response = lookup();
  api.lookup = async () => response;
  const original = await client.beginCapture();
  const found = await client.lookup(response.cardCode);
  expect((await persisted()).session.price).toEqual(
    response.priceRefresh.price,
  );
  expect(client.getState().session?.price).toEqual(response.priceRefresh.price);
  expect((await client.beginCapture()).session.price).toEqual(
    response.priceRefresh.price,
  );
  expect(original.session.price).toEqual(api.current.price);
  expect(found).not.toHaveProperty("priceRefresh");
  expect(
    await db.customers.get([api.current.account.id, response.cardCode]),
  ).not.toHaveProperty("priceRefresh");
});
it("P-27 a delayed session cannot roll back a newer lookup snapshot or elapsed checkpoint", async () => {
  const entered = deferred<void>(),
    pending = deferred<Session>();
  api.session = async () => {
    entered.resolve();
    return pending.promise;
  };
  const refreshing = client.refresh();
  await entered.promise;
  now += 1000;
  mono += 1000;
  const newer = lookup(price(3, "90000", 2));
  api.lookup = async () => newer;
  await client.lookup(newer.cardCode);
  const checkpoint = (await persisted()).elapsedAtCheckpointMs;
  pending.resolve({ ...api.current, price: price(2) });
  await refreshing;
  expect((await persisted()).session.price).toEqual(newer.priceRefresh.price);
  expect((await persisted()).elapsedAtCheckpointMs).toBeGreaterThanOrEqual(
    checkpoint,
  );
});
it.each([
  { rateKobo: "100001" },
  { priceVersionId: v7() },
  { quantityPrecision: 2 },
  { effectiveFrom: "2026-11-11T10:00:00Z" },
])(
  "P-27 equal-version conflicting facts %j reject both read paths before changing price or customer cache",
  async (facts) => {
    const conflict = { ...api.current.price, ...facts };
    api.lookup = async () => lookup(conflict);
    await expect(client.lookup("A7K3M9X")).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(await db.customers.count()).toBe(0);
    api.session = async () => ({ ...api.current, price: conflict });
    await expect(client.refresh()).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect((await persisted()).session.price).toEqual(api.current.price);
  },
);
it("P-27 lookup persistence failure gives no adopted view or customer result", async () => {
  const old = structuredClone(api.current.price),
    response = lookup();
  api.lookup = async () => response;
  const stop = (changes: object) => {
    if (Object.keys(changes).some((key) => key.includes("price")))
      throw new Error("fictional write failure");
  };
  db.windows.hook("updating", stop);
  await expect(client.lookup(response.cardCode)).rejects.toThrow();
  db.windows.hook("updating").unsubscribe(stop);
  expect((await persisted()).session.price).toEqual(old);
  expect(client.getState().session?.price).toEqual(old);
  expect(await db.customers.count()).toBe(0);
});
it("P-27 two clients compose from the latest stored version even when their visible state was older", async () => {
  const other = makeClient();
  await other.initialize();
  const response = lookup(price(4));
  api.lookup = async () => response;
  await client.lookup(response.cardCode);
  expect((await other.beginCapture()).session.price).toEqual(
    response.priceRefresh.price,
  );
  expect(other.getState().session?.price).toEqual(response.priceRefresh.price);
});
it.each(["logout", "switch", "fresh", "expiry", "locked"] as const)(
  "P-27 delayed lookup after %s cannot mutate the active partition",
  async (action) => {
    const old = structuredClone(api.current),
      entered = deferred<void>(),
      pending = deferred<Lookup>();
    api.lookup = async () => {
      entered.resolve();
      return pending.promise;
    };
    const reading = client.lookup("A7K3M9X");
    const denied = expect(reading).rejects.toBeDefined();
    await entered.promise;
    if (action === "logout") await client.signOut();
    if (action === "switch" || action === "fresh") {
      api.current = sessionFixture(
        now,
        action === "fresh" ? old.account.id : v7(),
      );
      await client.signIn("current", "fictional");
    }
    if (action === "expiry") {
      now += 86400000;
      mono += 86400000;
    }
    if (action === "locked")
      await db.windows.update(old.account.id, { locked: true });
    pending.resolve(lookup(price(9), old));
    await denied;
    expect((await db.windows.get(old.account.id))?.session.price.version).toBe(
      1,
    );
    expect(await db.customers.count()).toBe(0);
  },
);
it("P-27 different acknowledged refresh bindings change neither price nor lookup state", async () => {
  const response = lookup();
  response.priceRefresh.assignmentId = v7();
  api.lookup = async () => response;
  await expect(client.lookup(response.cardCode)).rejects.toMatchObject({
    code: "invalid_response",
  });
  expect((await persisted()).session.price).toEqual(api.current.price);
  expect(await db.customers.count()).toBe(0);
});
it("P-27 malformed lookup payload cannot update either price or customer state", async () => {
  const response = lookup();
  Object.assign(response.priceRefresh.price, { version: 0 });
  api.lookup = async () => response;
  await expect(client.lookup(response.cardCode)).rejects.toMatchObject({
    code: "invalid_response",
  });
  expect(await db.customers.count()).toBe(0);
  expect((await persisted()).session.price).toEqual(api.current.price);
});
it("P-27 expired session read never installs its candidate", async () => {
  const entered = deferred<void>(),
    pending = deferred<Session>();
  api.session = async () => {
    entered.resolve();
    return pending.promise;
  };
  const refreshing = client.refresh();
  await entered.promise;
  now += 86400000;
  mono += 86400000;
  pending.resolve({
    ...api.current,
    price: price(5),
    serverTime: new Date(now).toISOString(),
  });
  await refreshing;
  expect((await persisted()).session.price).toEqual(api.current.price);
  expect(client.getState().access).toBe("expired");
});

it.each(["lookup", "session"] as const)(
  "P-27 a %s denial from a prior persisted sign-in generation cannot lock a replayed context",
  async (path) => {
    const entered = deferred<void>(),
      release = deferred<void>();
    const denial = async () => {
      entered.resolve();
      await release.promise;
      throw new ClientError("unauthenticated", "Denied");
    };
    if (path === "lookup") api.lookup = denial;
    else api.session = denial;
    const reading =
      path === "lookup"
        ? client.lookup("A7K3M9X").catch((error) => error)
        : client.refresh();
    await entered.promise;
    const other = makeClient();
    await other.initialize();
    await other.signIn("grace.okon", "fictional");
    release.resolve();
    const result = await reading;
    if (path === "lookup") {
      // The UI reports failed reads through this public authority-error path.
      await client.observeAuthorityError(result, api.current);
      expect(result).toMatchObject({ code: "account_changed" });
    }
    expect((await other.checkAccess()).access).toBe("active");
    expect((await persisted()).locked).toBe(false);
  },
);
it.each(["lookup", "session"] as const)(
  "P-27 a successful %s response from a prior persisted sign-in generation cannot update a replayed context",
  async (path) => {
    const entered = deferred<void>(),
      release = deferred<void>();
    const candidate = price(9);
    if (path === "lookup")
      api.lookup = async () => {
        entered.resolve();
        await release.promise;
        return lookup(candidate);
      };
    else
      api.session = async () => {
        entered.resolve();
        await release.promise;
        return { ...api.current, price: candidate };
      };
    const reading =
      path === "lookup"
        ? client.lookup("A7K3M9X").catch((error) => error)
        : client.refresh();
    await entered.promise;
    const other = makeClient();
    await other.initialize();
    await other.signIn("grace.okon", "fictional");
    release.resolve();
    await reading;
    expect((await persisted()).session.price.version).toBe(1);
    expect(await db.customers.count()).toBe(0);
  },
);
it.each(["station", "assignment", "pump", "product"] as const)(
  "P-27 a same-context session cannot acknowledge a changed %s binding",
  async (key) => {
    const changed = structuredClone(api.current);
    changed[key].id = v7();
    changed.price = price(2);
    api.session = async () => changed;
    await client.refresh();
    expect(
      (await db.windows.get(api.current.account.id))?.session.price.version,
    ).toBe(1);
    expect(client.getState().access).not.toBe("active");
  },
);
it.each(["effectiveFrom", "fetchedAt"] as const)(
  "P-27 session rejects a non-UTC %s",
  async (field) => {
    api.session = async () => ({
      ...api.current,
      price: { ...api.current.price, [field]: "2026-11-12T11:00:00+01:00" },
    });
    await expect(client.refresh()).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect((await persisted()).session.price).toEqual(api.current.price);
  },
);
it("P-27 equal version with only fetchedAt changed is a no-op, and lower lookup versions cannot roll back", async () => {
  const newer = lookup(price(3, "90000", 2));
  api.lookup = async () => newer;
  await client.lookup(newer.cardCode);
  api.lookup = async () =>
    lookup({
      ...newer.priceRefresh.price,
      fetchedAt: "2026-11-12T10:00:01.000Z",
    });
  await client.lookup(newer.cardCode);
  expect((await persisted()).session.price).toEqual(newer.priceRefresh.price);
  api.lookup = async () => lookup(price(2, "180000", 5));
  await client.lookup(newer.cardCode);
  expect((await persisted()).session.price).toEqual(newer.priceRefresh.price);
});
it.each([null, undefined])(
  "P-27 null or absent refresh preserves last price and successful customer resolution",
  async (priceRefresh) => {
    const response = { ...lookup(), priceRefresh };
    if (priceRefresh === undefined) delete response.priceRefresh;
    api.lookup = async () => response;
    expect((await client.lookup(response.cardCode))?.customer.id).toBe(
      response.customer.id,
    );
    expect((await persisted()).session.price).toEqual(api.current.price);
  },
);

it("P-27 a populated version-one store adopts price without rewriting legacy originals, blobs or selected evidence", async () => {
  const found = await client.lookup("A7K3M9X");
  const draft = await client.beginCapture(); // Legacy composition has no selected receipt field.
  const blob = new Blob(["fictional meter jpeg"], { type: "image/jpeg" });
  const sha256 = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  const input: CaptureInput = {
    cardCode: "A7K3M9X",
    customerCache: found,
    medium: "vehicle",
    basis: "amount",
    value: "20000.00",
    photo: { blob, sha256, bytes: blob.size, mediaType: "image/jpeg" },
  };
  const saved = await client.saveCapture(draft, input);
  // Populate the actual old schema, then open it through today's constructor.
  const name = `legacy-price-${v7()}`;
  legacyDatabases.push(name);
  const legacy = new Dexie(name);
  legacy.version(1).stores({
    outbox:
      "[originatingAccountId+operationId],[originatingAccountId+state],[originatingAccountId+nextAttemptAt]",
    windows: "originatingAccountId",
    customers: "[originatingAccountId+cardCode]",
    meta: "key",
  });
  const meta = { ...(await db.meta.get("installation"))! };
  delete meta.authGeneration;
  await legacy.table("meta").put(meta);
  await legacy.table("windows").put(await persisted());
  const rows = ["saved", "held", "credited", "cancelled"].map((state) => {
    const operationId = v7();
    return {
      ...saved,
      operationId,
      original: { ...saved.original, operationId },
      state,
    };
  });
  await legacy.table("outbox").bulkPut(rows);
  const otherId = v7();
  const other = { ...saved, originatingAccountId: otherId };
  await legacy.table("outbox").put(other);
  const cached = { ...found!, originatingAccountId: api.current.account.id };
  delete cached.lookupReceipt;
  await legacy.table("customers").put(cached);
  legacy.close();
  const upgraded = new CaptureDatabase(name),
    runtimeId = v7();
  const reader = new AttendantClient(
    api,
    upgraded,
    () => ({ wall: now, mono, runtimeId }),
    () => true,
  );
  clients.push(reader);
  await reader.initialize();
  const before = await upgraded.outbox.toArray();
  const originals = before.map((row) => JSON.stringify(row.original));
  const windowBefore = (await upgraded.windows.get(api.current.account.id))!;
  const response = lookup(price(7, "80000", 5));
  api.lookup = async () => response;
  await reader.lookup(response.cardCode);
  const after = await upgraded.outbox.toArray();
  expect(after.map((row) => JSON.stringify(row.original))).toEqual(originals);
  expect(await Promise.all(after.map((row) => row.photoBlob.text()))).toEqual(
    before.map(() => "fictional meter jpeg"),
  );
  expect(after.map((row) => row.photoDigest)).toEqual(
    before.map((row) => row.photoDigest),
  );
  expect(
    after.every((row) => !Object.hasOwn(row.original, "lookupReceipt")),
  ).toBe(true);
  expect(
    (await upgraded.windows.get(api.current.account.id))?.session.price,
  ).toEqual(response.priceRefresh.price);
  expect(
    (await upgraded.windows.get(api.current.account.id))?.lastOnlineSignInAt,
  ).toBe(windowBefore.lastOnlineSignInAt);
  expect(
    (await upgraded.windows.get(api.current.account.id))?.offlineExpiresAt,
  ).toBe(windowBefore.offlineExpiresAt);
  expect((await reader.beginCapture()).session.price.version).toBe(7);
  expect(draft.session.price.version).toBe(1);
  expect(await upgraded.outbox.get([otherId, saved.operationId])).toEqual(
    other,
  );
});
it("P-27 a failed save retries the same frozen price after a newer lookup and preserves pending correction payloads", async () => {
  const found = await client.lookup("A7K3M9X"),
    draft = client.selectLookup(await client.beginCapture(), "A7K3M9X", found, {
      receiptAtComposition: true,
    });
  const blob = new Blob(["fictional meter jpeg"], { type: "image/jpeg" });
  const sha256 = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
  const input: CaptureInput = {
    cardCode: "A7K3M9X",
    customerCache: found,
    medium: "vehicle",
    basis: "amount",
    value: "20000.00",
    photo: { blob, sha256, bytes: blob.size, mediaType: "image/jpeg" },
  };
  const fail = () => {
    throw new DOMException("full", "QuotaExceededError");
  };
  db.outbox.hook("creating", fail);
  await expect(client.saveCapture(draft, input)).rejects.toMatchObject({
    code: "storage_failed",
  });
  db.outbox.hook("creating").unsubscribe(fail);
  const next = lookup(price(2, "90000", 2));
  api.lookup = async () => next;
  await client.lookup(next.cardCode);
  const saved = await client.saveCapture(draft, input);
  expect(saved.original).toMatchObject({
    operationId: draft.operationId,
    appCapturedAt: draft.appCapturedAt,
    rateKobo: "100000",
    quantityPrecision: 3,
    entry: { amountKobo: "2000000", quantity: "20" },
  });
  const correction = await client.saveCorrection({
    source: { kind: "local", operationId: saved.operationId },
    value: "19000.00",
    reason: "Correct entered amount",
  });
  const before = JSON.stringify(correction),
    original = JSON.stringify(saved.original);
  api.lookup = async () => lookup(price(3, "80000", 4));
  await client.lookup("A7K3M9X");
  expect(
    JSON.stringify(
      await db.corrections.get([
        saved.originatingAccountId,
        correction.operationId,
      ]),
    ),
  ).toBe(before);
  expect(
    JSON.stringify(
      (await db.outbox.get([saved.originatingAccountId, saved.operationId]))
        ?.original,
    ),
  ).toBe(original);
});

it("P-27 customer resolution after composition never backfills later receipt evidence", async () => {
  const draft = await client.beginCapture();
  const later = {
    ...lookup(),
    lookupReceipt: `lr1.test.cGF5bG9hZA.${"A".repeat(43)}`,
  };
  const selected = client.selectLookup(draft, later.cardCode, later);
  expect(selected.selectedLookup?.lookupReceipt).toBeNull();
  expect(selected.selectedLookup?.customer?.customer.id).toBe(
    later.customer.id,
  );
  expect(selected.appCapturedAt).toBe(draft.appCapturedAt);
  expect(selected.session.price).toEqual(draft.session.price);
});

it("P-27 selection at composition freezes evidence and drops old-card evidence on explicit customer replacement", async () => {
  const initial = {
    ...lookup(),
    lookupReceipt: `lr1.test.cGF5bG9hZA.${"A".repeat(43)}`,
  };
  const selected = client.selectLookup(
    await client.beginCapture(),
    initial.cardCode,
    initial,
    { receiptAtComposition: true },
  );
  const refreshed = {
    ...initial,
    lookupReceipt: `lr1.test.bmV3.${"B".repeat(43)}`,
  };
  const resolved = client.selectLookup(selected, initial.cardCode, refreshed, {
    receiptAtComposition: true,
  });
  expect(resolved.selectedLookup?.lookupReceipt).toBe(initial.lookupReceipt);
  const noReceipt = client.selectLookup(
    await client.beginCapture(),
    initial.cardCode,
    initial,
  );
  expect(
    client.selectLookup(noReceipt, initial.cardCode, refreshed, {
      receiptAtComposition: true,
    }).selectedLookup?.lookupReceipt,
  ).toBeNull();
  const changed = client.selectLookup(selected, "B7K3M9X", {
    ...refreshed,
    cardCode: "B7K3M9X",
  });
  expect(changed.selectedLookup?.lookupReceipt).toBeNull();
  expect(changed.selectedLookup?.customer?.lookupReceipt).toBeNull();
  expect(changed.session.price).toEqual(selected.session.price);
  expect(changed.appCapturedAt).toBe(selected.appCapturedAt);
  expect(changed.operationId).toBe(selected.operationId);
  // Returning to the first card cannot recover or add evidence after composition.
  expect(
    client.selectLookup(changed, initial.cardCode, initial, {
      receiptAtComposition: true,
    }).selectedLookup?.lookupReceipt,
  ).toBeNull();
});

it("P-27 failed session persistence never publishes or stores its candidate", async () => {
  const original = structuredClone(api.current.price);
  api.session = async () => ({ ...api.current, price: price(2) });
  const fail = (changes: object) => {
    if (Object.keys(changes).some((key) => key.includes("price")))
      throw new Error("fictional session write failure");
  };
  db.windows.hook("updating", fail);
  const observed: number[] = [];
  const unsubscribe = client.subscribe(() => {
    const state = client.getState();
    if (state.session) observed.push(state.session.price.version);
  });
  await client.refresh();
  unsubscribe();
  db.windows.hook("updating").unsubscribe(fail);
  expect((await persisted()).session.price).toEqual(original);
  expect(client.getState().session?.price).toEqual(original);
  expect(observed.every((version) => version === original.version)).toBe(true);
});

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { AttendantClient } from "./client";
import { CaptureDatabase } from "./db";
import {
  FakeAttendantApi,
  sessionFixture,
} from "../../../tests/fixtures/attendant-client-fake";
import type { CapturedPhoto, CaptureInput } from "../types";
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
    let resolve!: (
      value: Awaited<ReturnType<FakeAttendantApi["lookup"]>>,
    ) => void;
    const result = await api.lookup({ source: "code", code: "A7K3M9X" });
    api.lookup = () =>
      new Promise((r) => {
        resolve = r;
      });
    const pending = client.lookup("A7K3M9X");
    await new Promise((r) => setTimeout(r, 5));
    api.current = { ...api.current, captureContextId: uuidv7() };
    await client.signIn("grace", "fictional");
    resolve(result);
    await expect(pending).rejects.toMatchObject({ code: "account_changed" });
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

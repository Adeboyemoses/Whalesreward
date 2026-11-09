import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { v7 } from "uuid";
import { AttendantClient } from "./client";
import { CaptureDatabase } from "./db";
import {
  FakeAttendantApi,
  sessionFixture,
} from "../../../tests/fixtures/attendant-client-fake";
import { ClientError, type RestrictedSession } from "../types";
let now: number;
let api: FakeAttendantApi;
let db: CaptureDatabase;
let client: AttendantClient;
const clients: AttendantClient[] = [];
function restricted(): RestrictedSession {
  return {
    state: "password_change_required",
    account: {
      id: v7(),
      staffCode: "STAFFTEST",
      name: "Favour James",
      username: "favour.test",
    },
    sessionExpiresAt: new Date(now + 900000).toISOString(),
    serverTime: new Date(now).toISOString(),
  };
}
function makeClient() {
  const c = new AttendantClient(
    api,
    db,
    () => ({ wall: now, mono: now, runtimeId: "test" }),
    () => true,
  );
  clients.push(c);
  return c;
}
beforeEach(async () => {
  now = Date.parse("2026-11-09T10:00:00Z");
  api = new FakeAttendantApi(sessionFixture(now));
  db = new CaptureDatabase("access-" + v7());
  client = makeClient();
  await client.initialize();
});
afterEach(async () => {
  for (const c of clients) c.close();
  clients.length = 0;
  await db.delete();
});
it("WHR-77 restricted sign-in hides the prior account and creates no offline anchor or persisted restricted identity", async () => {
  await client.signIn("grace.okon", "fictional");
  const old = api.current;
  const response = restricted();
  api.signIn = async () => response;
  await client.signIn("favour.test", "fictional");
  expect(client.getState()).toMatchObject({
    access: "password_change_required",
    session: null,
    restrictedSession: response,
  });
  expect((await db.meta.get("installation"))?.activeAccountId).toBeNull();
  expect(await db.windows.get(response.account.id)).toBeUndefined();
  expect((await db.windows.get(old.account.id))?.locked).toBe(true);
  expect(JSON.stringify(await db.meta.toArray())).not.toContain(
    response.account.id,
  );
  expect(await client.ownSales()).toEqual([]);
  await expect(client.beginCapture()).rejects.toMatchObject({
    code: "access_expired",
  });
  expect((await client.checkAccess()).access).toBe("password_change_required");
});
it("WHR-77 reload discovers only restricted cookie state; completion requires another explicit online sign-in", async () => {
  const response = restricted();
  api.session = async () => response;
  await client.refresh();
  expect(client.getState().access).toBe("password_change_required");
  const input = {
    operationId: v7(),
    currentPassword: " temporary space ",
    newPassword: " a different 密碼 ",
    confirmPassword: " a different 密碼 ",
  };
  api.completeFirstPassword = vi.fn(async () => undefined);
  await client.completeFirstPassword(input);
  expect(api.completeFirstPassword).toHaveBeenCalledWith(input);
  expect(client.getState()).toMatchObject({
    access: "signed_out",
    session: null,
  });
  expect(client.getState().restrictedSession).toBeUndefined();
  expect(await db.windows.count()).toBe(0);
  await expect(client.beginCapture()).rejects.toMatchObject({
    code: "access_expired",
  });
  api.current = sessionFixture(now, response.account.id);
  await client.signIn("favour.test", input.newPassword);
  expect(client.getState().access).toBe("active");
  expect(await db.windows.count()).toBe(1);
});
it("WHR-77 a delayed password completion cannot clear a newer account or reopen a restricted session", async () => {
  const response = restricted();
  api.session = async () => response;
  await client.refresh();
  let release!: () => void;
  api.completeFirstPassword = () =>
    new Promise<void>((r) => {
      release = r;
    });
  const finishing = client.completeFirstPassword({
    operationId: v7(),
    currentPassword: "temporary pass",
    newPassword: "new fictional password",
    confirmPassword: "new fictional password",
  });
  const failed = expect(finishing).rejects.toMatchObject({
    code: "account_changed",
  });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await client.signOut();
  await client.signIn("grace.okon", "fictional");
  const current = client.getState().session;
  release();
  await failed;
  expect(client.getState().access).toBe("active");
  expect(client.getState().session).toEqual(current);
});
it("P-21 observed revocation detaches protected identity and queue access but keeps original rows and anchor", async () => {
  await client.signIn("grace.okon", "fictional");
  const account = api.current.account.id;
  const window = await db.windows.get(account);
  api.session = async () => {
    throw new ClientError("unauthenticated", "Revoked", 401);
  };
  await client.refresh();
  expect(client.getState()).toMatchObject({
    access: "signed_out",
    session: null,
  });
  expect((await db.meta.get("installation"))?.activeAccountId).toBeNull();
  expect(await client.ownSales()).toEqual([]);
  expect((await db.windows.get(account))?.lastOnlineSignInAt).toBe(
    window?.lastOnlineSignInAt,
  );
  expect((await db.windows.get(account))?.locked).toBe(true);
});

it("A17 reads the configured target separately and never rewrites the acknowledged capture context or anchor", async () => {
  await client.signIn("grace.okon", "fictional");
  const original = structuredClone(client.getState().session!);
  const window = await db.windows.get(original.account.id);
  const configured = {
    configured: {
      ...original.assignment,
      id: v7(),
      version: 2,
      pump: { id: v7(), code: "P04", name: "Pump 04" },
      product: { id: v7(), code: "kerosene" as const, unit: "litre" as const },
      effectiveFrom: new Date(now).toISOString(),
    },
    acknowledgedAssignmentId: original.assignment.id,
    reassignmentRequiresSignIn: true,
  };
  api.configuredAssignment = async () => configured;
  expect(await client.configuredAssignment()).toEqual(configured);
  expect(client.getState().session).toEqual(original);
  expect((await db.windows.get(original.account.id))?.lastOnlineSignInAt).toBe(
    window?.lastOnlineSignInAt,
  );
  expect((await client.beginCapture()).session).toEqual(original);
});
it("WHR-77 a background check preserves the active restricted generation and in-flight completion", async () => {
  const response = restricted();
  api.session = async () => response;
  await client.refresh();
  const first = client.getState().restrictionId;
  let release!: () => void;
  api.completeFirstPassword = () =>
    new Promise<void>((r) => {
      release = r;
    });
  const completing = client.completeFirstPassword({
    operationId: v7(),
    currentPassword: "temporary password",
    newPassword: "different password",
    confirmPassword: "different password",
  });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await client.refresh();
  expect(client.getState().restrictionId).toBe(first);
  release();
  await completing;
  expect(client.getState().access).toBe("signed_out");
  expect(await db.windows.count()).toBe(0);
});
it("WHR-77 a sign-out from another tab fences a held restricted response", async () => {
  let release!: (value: RestrictedSession) => void;
  api.signIn = () =>
    new Promise((r) => {
      release = r;
    });
  const pending = client.signIn("favour.test", "fictional");
  const denied = expect(pending).rejects.toMatchObject({
    code: "account_changed",
  });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const other = makeClient();
  await other.signOut();
  release(restricted());
  await denied;
  expect((await client.checkAccess()).access).toBe("signed_out");
  expect(await db.windows.count()).toBe(0);
});

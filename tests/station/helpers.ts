import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { v7 } from "uuid";
import { randomBytes } from "node:crypto";
import { fixture, signIn } from "../admin-access/admin-access.fixtures";

export const seedId = (n: number) =>
  `019a5000-0000-7000-8000-${String(n).padStart(12, "0")}`;
export type StationFixture = Awaited<ReturnType<typeof stationFixture>>;
export async function stationFixture(page: Page, grants?: string[]) {
  const f = await fixture();
  await f.db.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [f.userId],
  );
  if (grants) {
    const roleId = v7();
    await f.db.query(
      "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,false,true,1)",
      [roleId, `Station fixture ${roleId}`],
    );
    for (const permission of grants)
      await f.db.query(
        "INSERT INTO role_permission(role_id,permission_code) VALUES($1,$2)",
        [roleId, permission],
      );
    await f.db.query(
      "UPDATE admin SET role_id=$1,version=version+1 WHERE id=$2",
      [roleId, f.adminId],
    );
  }
  const login = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/sign-in") && r.request().method() === "POST",
  );
  await signIn(page, f.username, f.password);
  expect((await login).status()).toBe(200);
  await expect(page).not.toHaveURL(/\/admin\/(?:sign-in|first-password)$/);
  return f;
}
export async function api<T>(
  request: APIRequestContext,
  path: string,
  input?: unknown,
  status = 200,
): Promise<T> {
  const response =
    input === undefined
      ? await request.get(`/api/admin/${path}`)
      : await request.post(`/api/admin/${path}`, {
          headers: { Origin: "http://127.0.0.1:3000" },
          data: input,
        });
  expect(response.status(), `HTTP ${path}`).toBe(status);
  const json = await response.json();
  return json.data as T;
}
export type Attendant = {
  id: string;
  accountId: string;
  staffCode: string;
  name: string;
  username: string;
  version: number;
  createdAt: string;
  assignment: null | {
    id: string;
    version: number;
    pump: { id: string; code: string; name: string };
    product: { id: string; code: string; unit: "litre" | "kilogram" };
    effectiveFrom: string;
  };
  handover: "fresh_sign_in_required" | "acknowledged" | "unassigned";
};
export async function createAttendant(page: Page, name = "Grace Okon") {
  const password = randomBytes(20).toString("hex");
  const username = `station.${v7().slice(-12)}`;
  const attendant = await api<Attendant>(
    page.request,
    "attendants",
    {
      operationId: v7(),
      name,
      username,
      password,
      pumpId: seedId(14),
      expectedPumpVersion: 1,
    },
    201,
  );
  return { attendant, password, username };
}
export async function attendantSignIn(
  page: Page,
  username: string,
  password: string,
) {
  await page.goto("/attendant/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
export async function captureStorage(page: Page) {
  return page.evaluate(async () => {
    const empty = {
      windows: [] as unknown[],
      outbox: [] as unknown[],
      activeAccountId: null as string | null,
      local: Object.keys(localStorage),
      session: Object.keys(sessionStorage),
    };
    if (
      !(await indexedDB.databases()).some(
        (db) => db.name === "whales-capture-v1",
      )
    )
      return empty;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const q = indexedDB.open("whales-capture-v1");
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    const all = (store: string) =>
      new Promise<unknown[]>((resolve, reject) => {
        if (!db.objectStoreNames.contains(store)) return resolve([]);
        const q = db.transaction(store).objectStore(store).getAll();
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
    const [windows, outbox, meta] = await Promise.all([
      all("windows"),
      all("outbox"),
      all("meta"),
    ]);
    db.close();
    return {
      ...empty,
      windows,
      outbox,
      activeAccountId:
        (meta[0] as { activeAccountId?: string | null } | undefined)
          ?.activeAccountId ?? null,
    };
  });
}
export function barrier() {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const started = new Promise<void>((resolve) => {
    reached = resolve;
  });
  return { release, blocked, reached, started };
}

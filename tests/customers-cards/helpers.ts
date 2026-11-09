import { expect, type Page } from "@playwright/test";
import { v7 } from "uuid";
import {
  stationFixture,
  createAttendant,
  attendantSignIn,
  api,
} from "../station/helpers";
export { stationFixture, api };
export async function registrationFixture(page: Page) {
  const admin = await stationFixture(page);
  const created = await createAttendant(page);
  await admin.db.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [created.attendant.accountId],
  );
  let batch = await api<{ id: string; version: number }>(
    page.request,
    "card-batches",
    { operationId: v7(), name: "Fictional registration stock", count: 6 },
    201,
  );
  for (const action of ["mark-printed", "activate"])
    batch = await api(page.request, `card-batches/${batch.id}/${action}`, {
      operationId: v7(),
      expectedVersion: batch.version,
      reason: "Fictional local stock review",
    });
  const cards = await api<{ items: { code: string }[] }>(
    page.request,
    `card-batches/${batch.id}/cards`,
  );
  await attendantSignIn(page, created.username, created.password);
  await expect(page).toHaveURL(/\/attendant\/sale$/);
  return { ...admin, ...created, batch, codes: cards.items.map((c) => c.code) };
}
export const phoneNumber = () =>
  `080${String(BigInt("0x" + v7().replaceAll("-", "").slice(-9)) % 100000000n).padStart(8, "0")}`;
export async function fillRegistration(
  page: Page,
  code: string,
  phone = phoneNumber(),
  name = "Amina Bello",
) {
  await page.getByLabel("Customer name", { exact: true }).fill(name);
  await page.getByLabel("Phone number", { exact: true }).fill(phone);
  await page.getByRole("button", { name: /^Customer category/ }).click();
  await page.getByRole("button", { name: "Car owner", exact: true }).click();
  await page.getByLabel("Card number", { exact: true }).fill(code);
  return phone;
}
export async function noPII(page: Page, values: string[]) {
  const stored = await page.evaluate(async () => {
    const all: unknown[] = [
      Object.entries(localStorage),
      Object.entries(sessionStorage),
    ];
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const q = indexedDB.open(info.name!);
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      for (const store of Array.from(db.objectStoreNames))
        all.push(
          await new Promise((resolve, reject) => {
            const q = db.transaction(store).objectStore(store).getAll();
            q.onsuccess = () => resolve(q.result);
            q.onerror = () => reject(q.error);
          }),
        );
      db.close();
    }
    for (const key of await caches.keys())
      for (const req of await (await caches.open(key)).keys()) {
        all.push(req.url);
        const response = await (await caches.open(key)).match(req);
        if (response?.headers.get("content-type")?.includes("json"))
          all.push(await response.text());
      }
    return JSON.stringify(all);
  });
  for (const value of values) expect(stored).not.toContain(value);
  for (const value of values) expect(page.url()).not.toContain(value);
}

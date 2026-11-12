import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { v7 } from "uuid";
import { stationFixture, seedId } from "../station/helpers";
import { phoneNumber } from "../customers-cards/helpers";
import { phoneTestAdapter } from "../helpers/customer-recovery-fixture";
import {
  recoveryWrite,
  recoveryWriteSchemas,
  type RecoveryWrite,
} from "../../src/server/modules/customers/recovery";
import { AuthError } from "../../src/server/modules/auth/errors";
import { COOKIE } from "../../src/server/modules/admin-access/http";

const cardCode = () =>
  Array.from(
    randomBytes(7),
    (n) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[n % 32],
  ).join("");
export async function recoveryFixture(
  page: Page,
  grants = ["customers", "recovery"],
) {
  const f = await stationFixture(page, grants);
  const customerId = v7(),
    oldCardId = v7(),
    newCardId = v7(),
    batchId = v7();
  const oldCard = cardCode(),
    newCard = cardCode(),
    phone = phoneNumber();
  const customerCode = `REC-${customerId.slice(-8)}`;
  await f.db.query(
    "INSERT INTO customer(id,customer_code,name,phone_normalized,category,version,registered_station_id,registered_by_user_id) VALUES($1,$2,'Amina Bello',$3,'car_owner',1,$4,$5)",
    [customerId, customerCode, `+234${phone.slice(1)}`, seedId(8), f.userId],
  );
  await f.db.query(
    "INSERT INTO card_batch(id,batch_code,name,status,version,created_by) VALUES($1,$2,'Fictional recovery stock','generated',1,$3)",
    [batchId, `REC-${batchId.slice(-8)}`, f.adminId],
  );
  await f.db.query(
    "UPDATE card_batch SET status='printed',version=2 WHERE id=$1",
    [batchId],
  );
  await f.db.query(
    "UPDATE card_batch SET status='active',version=3 WHERE id=$1",
    [batchId],
  );
  for (const [id, code] of [
    [oldCardId, oldCard],
    [newCardId, newCard],
  ])
    await f.db.query(
      "INSERT INTO card(id,batch_id,code,qr_payload,state,version) VALUES($1,$2,$3,$3,'unassigned',1)",
      [id, batchId, code],
    );
  await f.db.query(
    "INSERT INTO card_customer_link(id,card_id,customer_id,linked_at,actor_user_id,reason) VALUES($1,$2,$3,clock_timestamp(),$4,'Fictional registration')",
    [v7(), oldCardId, customerId, f.userId],
  );
  await f.db.query("UPDATE card SET state='linked',version=2 WHERE id=$1", [
    oldCardId,
  ]);
  return {
    ...f,
    customerId,
    customerCode,
    oldCardId,
    newCardId,
    oldCard,
    newCard,
    phone,
    root: `/admin/customers/${customerId}`,
  };
}
export async function fillPhone(page: Page, phone = phoneNumber()) {
  await page.getByLabel("New phone number", { exact: true }).fill(phone);
  await page
    .getByLabel("I checked the customer's active loyalty card in person.", {
      exact: true,
    })
    .check();
  await page
    .getByLabel("Reason for change", { exact: true })
    .fill("Customer changed network provider; old line no longer in use.");
  return phone;
}
export async function fillIntake(page: Page) {
  await page
    .getByLabel("Review notes", { exact: true })
    .fill("Passport inspected in person; registered name matched.");
  await page
    .getByLabel("Why the code cannot be used", { exact: true })
    .fill("Customer cannot access the registered phone.");
  await page
    .getByLabel("The customer is present for an in-person review.", {
      exact: true,
    })
    .check();
}
export async function identityState(
  f: Awaited<ReturnType<typeof recoveryFixture>>,
) {
  return (
    await f.db.query(
      "SELECT c.version,c.phone_normalized,l.card_id FROM customer c JOIN card_customer_link l ON l.customer_id=c.id AND l.ended_at IS NULL WHERE c.id=$1",
      [f.customerId],
    )
  ).rows;
}

/** Browser-to-service test bridge, NOT a configured production HTTP endpoint.
 * Production HTTP intentionally has no adapter injection. Only C03 writes are
 * dispatched to the real service, real session and PostgreSQL from this test
 * process. All reads, C02/C04 writes and unconfigured checks use real Next HTTP.
 * Dynamic code lives in the existing server test adapter and form memory only.
 */
export async function verificationBridge(page: Page, customerId: string) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const delivery = phoneTestAdapter(pool);
  Object.assign(delivery.adapter.policy, {
    lifetimeMs: 300000,
    resendMs: 3000,
  });
  const config = {
    secret: randomBytes(32).toString("hex"),
    origin: "http://127.0.0.1:3000",
  };
  const previousNodeEnv = process.env.NODE_ENV,
    previousEnv = process.env.WHR_ENV;
  Object.assign(process.env, { NODE_ENV: "test", WHR_ENV: "local" });
  let challengeId: string | undefined;
  const errors: string[] = [];
  const routePattern = `**/api/admin/customers/${customerId}/**`;
  await page.route(routePattern, async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const prefix = `/api/admin/customers/${customerId}/`;
    if (request.method() !== "POST") return route.continue();
    const tail = url.pathname.slice(prefix.length);
    let action: RecoveryWrite | undefined, target: string | undefined;
    if (tail === "card-verifications") action = "issue";
    else if (tail === "card-replacement") action = "replace";
    else {
      const match = /^card-verifications\/([0-9a-f-]{36})\/verify$/.exec(tail);
      if (match) {
        action = "verify";
        target = match[1];
      }
    }
    if (!action) return route.continue();
    expect(url.origin).toBe(config.origin);
    expect(request.headers().origin).toBe(config.origin);
    expect(url.search).toBe("");
    const token = (await page.context().cookies(config.origin)).find(
      (c) => c.name === COOKIE,
    )?.value;
    let input: unknown = request.postDataJSON();
    try {
      const parsed = recoveryWriteSchemas[action].parse(input);
      const data = await recoveryWrite(
        pool,
        config,
        token,
        action,
        customerId,
        parsed,
        { adapter: delivery.adapter, ip: "192.0.2.89" },
        target,
      );
      if (action === "issue") challengeId = (data as { id: string }).id;
      await route.fulfill({
        status: action === "issue" ? 202 : 200,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({
          data,
          serverTime: new Date().toISOString(),
          requestId: v7(),
        }),
      });
    } catch (error) {
      if (!(error instanceof AuthError))
        throw new Error(
          "Unexpected server bridge failure; inspect without dumping secret inputs",
        );
      errors.push(error.code);
      await route.fulfill({
        status: error.status,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({
          error: {
            code: error.code,
            message: "This request could not be completed.",
            retryable: false,
          },
          serverTime: new Date().toISOString(),
          requestId: v7(),
        }),
      });
    } finally {
      input = undefined;
    }
  });
  return {
    errors,
    async enterCode(correct = true) {
      if (!challengeId) throw new Error("No issued challenge");
      // Never pass the secret to expect, test titles, attachments, console or traces.
      let value = correct
        ? delivery.code(challengeId)
        : randomBytes(12).toString("hex");
      await page
        .getByLabel("Verification code", { exact: true })
        .evaluate((element, secret) => {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )!.set!;
          setter.call(element, secret);
          element.dispatchEvent(new Event("input", { bubbles: true }));
        }, value);
      value = "";
    },
    async hasPersistedCode() {
      if (!challengeId) return false;
      const value = delivery.code(challengeId);
      const stored = await page.evaluate(async () => {
        const values: unknown[] = [
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
            values.push(
              await new Promise((resolve, reject) => {
                const q = db.transaction(store).objectStore(store).getAll();
                q.onsuccess = () => resolve(q.result);
                q.onerror = () => reject(q.error);
              }),
            );
          db.close();
        }
        return JSON.stringify(values);
      });
      return stored.includes(value) || page.url().includes(value);
    },
    async close() {
      await page.unrouteAll({ behavior: "wait" });
      if (previousNodeEnv === undefined)
        Reflect.deleteProperty(process.env, "NODE_ENV");
      else Object.assign(process.env, { NODE_ENV: previousNodeEnv });
      if (previousEnv === undefined) delete process.env.WHR_ENV;
      else process.env.WHR_ENV = previousEnv;
      await pool.end();
    },
  };
}

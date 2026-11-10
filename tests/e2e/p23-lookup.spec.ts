import { test, expect } from "@playwright/test";
import {
  registrationFixture,
  fillRegistration,
} from "../customers-cards/helpers";
import { ensureLocalCardBucket } from "../customers-cards/storage";

test.use({
  trace: "off",
  video: "off",
  screenshot: "off",
  permissions: ["camera"],
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

test("P-23 s06+s08 real register then sell preserves evidence and credits once", async ({
  page,
}) => {
  await ensureLocalCardBucket();
  const f = await registrationFixture(page);
  try {
    await page.goto("/attendant/register");
    await fillRegistration(page, f.codes[0]!);
    const registration = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/attendant/customers",
    );
    await page
      .getByRole("button", { name: "Register and link card", exact: true })
      .click();
    const registered = await registration;
    expect(registered.request().headers()["x-wr-lookup-receipt"]).toBe("1");
    expect(
      typeof (await registered.json()).data.lookupReceipt === "string",
    ).toBe(true);
    await expect(page).toHaveURL(/\/done$/);
    const currentLookup = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/attendant/cards/lookup",
    );
    await page
      .getByRole("button", { name: "Record a sale for Amina", exact: true })
      .click();
    await currentLookup;
    await expect(page).toHaveURL(/\/attendant\/sale$/);
    await expect(
      page.getByText("Amina Bello", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Take meter photo/ }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Vehicle", exact: true }).click();
    await page.getByLabel("Amount in naira", { exact: true }).fill("20000.00");
    await page.getByRole("button", { name: /^Take meter photo/ }).click();
    await page.getByRole("button", { name: "Take photo", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Retake", exact: true }),
    ).toBeVisible();
    const submitted = page.waitForRequest(
      (r) => new URL(r.url()).pathname === "/api/sync/sales",
    );
    await page
      .getByRole("button", { name: /^Save sale(?: on phone)?$/ })
      .click();
    const original = (await submitted).postDataJSON();
    expect(typeof original.lookupReceipt === "string").toBe(true);
    await expect(
      page.getByRole("heading", { name: "Sale synced", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const result = await f.db.query(
      "SELECT lookup_receipt_status,status FROM purchase WHERE operation_id=$1 AND originating_attendant_id=$2",
      [original.operationId, f.attendant.id],
    );
    expect(
      result.rows.map((r) => ({
        receiptValid: r.lookup_receipt_status === "valid",
        status: r.status,
      })),
    ).toEqual([{ receiptValid: true, status: "credited" }]);
    expect(
      await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const q = indexedDB.open("whales-capture-v1");
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
        });
        const rows = await new Promise<
          Array<{ original: { lookupReceipt?: string }; state: string }>
        >((resolve, reject) => {
          const q = db.transaction("outbox").objectStore("outbox").getAll();
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
        });
        db.close();
        return (
          rows.length === 1 &&
          typeof rows[0]?.original.lookupReceipt === "string" &&
          rows[0]?.state === "credited"
        );
      }),
    ).toBe(true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Sale synced", exact: true }),
    ).toBeVisible();
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM purchase WHERE operation_id=$1 AND originating_attendant_id=$2",
          [original.operationId, f.attendant.id],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await f.db.end();
  }
});

import { expect, type Page } from "@playwright/test";
import type { OutboxRow } from "../../src/client/types";

export async function signIn(page: Page, username = "grace.okon") {
  await page.goto("/attendant/sign-in");
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page
    .getByLabel("Password", { exact: true })
    .fill("fictional-test-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/attendant\/sale$/);
}

export async function fillSale(
  page: Page,
  options: {
    code?: string;
    gas?: boolean;
    value?: string;
    quantity?: boolean;
  } = {},
) {
  await page
    .getByLabel("Or enter the card number", { exact: true })
    .fill(options.code ?? "A7K3M9Q");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  if (!options.gas)
    await page.getByRole("button", { name: "Vehicle", exact: true }).click();
  if (options.quantity)
    await page
      .getByRole("button", {
        name: options.gas ? "Kilograms" : "Litres",
        exact: true,
      })
      .click();
  const entry = page.getByLabel(
    options.quantity
      ? options.gas
        ? "Kilograms"
        : "Litres"
      : "Amount in naira",
    { exact: true },
  );
  // Focus restores raw amount text; wait for that React render before select-all.
  await entry.focus();
  await expect(entry).not.toHaveValue(/,/);
  await entry.fill(options.value ?? "20000.01");
  await page.getByRole("button", { name: /^Take meter photo/ }).click();
  await page.getByRole("button", { name: "Take photo", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Retake", exact: true }),
  ).toBeVisible();
}

export async function rows(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("whales-capture-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<OutboxRow[]>((resolve, reject) => {
      const request = db.transaction("outbox").objectStore("outbox").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return Promise.all(
      records.map(async (row) => {
        const blob = row.photoBlob as Blob;
        const digest = Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
          ),
        )
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("");
        return {
          ...row,
          photoDigest: String(row.photoDigest),
          photoBlob: { size: blob.size, type: blob.type, digest },
        };
      }),
    );
  });
}

export async function save(page: Page) {
  await page.getByRole("button", { name: /^Save sale(?: on phone)?$/ }).click();
  await expect(
    page.getByRole("heading", { name: /^(Saved on phone|Upload pending)$/ }),
  ).toBeVisible();
}

export async function waitForWorker(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null)))
    await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller !== null),
    )
    .toBe(true);
}

import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { v7 as uuidv7 } from "uuid";
import type { OutboxRow } from "../../../src/client/types";
import { installAttendantFake } from "../../fixtures/attendant-http-fake";
import {
  fillSale,
  save,
  signIn,
  waitForWorker,
} from "../../fixtures/offline-browser";

async function capture(page: Page, board: string, width: number) {
  const boardHeight = ["A04-SaleSynced", "A16-GasSynced"].includes(board)
    ? 1108
    : 844;
  await page.setViewportSize({ width, height: boardHeight });
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
  });
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  await page.setViewportSize({ width, height: Math.max(boardHeight, height) });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const small = await page.locator("button, input, a").evaluateAll((elements) =>
    elements
      .filter((element) => {
        const r = element.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.height < 48;
      })
      .map((element) => ({
        text: element.textContent,
        height: element.getBoundingClientRect().height,
      })),
  );
  expect(small).toEqual([]);
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(
      import.meta.dirname,
      "screenshots",
      `${board}-${width}.built.png`,
    ),
    fullPage: true,
    animations: "disabled",
  });
}
for (const width of [390, 360]) {
  for (const state of ["credited", "held", "gas", "pending"] as const) {
    test(`upload ${state} boards at ${width}px`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 844 });
      const fake = await installAttendantFake(context, { sync: true });
      if (state === "held") fake.sync.setOutcome("held");
      if (state === "pending") fake.sync.setPutFailure(true);
      await signIn(page, state === "gas" ? "favour.james" : "grace.okon");
      await waitForWorker(page);
      await fillSale(page, {
        gas: state === "gas",
        value:
          state === "gas"
            ? "15000.00"
            : state === "held"
              ? "10000.00"
              : "20000.00",
      });
      fake.setOffline(true);
      await context.setOffline(true);
      await save(page);
      fake.setOffline(false);
      await context.setOffline(false);
      if (state === "pending") {
        await expect(
          page.getByRole("heading", {
            name: "Photo upload failed",
            exact: true,
          }),
        ).toBeVisible({ timeout: 20000 });
        await page.goto("/attendant/uploads");
        await expect(
          page.getByText("Photo upload failed", { exact: true }),
        ).toBeVisible();
        await page.evaluate(async (operationId) => {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const open = indexedDB.open("whales-capture-v1");
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error);
          });
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("outbox", "readwrite");
            const store = tx.objectStore("outbox");
            const request = store.getAll();
            request.onsuccess = () => {
              const first = request.result[0] as OutboxRow;
              first.nextAttemptAt = new Date(
                Date.now() + 3600000,
              ).toISOString();
              first.localSavedAt = "2026-11-04T09:42:00.000Z";
              store.put(first);
              const second = structuredClone(first);
              second.operationId = operationId;
              second.original = {
                ...second.original,
                operationId,
                cardCode: "B7K3M9Q",
                medium: "keg",
                entry: {
                  basis: "amount",
                  enteredAmountKobo: "1000000",
                  amountKobo: "1000000",
                  quantity: "10",
                },
              };
              second.customerCache = {
                cardCode: "B7K3M9Q",
                customer: {
                  id: operationId,
                  name: "Tunde Adebayo",
                  category: "keg_buyer",
                },
                lookedUpAt: first.localSavedAt,
              };
              second.localSavedAt = "2026-11-04T09:45:00.000Z";
              second.state = "saved";
              second.serverStatus = null;
              second.purchaseId = null;
              second.serverVersion = null;
              second.lastErrorCode = null;
              second.uploadId = null;
              second.uploadOperationId = null;
              second.finalizeRequest = null;
              second.syncLease = null;
              store.put(second);
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
          db.close();
        }, uuidv7());
        await page.reload();
        await expect(
          page.getByText("2 sales waiting", { exact: true }),
        ).toBeVisible();
        await capture(page, "A08-PendingUploads", width);
      } else {
        await expect(
          page.getByRole("heading", {
            name: state === "held" ? "Awaiting price review" : "Sale synced",
            exact: true,
          }),
        ).toBeVisible({ timeout: 20000 });
        if (state === "held") {
          const operationId = page.url().split("/").at(-2)!;
          await page.goto(`/attendant/uploads/${operationId}`);
          await expect(
            page.getByRole("heading", {
              name: "Awaiting price review",
              exact: true,
            }),
          ).toBeVisible();
        }
        await capture(
          page,
          state === "held"
            ? "A14-PriceReview"
            : state === "gas"
              ? "A16-GasSynced"
              : "A04-SaleSynced",
          width,
        );
        if (state === "credited") {
          await page.goto("/attendant/uploads");
          await expect(
            page.getByRole("heading", {
              name: "All uploads complete",
              exact: true,
            }),
          ).toBeVisible();
          await capture(page, "A23-PendingUploadsEmpty", width);
        }
      }
    });
  }
}

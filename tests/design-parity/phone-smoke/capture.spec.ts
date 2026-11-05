import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { v7 as uuidv7 } from "uuid";
import type { OutboxRow } from "../../../src/client/types";
import { installAttendantFake } from "../../fixtures/attendant-http-fake";
import {
  fillSale,
  save,
  signIn,
  waitForWorker,
  rows,
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
  const wrap = await page.evaluate(() => {
    const boxes = (node: Node | null) => {
      if (!node) return [];
      const range = document.createRange();
      range.selectNodeContents(node);
      return Array.from(range.getClientRects(), (r) => ({
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      }));
    };
    const footer = Array.from(document.querySelectorAll("p")).find(
      (el) =>
        el.textContent ===
        "Counts toward loyalty after the details and photo sync.",
    );
    return {
      width: innerWidth,
      wordmark: boxes(
        document.querySelector(".wr-brand-name")?.firstChild ?? null,
      ),
      loyaltyFooter: boxes(footer ?? null),
    };
  });
  expect(new Set(wrap.wordmark.map((r) => r.y)).size).toBe(1);
  if (wrap.loyaltyFooter.length)
    expect(
      new Set(wrap.loyaltyFooter.map((r) => r.y)).size,
    ).toBeLessThanOrEqual(width === 390 ? 1 : 2);
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
  await writeFile(
    path.join(
      import.meta.dirname,
      "screenshots",
      `${board}-${width}.metrics.json`,
    ),
    JSON.stringify(wrap, null, 2) + "\n",
  );
}
for (const width of [390, 360]) {
  test(`phone-smoke capture and upload boards at ${width}px`, async ({
    page,
    context,
  }) => {
    const now = Date.parse("2026-11-04T09:42:00.000Z");
    await page.clock.install({ time: now });
    const fake = await installAttendantFake(context, { sync: true, now });
    fake.sync.setPutFailure(true);
    await signIn(page);
    await waitForWorker(page);
    await expect(
      page.getByLabel("Amount in naira", { exact: true }),
    ).toBeVisible();
    await capture(page, "A02-Sale", width);
    await fillSale(page, { value: "20000.00" });
    await expect(
      page.getByLabel("Amount in naira", { exact: true }),
    ).toHaveValue("20,000.00");
    await capture(page, "A03-SaleFilled", width);
    fake.setOffline(true);
    await context.setOffline(true);
    await save(page);
    await expect(
      page.getByText("Reference after upload", { exact: true }),
    ).toBeVisible();
    await capture(page, "A05-SaleSavedOnPhone", width);
    fake.setOffline(false);
    await context.setOffline(false);
    await expect
      .poll(async () => {
        const row = (await rows(page))[0]!;
        return { error: row.lastErrorCode, lease: row.syncLease };
      })
      .toEqual({ error: "photo_upload_failed", lease: null });
    await page.goto("/attendant/uploads");
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
          first.nextAttemptAt = new Date(Date.now() + 3600000).toISOString();
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
  });
  for (const gas of [false, true]) {
    test(`phone-smoke ${gas ? "gas" : "PMS"} receipt at ${width}px`, async ({
      page,
      context,
    }) => {
      const now = Date.parse(
        gas ? "2026-11-04T10:05:00.000Z" : "2026-11-04T09:42:00.000Z",
      );
      await page.clock.install({ time: now });
      const fake = await installAttendantFake(context, { sync: true, now });
      await signIn(page, gas ? "favour.james" : "grace.okon");
      await waitForWorker(page);
      await fillSale(page, { gas, value: gas ? "15000.00" : "20000.00" });
      fake.setOffline(true);
      await context.setOffline(true);
      await save(page);
      fake.setOffline(false);
      await context.setOffline(false);
      await expect(
        page.getByRole("heading", { name: "Sale synced", exact: true }),
      ).toBeVisible({ timeout: 20_000 });
      const code = [...fake.sync.records.values()][0]!.status.saleCode;
      await expect(page.getByText(code, { exact: true })).toBeVisible();
      await capture(page, gas ? "A16-GasSynced" : "A04-SaleSynced", width);
    });
  }
}

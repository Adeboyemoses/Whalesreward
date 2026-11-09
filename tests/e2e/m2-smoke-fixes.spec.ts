import { test, expect } from "@playwright/test";
import { v7 } from "uuid";
import { registrationFixture } from "../customers-cards/helpers";
import { api, seedId, attendantSignIn } from "../station/helpers";
import { fillSale, rows, waitForWorker } from "../fixtures/offline-browser";

test.use({ trace: "off", video: "off", screenshot: "off" });

test("I-16 valid unknown card opens registration with the typed candidate code", async ({
  page,
}) => {
  const f = await registrationFixture(page);
  try {
    await page
      .getByLabel("Or enter the card number", { exact: true })
      .fill("Z9Z9Z9Z");
    const lookup = page.waitForResponse((response) =>
      response.url().endsWith("/api/attendant/cards/lookup"),
    );
    await page.getByRole("button", { name: "Find", exact: true }).click();
    expect((await lookup).status()).toBe(404);
    await page
      .getByRole("button", { name: "Register this customer", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Register customer", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Card number", { exact: true })).toHaveValue(
      "Z9Z9Z9Z",
    );
    expect(page.url()).not.toContain("Z9Z9Z9Z");
  } finally {
    await f.db.end();
  }
});

test("I-16 malformed codes stay local and never imply an unregistered card", async ({
  page,
}) => {
  const f = await registrationFixture(page);
  try {
    let lookups = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/api/attendant/cards/lookup")) lookups++;
    });
    for (const code of [
      "I9Z9Z9Z",
      "O9Z9Z9Z",
      "09Z9Z9Z",
      "19Z9Z9Z",
      "Z9Z9Z9",
      "Z9Z9Z9Z9",
    ]) {
      await page
        .getByLabel("Or enter the card number", { exact: true })
        .fill(code);
      await page.getByRole("button", { name: "Find", exact: true }).click();
      await expect(
        page.getByText("Enter the seven-character code printed on the card.", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(
          /A card that is not yet linked must first be registered/,
        ),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: "Register this customer",
          exact: true,
        }),
      ).toHaveCount(0);
    }
    expect(lookups).toBe(0);
  } finally {
    await f.db.end();
  }
});

test("I-05 reassignment notice is persistent across attendant screens without changing the capture assignment", async ({
  page,
}) => {
  const f = await registrationFixture(page);
  try {
    await waitForWorker(page);
    const beforeEnvelope = await (
      await page.request.get("/api/attendant/session")
    ).json();
    const before = beforeEnvelope.data;
    // Hold the last genuine pre-change session snapshot as a delayed response,
    // while configured-assignment below observes the newer authoritative state.
    await page.route("**/api/attendant/session", (route) =>
      route.fulfill({ status: 200, json: beforeEnvelope }),
    );
    await api(page.request, `attendants/${f.attendant.id}/assignment`, {
      operationId: v7(),
      expectedVersion: f.attendant.version,
      expectedAssignmentId: f.attendant.assignment!.id,
      pumpId: seedId(16),
      expectedPumpVersion: 1,
      reason: "Fictional M2 persistent reassignment warning",
    });
    // Account may discover the change before the shared session refresh. That
    // observation must remain visible immediately when returning to Sale.
    const configured = page.waitForResponse((response) =>
      response.url().endsWith("/api/attendant/configured-assignment"),
    );
    await page.getByRole("link", { name: "Account", exact: true }).click();
    expect((await configured).status()).toBe(200);
    const notice = page.getByText(
      /Sign out and sign in online with your own account before using the new pump/,
    );
    await expect(notice).toBeVisible();
    await page.context().setOffline(true);
    await page.getByRole("link", { name: "Sale", exact: true }).click();
    await expect(notice).toBeVisible();
    await page.context().setOffline(false);
    await page.unroute("**/api/attendant/session");
    for (const label of ["Sale", "Register", "Uploads", "Account"] as const) {
      await page.getByRole("link", { name: label, exact: true }).click();
      await expect(notice).toBeVisible();
    }
    const after = (
      await (await page.request.get("/api/attendant/session")).json()
    ).data;
    expect(after.captureContextId).toBe(before.captureContextId);
    expect(after.assignment).toEqual(before.assignment);
    expect(after.offlineExpiresAt).toBe(before.offlineExpiresAt);
    expect(after.reassignmentRequiresSignIn).toBe(true);
    await page.getByRole("link", { name: "Account", exact: true }).click();
    await page
      .getByRole("button", { name: "Sign out to switch pump", exact: true })
      .click();
    await expect(notice).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/attendant\/sign-in$/);
    await attendantSignIn(page, f.username, f.password);
    await expect(page).toHaveURL(/\/attendant\/sale$/);
    await expect(notice).toHaveCount(0);
    const fresh = (
      await (await page.request.get("/api/attendant/session")).json()
    ).data;
    expect(fresh.captureContextId).not.toBe(before.captureContextId);
    expect(fresh.pump.id).toBe(seedId(16));
  } finally {
    await f.db.end();
  }
});

test("I-05 I-23 reassignment arriving during a save keeps the original sale and photo intact", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const draw = () => {
        const context = canvas.getContext("2d")!;
        context.fillStyle = "white";
        context.fillRect(0, 0, 640, 480);
        context.fillStyle = "black";
        context.font = "36px sans-serif";
        context.fillText("Fictional meter 20.000 litres", 10, 120);
      };
      draw();
      const timer = window.setInterval(draw, 50);
      const stream = canvas.captureStream(20);
      stream
        .getVideoTracks()[0]!
        .addEventListener("ended", () => clearInterval(timer));
      return stream;
    };
  });
  const f = await registrationFixture(page);
  try {
    await page.route("**/api/sync/**", (route) =>
      route.fulfill({
        status: 503,
        json: {
          error: {
            code: "temporarily_unavailable",
            message: "Fictional interrupted upload",
            retryable: true,
          },
          serverTime: new Date().toISOString(),
          requestId: v7(),
        },
      }),
    );
    await fillSale(page);
    await page.evaluate(() => {
      const digest = crypto.subtle.digest.bind(crypto.subtle);
      const barrier = new Promise<void>((resolve) => {
        (window as unknown as { releaseSave: () => void }).releaseSave =
          resolve;
      });
      crypto.subtle.digest = async (...args) => {
        (window as unknown as { saveWaiting: boolean }).saveWaiting = true;
        await barrier;
        return digest(...args);
      };
    });
    await page.getByRole("button", { name: "Save sale", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { saveWaiting?: boolean }).saveWaiting,
        ),
      )
      .toBe(true);
    await api(page.request, `attendants/${f.attendant.id}/assignment`, {
      operationId: v7(),
      expectedVersion: f.attendant.version,
      expectedAssignmentId: f.attendant.assignment!.id,
      pumpId: seedId(16),
      expectedPumpVersion: 1,
      reason: "Fictional reassignment during durable save",
    });
    const refreshed = page.waitForResponse((response) =>
      response.url().endsWith("/api/attendant/session"),
    );
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    expect((await refreshed).status()).toBe(200);
    const notice = page.getByText(
      /Sign out and sign in online with your own account before using the new pump/,
    );
    await expect(notice).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/attendant\/sale$/);
    await page.evaluate(() =>
      (window as unknown as { releaseSave: () => void }).releaseSave(),
    );
    await expect(
      page.getByRole("heading", { name: /^(Saved on phone|Upload pending)$/ }),
    ).toBeVisible();
    await expect(notice).toBeVisible();
    const saved = await rows(page);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.originatingAccountId).toBe(f.attendant.id);
    expect(saved[0]!.original.assignmentId).toBe(f.attendant.assignment!.id);
    expect(saved[0]!.photoBlob.size).toBeGreaterThan(0);
    expect(saved[0]!.photoDigest).toBe(saved[0]!.photoBlob.digest);
  } finally {
    await f.db.end();
  }
});

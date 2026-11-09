import { test, expect } from "@playwright/test";
import { v7 } from "uuid";
import { fillSale, rows, save } from "../fixtures/offline-browser";
import {
  stationFixture,
  createAttendant,
  attendantSignIn,
  captureStorage,
  api,
  seedId,
} from "../station/helpers";

test.use({
  trace: "off",
  video: "off",
  screenshot: "off",
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

test("I-01 I-03 restricted first-password access creates no capture window until fresh online sign-in", async ({
  page,
  browser,
}) => {
  const f = await stationFixture(page);
  const child = await createAttendant(page);
  const phone = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 390, height: 844 },
  });
  const p = await phone.newPage();
  const next = "  Fictional-新-password-2026  ";
  try {
    await attendantSignIn(p, child.username, child.password);
    await expect(
      p.getByRole("heading", {
        name: "Change your first password",
        exact: true,
      }),
    ).toBeVisible();
    expect((await captureStorage(p)).windows).toEqual([]);
    expect((await captureStorage(p)).activeAccountId).toBeNull();
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int AS n FROM capture_context WHERE attendant_id=$1",
          [child.attendant.id],
        )
      ).rows[0].n,
    ).toBe(0);
    await p.reload();
    await expect(
      p.getByRole("heading", {
        name: "Change your first password",
        exact: true,
      }),
    ).toBeVisible();
    await p.goto("/attendant/sale");
    await expect(p).toHaveURL(/\/attendant\/sign-in$/);
    await expect(
      p.getByRole("heading", {
        name: "Change your first password",
        exact: true,
      }),
    ).toBeVisible();
    await p
      .getByLabel("Current password", { exact: true })
      .fill(child.password);
    await p.getByLabel("New password", { exact: true }).fill(next);
    await p.getByLabel("Confirm new password", { exact: true }).fill(next);
    const complete = p.waitForResponse(
      (r) =>
        r.url().endsWith("/api/attendant/first-password") &&
        r.request().method() === "POST",
    );
    await p
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    expect((await complete).status()).toBe(204);
    await expect(
      p.getByText(
        "Password changed. Sign in online again before recording sales.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(p.getByLabel("Password", { exact: true })).toHaveValue("");
    expect((await captureStorage(p)).windows).toEqual([]);
    expect((await captureStorage(p)).activeAccountId).toBeNull();
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int AS n FROM capture_context WHERE attendant_id=$1",
          [child.attendant.id],
        )
      ).rows[0].n,
    ).toBe(0);
    await p.getByLabel("Username", { exact: true }).fill(child.username);
    await p.getByLabel("Password", { exact: true }).fill(next);
    await p.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(p).toHaveURL(/\/attendant\/sale$/);
    expect((await captureStorage(p)).activeAccountId).toBe(child.attendant.id);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int AS n FROM capture_context WHERE attendant_id=$1",
          [child.attendant.id],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await phone.close();
    await f.db.end();
  }
});

test("I-09 revoked restricted session cannot change a password or create an offline anchor", async ({
  page,
  browser,
}) => {
  const f = await stationFixture(page);
  const child = await createAttendant(page);
  const phone = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 390, height: 844 },
  });
  const p = await phone.newPage();
  try {
    await attendantSignIn(p, child.username, child.password);
    await expect(
      p.getByRole("heading", {
        name: "Change your first password",
        exact: true,
      }),
    ).toBeVisible();
    await f.db.query(
      "UPDATE auth_session SET revoked_at=clock_timestamp() WHERE user_id=$1",
      [child.attendant.accountId],
    );
    await p
      .getByLabel("Current password", { exact: true })
      .fill(child.password);
    await p
      .getByLabel("New password", { exact: true })
      .fill("Fictional-replacement-2026");
    await p
      .getByLabel("Confirm new password", { exact: true })
      .fill("Fictional-replacement-2026");
    const result = p.waitForResponse((r) =>
      r.url().endsWith("/api/attendant/first-password"),
    );
    await p
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    expect((await result).status()).toBe(401);
    await expect(p.getByLabel("Password", { exact: true })).toBeVisible();
    expect((await captureStorage(p)).activeAccountId).toBeNull();
    expect((await captureStorage(p)).windows).toEqual([]);
    expect(
      (
        await f.db.query(
          "SELECT must_change_password FROM auth_user WHERE id=$1",
          [child.attendant.accountId],
        )
      ).rows[0].must_change_password,
    ).toBe(true);
  } finally {
    await phone.close();
    await f.db.end();
  }
});

test("I-05 I-05a A17 shows the configured pump while preserving every original queued capture", async ({
  page,
  browser,
}) => {
  const f = await stationFixture(page);
  const child = await createAttendant(page);
  await f.db.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [child.attendant.accountId],
  );
  const phone = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 390, height: 844 },
    permissions: ["camera"],
  });
  const p = await phone.newPage();
  try {
    await p.route("**/api/sync/**", (route) =>
      route.fulfill({
        status: 503,
        json: {
          error: {
            code: "temporarily_unavailable",
            message: "Fixture upload interrupted",
            retryable: true,
          },
          serverTime: new Date().toISOString(),
          requestId: v7(),
        },
      }),
    );
    await attendantSignIn(p, child.username, child.password);
    await expect(p).toHaveURL(/\/attendant\/sale$/);
    await fillSale(p, { value: "20000.01" });
    await phone.setOffline(true);
    await save(p);
    const before = (await rows(p))[0]!;
    await api(page.request, `attendants/${child.attendant.id}/assignment`, {
      operationId: v7(),
      expectedVersion: child.attendant.version,
      expectedAssignmentId: child.attendant.assignment!.id,
      pumpId: seedId(16),
      expectedPumpVersion: 1,
      reason: "Fictional A17 handover",
    });
    await phone.setOffline(false);
    await p.goto("/attendant/account");
    await expect(p.getByText(/New pump assigned/i)).toBeVisible();
    await expect(p.getByText(/Pump 04|PUMP04/).first()).toBeVisible();
    await expect(
      p.getByRole("button", { name: "Sign out to switch pump", exact: true }),
    ).toBeVisible();
    const held = (await rows(p))[0]!;
    expect(held.original).toEqual(before.original);
    expect(held.photoBlob).toEqual(before.photoBlob);
    expect(held.operationId).toBe(before.operationId);
    await p
      .getByRole("button", { name: "Sign out to switch pump", exact: true })
      .click();
    await expect(p).toHaveURL(/\/attendant\/account\/hand-over$/);
    await p
      .getByRole("button", { name: "Sign out with pending sales", exact: true })
      .click();
    await expect(p).toHaveURL(/\/attendant\/sign-in$/);
    await attendantSignIn(p, child.username, child.password);
    await expect(p).toHaveURL(/\/attendant\/sale$/);
    const response = await p.request.get("/api/attendant/session");
    expect(response.status()).toBe(200);
    const session = (await response.json()).data;
    expect(session.pump.id).toBe(seedId(16));
    const after = (await rows(p))[0]!;
    expect(after.original).toEqual(before.original);
    expect(after.photoBlob).toEqual(before.photoBlob);
    expect(after.operationId).toBe(before.operationId);
    expect(after.originatingAccountId).toBe(child.attendant.id);
    expect(after.original.assignmentId).toBe(child.attendant.assignment!.id);
    expect(session.assignment.id).not.toBe(after.original.assignmentId);
  } finally {
    await phone.close();
    await f.db.end();
  }
});

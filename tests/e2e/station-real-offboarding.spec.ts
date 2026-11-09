import { test, expect, type Page } from "@playwright/test";
import { v7 } from "uuid";
import {
  stationFixture,
  createAttendant,
  attendantSignIn,
  captureStorage,
  api,
  seedId,
  type Attendant,
} from "../station/helpers";
import { fillSale, rows, save } from "../fixtures/offline-browser";

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
async function reviewEnd(page: Page, id: string, reason: string) {
  await page.goto(`/admin/attendants/${id}/end`);
  await page.getByLabel(/Reason/).fill(reason);
  await page
    .getByRole("button", { name: "Review end assignment", exact: true })
    .click();
}

test("I-09 P-21 real end assignment revokes every device and preserves the locked original phone queue", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const f = await stationFixture(page);
  const child = await createAttendant(page);
  await f.db.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [child.attendant.accountId],
  );
  const first = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 390, height: 844 },
    permissions: ["camera"],
  });
  const second = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
    viewport: { width: 390, height: 844 },
  });
  const p = await first.newPage(),
    other = await second.newPage();
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
    await first.setOffline(true);
    await save(p);
    const before = (await rows(p))[0]!;
    await attendantSignIn(other, child.username, child.password);
    await expect(other).toHaveURL(/\/attendant\/sale$/);
    await reviewEnd(
      page,
      child.attendant.id,
      "Fictional real offboarding acceptance",
    );
    const completed = page.waitForResponse(
      (r) =>
        r.url().endsWith("/assignment/end") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Confirm end assignment", exact: true })
      .click();
    const response = await completed;
    expect(response.status()).toBe(200);
    const receipt = (await response.json()).data;
    expect(receipt.attendant.assignment).toBeNull();
    expect(receipt.attendant.handover).toBe("unassigned");
    expect(receipt.ended.assignmentId).toBe(child.attendant.assignment!.id);
    await expect(
      page.getByText("Assignment ended", { exact: false }).first(),
    ).toBeVisible();
    expect(
      (
        await f.db.query(
          "SELECT effective_until IS NOT NULL AS closed,reason FROM assignment WHERE id=$1",
          [child.attendant.assignment!.id],
        )
      ).rows[0],
    ).toEqual({
      closed: true,
      reason: "Initial assignment at account creation",
    });
    const sessions = (
      await f.db.query(
        "SELECT revoked_at IS NOT NULL AS revoked FROM auth_session WHERE user_id=$1",
        [child.attendant.accountId],
      )
    ).rows;
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.every((s) => s.revoked)).toBe(true);
    // A disconnected device cannot learn revocation until reconnecting.
    expect((await rows(p))[0]!.original).toEqual(before.original);
    await first.setOffline(false);
    expect((await p.request.get("/api/attendant/session")).status()).toBe(401);
    expect((await other.request.get("/api/attendant/session")).status()).toBe(
      401,
    );
    await p.goto("/attendant/account");
    await expect(p).toHaveURL(/\/attendant\/sign-in$/);
    await expect(p.getByText(child.username, { exact: true })).toHaveCount(0);
    const locked = await captureStorage(p);
    expect(locked.activeAccountId).toBeNull();
    expect(locked.windows.every((w) => (w as { locked: boolean }).locked)).toBe(
      true,
    );
    const retained = (await rows(p))[0]!;
    expect(retained.original).toEqual(before.original);
    expect(retained.photoBlob).toEqual(before.photoBlob);
    expect(retained.operationId).toBe(before.operationId);
    const anchors = (
      await f.db.query(
        "SELECT count(*)::int AS n FROM capture_context WHERE attendant_id=$1",
        [child.attendant.id],
      )
    ).rows[0].n;
    await attendantSignIn(p, child.username, child.password);
    await expect(
      p.getByText("Sign-in is unavailable. Ask a station manager for help.", {
        exact: true,
      }),
    ).toBeVisible();
    expect((await captureStorage(p)).activeAccountId).toBeNull();
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int AS n FROM capture_context WHERE attendant_id=$1",
          [child.attendant.id],
        )
      ).rows[0].n,
    ).toBe(anchors);
  } finally {
    await first.close();
    await second.close();
    await f.db.end();
  }
});

test("I-09 P-21 lost-response replay after reassignment never ends or revokes the newer assignment", async ({
  page,
  browser,
}) => {
  const f = await stationFixture(page);
  const child = await createAttendant(page);
  await f.db.query(
    "UPDATE auth_user SET must_change_password=false WHERE id=$1",
    [child.attendant.accountId],
  );
  const phone = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  const p = await phone.newPage();
  const calls: unknown[] = [];
  let first = true;
  try {
    await page.route(
      `**/api/admin/attendants/${child.attendant.id}/assignment/end`,
      async (route) => {
        calls.push(route.request().postDataJSON());
        const response = await route.fetch();
        if (first) {
          first = false;
          expect(response.status()).toBe(200);
          return route.abort("failed");
        }
        return route.fulfill({ response });
      },
    );
    await reviewEnd(
      page,
      child.attendant.id,
      "Fictional uncertain real offboarding",
    );
    await page
      .getByRole("button", { name: "Confirm end assignment", exact: true })
      .click();
    await expect(
      page.getByRole("alert").filter({ hasText: /uncertain|connection/i }),
    ).toBeVisible();
    const ended = await api<Attendant>(
      page.request,
      `attendants/${child.attendant.id}`,
    );
    expect(ended.assignment).toBeNull();
    const assigned = await api<{ attendant: Attendant }>(
      page.request,
      `attendants/${child.attendant.id}/assignment`,
      {
        operationId: v7(),
        expectedVersion: ended.version,
        expectedAssignmentId: null,
        pumpId: seedId(16),
        expectedPumpVersion: 1,
        reason: "Fictional authorized return",
      },
    );
    await attendantSignIn(p, child.username, child.password);
    await expect(p).toHaveURL(/\/attendant\/sale$/);
    const replay = page.waitForResponse(
      (r) =>
        r.url().endsWith("/assignment/end") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: /retry.*confirm|confirm end assignment/i })
      .first()
      .click();
    const response = await replay;
    expect(response.status()).toBe(200);
    const receipt = (await response.json()).data;
    expect(receipt.attendant.assignment).toBeNull();
    expect(receipt.attendant.version).toBe(ended.version);
    await expect(
      page.getByText("Assignment ended", { exact: false }).first(),
    ).toBeVisible();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual(calls[0]);
    const current = await api<Attendant>(
      page.request,
      `attendants/${child.attendant.id}`,
    );
    expect(current.assignment?.id).toBe(assigned.attendant.assignment?.id);
    expect(current.version).toBe(assigned.attendant.version);
    expect((await p.request.get("/api/attendant/session")).status()).toBe(200);
    expect(
      (
        await f.db.query("SELECT effective_until FROM assignment WHERE id=$1", [
          assigned.attendant.assignment!.id,
        ])
      ).rows[0].effective_until,
    ).toBeNull();
  } finally {
    await phone.close();
    await f.db.end();
  }
});

test("I-07 P-21 pumps-only end assignment uses narrow context and cannot read a broad attendant profile", async ({
  page,
}) => {
  const owner = await stationFixture(page);
  const child = await createAttendant(page);
  await owner.db.end();
  await page.context().clearCookies();
  const f = await stationFixture(page, ["pumps"]);
  const forbidden: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (
      path === "/api/admin/attendants/search" ||
      /^\/api\/admin\/attendants\/[^/]+$/.test(path)
    )
      forbidden.push(path);
  });
  try {
    await page.goto(`/admin/pumps/${seedId(14)}/end/${child.attendant.id}`);
    await page.getByLabel(/Reason/).fill("Fictional pumps-only offboarding");
    await page
      .getByRole("button", { name: "Review end assignment", exact: true })
      .click();
    const completed = page.waitForResponse(
      (r) =>
        r.url().endsWith("/assignment/end") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Confirm end assignment", exact: true })
      .click();
    expect((await completed).status()).toBe(200);
    await expect(
      page.getByText("Assignment ended", { exact: false }).first(),
    ).toBeVisible();
    expect(forbidden).toEqual([]);
    expect(
      (
        await f.db.query(
          "SELECT effective_until IS NOT NULL AS closed FROM assignment WHERE id=$1",
          [child.attendant.assignment!.id],
        )
      ).rows[0].closed,
    ).toBe(true);
    expect(
      (
        await page.request.get(`/api/admin/attendants/${child.attendant.id}`)
      ).status(),
    ).toBe(403);
  } finally {
    await f.db.end();
  }
});

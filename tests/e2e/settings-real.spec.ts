import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { stationFixture } from "../station/helpers";
import {
  settingsFixture,
  readSettings,
  readHistory,
  saveIntent,
  nextDays,
  editIntent,
  reviewIntent,
  confirmIntent,
  daysLabel,
  reasonLabel,
  timingLocked,
} from "../settings/helpers";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.setTimeout(60000);

test("I-45 I-51 settings show server nulls and timing remains locked without board defaults", async ({
  page,
}) => {
  const f = await settingsFixture(page);
  try {
    await saveIntent(page, null, "Fictional unset retention fixture");
    const state = await readSettings(page);
    await page.goto("/admin/settings");
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toContainText(state.station.name);
    await expect(page.getByRole("main")).toContainText(state.station.timezone);
    await expect(page.getByRole("main")).toContainText(
      /photos are never deleted automatically/i,
    );
    await expect(page.getByRole("main")).toContainText(/Not set/);
    await expect(page.getByRole("main")).not.toContainText(
      /180 days|20 Dec 2026|21 Dec 2026|24 hours/,
    );
    for (const path of ["giveaway", "giveaway/confirm"]) {
      await page.goto(`/admin/settings/${path}`);
      await expect(page.getByRole("main")).toContainText(timingLocked);
      await expect(
        page.getByRole("main").locator("input, textarea"),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Confirm changes", exact: true }),
      ).toHaveCount(0);
    }
  } finally {
    await f.close();
  }
});

test("I-45 retention validates whole days and reason before server review", async ({
  page,
}) => {
  const f = await settingsFixture(page);
  try {
    const before = await readSettings(page);
    let posts = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/admin/settings/") && r.method() === "POST")
        posts++;
    });
    await editIntent(page, nextDays(before), "");
    const review = page.getByRole("button", {
      name: "Review changes",
      exact: true,
    });
    await expect(review).toBeDisabled();
    await page
      .getByLabel(reasonLabel, { exact: true })
      .fill("Fictional invalid day check");
    for (const invalid of ["0", "-1", "1.5", "1e3", "36501", "abc"]) {
      await page.getByLabel(daysLabel, { exact: true }).fill(invalid);
      await expect(review).toBeDisabled();
    }
    await page
      .getByLabel(daysLabel, { exact: true })
      .fill(String(nextDays(before)));
    await expect(review).toBeEnabled();
    expect(posts).toBe(0);
    expect((await readSettings(page)).version).toBe(before.version);
  } finally {
    await f.close();
  }
});

test("I-45 review keep editing and cancel have no effect; confirm saves auditable intent once", async ({
  page,
}) => {
  const f = await settingsFixture(page);
  try {
    const before = await readSettings(page),
      days = nextDays(before);
    const reason = "Fictional reviewed retention intent";
    await editIntent(page, days, reason);
    expect((await reviewIntent(page)).status()).toBe(200);
    await expect(
      page.getByRole("heading", {
        name: /^Confirm settings change/,
      }),
    ).toBeVisible();
    await expect(page.getByRole("main")).toContainText(reason);
    await expect(page.getByRole("main")).toContainText(`${days} days`);
    await expect(page.getByRole("main")).toContainText(/Disabled/);
    expect((await readSettings(page)).version).toBe(before.version);
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await expect(page.getByLabel(daysLabel, { exact: true })).toHaveValue(
      String(days),
    );
    await expect(page.getByLabel(reasonLabel, { exact: true })).toHaveValue(
      reason,
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await readSettings(page)).version).toBe(before.version);
    await editIntent(page, days, reason);
    expect((await reviewIntent(page)).status()).toBe(200);
    await confirmIntent(page);
    await expect
      .poll(async () => (await readSettings(page)).version)
      .toBe(before.version + 1);
    const after = await readSettings(page);
    expect(after.retention).toEqual({
      ...before.retention,
      days,
      deletionEnabled: false,
      policyVersion: null,
    });
    await page.goto("/admin/settings");
    await page.reload();
    await expect(page.getByRole("main")).toContainText(`${days} days`);
    const latest = (await readHistory(page)).items[0]!;
    expect(latest).toMatchObject({
      section: "retention",
      reason,
      before: before.retention,
      after: after.retention,
    });
    expect(latest.actor.name).toBe("Ada Williams");
    await expect(page.getByRole("main")).toContainText(reason);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM settings_change WHERE audit_event_id=$1",
          [latest.auditEventId],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await f.close();
  }
});

test("I-45 blank retention records Not set and unchanged review creates no history", async ({
  page,
}) => {
  const f = await settingsFixture(page);
  try {
    await saveIntent(page, 41, "Fictional configured retention fixture");
    const before = await readSettings(page);
    await editIntent(page, null, "Fictional clear retention intent");
    expect((await reviewIntent(page)).status()).toBe(200);
    await expect(page.getByRole("main")).toContainText("Not set");
    await confirmIntent(page);
    await expect
      .poll(async () => (await readSettings(page)).retention.days)
      .toBeNull();
    await editIntent(page, null, "Fictional unchanged retention intent");
    expect((await reviewIntent(page)).status()).toBe(409);
    await expect(page.getByRole("main")).toContainText(
      /no change|unchanged|already/i,
    );
    expect((await readSettings(page)).version).toBe(before.version + 1);
  } finally {
    await f.close();
  }
});

test("I-39 I-45 competing retention confirmation requires a fresh explicit review", async ({
  page,
}) => {
  const f = await settingsFixture(page);
  try {
    const before = await readSettings(page),
      days = nextDays(before, 51);
    await editIntent(page, days, "Fictional earlier retention review");
    expect((await reviewIntent(page)).status()).toBe(200);
    const competingDays = days + 3;
    await saveIntent(
      page,
      competingDays,
      "Fictional competing retention intent",
    );
    await confirmIntent(page, 409);
    await expect(page.getByRole("main")).toContainText(
      /changed|stale|review.*again|latest/i,
    );
    expect((await readSettings(page)).retention.days).toBe(competingDays);
    await expect(
      page.getByRole("button", { name: "Retry confirmation", exact: true }),
    ).toHaveCount(0);
    expect((await readSettings(page)).version).toBe(before.version + 1);
  } finally {
    await f.close();
  }
});

test("I-40 I-45 committed response loss and a rate-limited retry preserve the frozen retention operation", async ({
  page,
}) => {
  const f = await settingsFixture(page);
  try {
    const before = await readSettings(page),
      days = nextDays(before, 61);
    await editIntent(page, days, "Fictional lost retention response");
    expect((await reviewIntent(page)).status()).toBe(200);
    const bodies: unknown[] = [];
    let committed: unknown;
    await page.route(
      "**/api/admin/settings/retention/confirm",
      async (route) => {
        bodies.push(route.request().postDataJSON());
        if (bodies.length === 1) {
          const response = await route.fetch();
          expect(response.status()).toBe(201);
          committed = (await response.json()).data;
          await route.abort("failed");
        } else if (bodies.length === 2) {
          // The receipt already exists. A limiter cannot prove the original failed.
          await route.fulfill({
            status: 429,
            headers: { "Retry-After": "1" },
            json: {
              error: {
                code: "rate_limited",
                message: "Too many requests",
                retryable: true,
              },
              serverTime: new Date().toISOString(),
              requestId: "019a5000-0000-7000-8000-000000270429",
            },
          });
        } else await route.continue();
      },
    );
    await page
      .getByRole("button", { name: "Confirm changes", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry confirmation", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Keep editing", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    const limited = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/settings/retention/confirm") &&
        r.status() === 429,
    );
    await page
      .getByRole("button", { name: "Retry confirmation", exact: true })
      .click();
    await limited;
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      /Too many requests/,
    );
    await expect(
      page.getByRole("button", { name: "Retry confirmation", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Keep editing", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    const replayed = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/settings/retention/confirm") &&
        r.status() === 200,
    );
    await page
      .getByRole("button", { name: "Retry confirmation", exact: true })
      .click();
    expect((await (await replayed).json()).data).toEqual(committed);
    await expect(
      page.getByRole("button", { name: "Retry confirmation", exact: true }),
    ).toHaveCount(0);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).toEqual(bodies[0]);
    expect((await readSettings(page)).version).toBe(before.version + 1);
    const operation = bodies[0] as { operationId: string };
    expect(
      (
        await f.db.query(
          `SELECT
            (SELECT count(*)::int FROM settings_version WHERE operation_id=$1) AS versions,
            (SELECT count(*)::int FROM settings_change WHERE settings_version_id IN
              (SELECT id FROM settings_version WHERE operation_id=$1)) AS history,
            (SELECT count(*)::int FROM mutation_receipt WHERE actor_user_id=$2 AND operation_id=$1) AS receipts`,
          [operation.operationId, f.userId],
        )
      ).rows[0],
    ).toEqual({ versions: 1, history: 1, receipts: 1 });
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});

test("I-07 I-09 settings permission is checked on direct read and confirmation", async ({
  page,
}) => {
  const f = await settingsFixture(page);
  try {
    const before = await readSettings(page);
    await editIntent(
      page,
      nextDays(before, 71),
      "Fictional permission loss before confirmation",
    );
    expect((await reviewIntent(page)).status()).toBe(200);
    const roleId = (
      await f.db.query("SELECT role_id FROM admin WHERE id=$1", [f.adminId])
    ).rows[0].role_id;
    await f.db.query(
      "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='settings'",
      [roleId],
    );
    await confirmIntent(page, 403);
    expect(
      (
        await f.db.query(
          "SELECT settings_version FROM station_reporting_state WHERE station_id=$1",
          [before.station.id],
        )
      ).rows[0].settings_version,
    ).toBe(before.version);
    for (const route of [
      "settings",
      "settings/retention",
      "settings/giveaway",
    ]) {
      await page.goto(`/admin/${route}`);
      await expect(page.getByLabel(daysLabel, { exact: true })).toHaveCount(0);
      await expect(page.getByRole("main")).not.toContainText(
        "Fictional permission loss before confirmation",
      );
    }
    expect((await page.request.get("/api/admin/settings")).status()).toBe(403);
    expect(
      (await page.request.get("/api/admin/settings/history")).status(),
    ).toBe(403);
  } finally {
    await f.close();
  }
});

test("I-45 an altered review digest is refused with review_stale and no saved change", async ({
  page,
}) => {
  const f = await settingsFixture(page);
  try {
    const before = await readSettings(page);
    await editIntent(
      page,
      nextDays(before, 81),
      "Fictional stale digest review",
    );
    expect((await reviewIntent(page)).status()).toBe(200);
    await page.route(
      "**/api/admin/settings/retention/confirm",
      async (route) => {
        const input = route.request().postDataJSON();
        await route.continue({
          postData: JSON.stringify({ ...input, reviewDigest: "0".repeat(64) }),
        });
      },
    );
    await confirmIntent(page, 409);
    await expect(page.getByRole("main")).toContainText(
      /review.*(?:changed|stale|again)|review.*latest/i,
    );
    await expect(
      page.getByRole("button", { name: "Retry confirmation", exact: true }),
    ).toHaveCount(0);
    expect((await readSettings(page)).version).toBe(before.version);
    await page.unrouteAll({ behavior: "wait" });
    await page
      .getByRole("button", { name: "Reload settings", exact: true })
      .click();
    await expect(page.getByLabel(daysLabel, { exact: true })).toBeEnabled();
    expect((await reviewIntent(page)).status()).toBe(200);
    await expect(
      page.getByRole("heading", {
        name: /^Confirm settings change/,
      }),
    ).toBeVisible();
    await confirmIntent(page);
    expect((await readSettings(page)).version).toBe(before.version + 1);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});

test("I-45 retention confirm direct URL cannot save without an explicit review", async ({
  page,
}) => {
  const f = await settingsFixture(page);
  try {
    const before = await readSettings(page);
    let writes = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/admin/settings/") && r.method() === "POST")
        writes++;
    });
    await page.goto("/admin/settings/retention/confirm");
    await expect(
      page.getByRole("link", { name: "Review retention changes", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirm changes", exact: true }),
    ).toHaveCount(0);
    expect(writes).toBe(0);
    expect((await readSettings(page)).version).toBe(before.version);
  } finally {
    await f.close();
  }
});

test("I-45 settings history is newest first and continues without duplicating entries", async ({
  page,
  browser,
}) => {
  const f = await settingsFixture(page);
  const otherContext = await browser.newContext({
    baseURL: "http://127.0.0.1:3000",
  });
  let closeOther = async () => {};
  try {
    const other = await otherContext.newPage();
    const otherFixture = await stationFixture(other, ["settings"]);
    closeOther = () => otherFixture.db.end();
    const records = [];
    const historyTag = [...randomBytes(6)]
      .map((b) => String.fromCharCode(97 + (b % 26)))
      .join("");
    let current = await readSettings(page);
    const firstDays = nextDays(current, 91);
    for (let i = 0; i < 26; i++) {
      // Two independently authorized actors stay below the unchanged W limit.
      const result = await saveIntent(
        i < 13 ? page : other,
        firstDays + (i % 2),
        `Fictional history ${historyTag} change ${String.fromCharCode(97 + i)}`,
        current,
      );
      if (!result || result.section !== "retention")
        throw new Error("Expected new retention history");
      current = {
        ...current,
        version: result.version,
        retention: result.after,
      };
      records.unshift(result);
    }
    const first = await readHistory(page, "?limit=2");
    expect(first.items.map((row) => row.id)).toEqual(
      records.slice(0, 2).map((row) => row.id),
    );
    expect(first.nextCursor).not.toBeNull();
    const second = await readHistory(
      page,
      `?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`,
    );
    expect(second.items.map((row) => row.id)).toEqual(
      records.slice(2, 4).map((row) => row.id),
    );
    await page.goto("/admin/settings");
    const table = page.getByRole("table");
    await expect(table.locator("tbody tr")).toHaveCount(25);
    await expect(table.locator("tbody tr").first()).toContainText(
      records[0]!.reason,
    );
    await expect(table).not.toContainText(records[25]!.reason);
    await page
      .getByRole("button", { name: "More history", exact: true })
      .click();
    await expect(table).toContainText(records[25]!.reason);
    await expect(
      table.locator("tbody tr").filter({ hasText: records[0]!.reason }),
    ).toHaveCount(1);
  } finally {
    await closeOther();
    await otherContext.close();
    await f.close();
  }
});

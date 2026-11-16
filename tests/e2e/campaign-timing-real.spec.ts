import type { Page } from "@playwright/test";
import { test, expect } from "../settings/test";
import {
  settingsFixture,
  readSettings,
  readHistory,
} from "../settings/helpers";

import { v7 } from "uuid";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.setTimeout(60000);
const values = {
  launchAt: "2035-03-01T00:00:00Z",
  purchaseStart: "2035-03-02T00:00:00Z",
  purchaseCutoff: "2035-03-09T01:59:59Z",
  timezone: "Africa/Lagos",
  graceHours: 0,
};
export async function editTiming(
  page: Page,
  reason = "Fictional campaign timing review",
  delta = 0,
) {
  await page.goto("/admin/settings/giveaway");
  for (const [label, value] of [
    ["Launch", delta ? "2035-03-01T01:00:00Z" : values.launchAt],
    ["Purchase start", delta ? "2035-03-02T01:00:00Z" : values.purchaseStart],
    ["Purchase cutoff", delta ? "2035-03-10T01:59:59Z" : values.purchaseCutoff],
    ["Campaign timezone", delta ? "UTC" : values.timezone],
    ["Upload grace period (hours)", String(delta)],
    ["Reason for change", reason],
  ])
    await page.getByLabel(label!, { exact: true }).fill(value!);
}
export async function reviewTiming(page: Page) {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/settings/giveaway/review") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Confirm changes", exact: true }),
  ).toBeVisible();
}
async function confirmTiming(page: Page) {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/settings/giveaway/confirm") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Confirm changes", exact: true })
    .click();
  expect((await response).status()).toBe(201);
}

test("I-45 Owner creates or edits explicit timing through review and history; cancel writes nothing", async ({
  page,
}) => {
  const f = await settingsFixture(page, null);
  try {
    const before = await readSettings(page);
    if (!before.campaign) {
      await page.goto("/admin/settings");
      await expect(
        page.getByRole("link", { name: "Create campaign", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("link", { name: "Create campaign", exact: true })
        .click();
      for (const label of [
        "Launch",
        "Purchase start",
        "Purchase cutoff",
        "Campaign timezone",
        "Upload grace period (hours)",
        "Reason for change",
      ])
        await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
    }
    await page.goto("/admin/settings/giveaway/confirm");
    await expect(
      page.getByRole("button", { name: "Confirm changes", exact: true }),
    ).toHaveCount(0);
    await editTiming(
      page,
      "Fictional timing cancellation",
      before.campaign ? 2 : 0,
    );
    await reviewTiming(page);
    expect((await readSettings(page)).version).toBe(before.version);
    await page
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await expect(
      page.getByLabel("Reason for change", { exact: true }),
    ).toHaveValue("Fictional timing cancellation");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await readSettings(page)).version).toBe(before.version);
    const reason = "Fictional campaign timing confirmed";
    await editTiming(
      page,
      reason,
      before.campaign ? (before.campaign.timing.graceHours === 2 ? 3 : 2) : 0,
    );
    await reviewTiming(page);
    await expect(page.getByRole("main")).toContainText(reason);
    await expect(page.getByRole("main")).toContainText(/Upload deadline/);
    await confirmTiming(page);
    await expect
      .poll(async () => (await readSettings(page)).version)
      .toBe(before.version + 1);
    const after = await readSettings(page);
    expect(after.campaign?.id).toBeTruthy();
    const history = (await readHistory(page)).items.find(
      (x) => x.reason === reason,
    );
    expect(history).toMatchObject({
      section: "giveaway",
      actor: { name: "Ada Williams" },
      reason,
    });
    if (!before.campaign) expect(history?.before).toBeNull();
    await page.goto("/admin/settings");
    await expect(page.getByRole("main")).toContainText(reason);
  } finally {
    await f.close();
  }
});

test("I-07 non-Owner settings administrator reads values and reason without timing actions", async ({
  page,
}) => {
  const f = await settingsFixture(page);
  try {
    for (const path of ["", "/giveaway", "/giveaway/confirm"]) {
      await page.goto(`/admin/settings${path}`);
      await expect(page.getByRole("main")).toContainText(/Owner/);
      await expect(
        page.getByRole("main").locator("input, textarea"),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Confirm changes", exact: true }),
      ).toHaveCount(0);
    }
    await page.goto("/admin/settings/retention");
    await expect(
      page.getByLabel("Photo retention period (days)", { exact: true }),
    ).toBeVisible();
  } finally {
    await f.close();
  }
});

test("I-45 uncertain campaign confirmation retries the same body through navigation", async ({
  page,
}) => {
  const f = await settingsFixture(page, null);
  try {
    const state = await readSettings(page);
    const priorLost = (await readHistory(page)).items.filter(
      (x) => x.reason === "Fictional lost campaign response",
    ).length;
    await editTiming(
      page,
      "Fictional lost campaign response",
      state.campaign?.timing.graceHours === 4 ? 5 : 4,
    );
    await reviewTiming(page);
    const bodies: unknown[] = [];
    let first = true;
    await page.route(
      "**/api/admin/settings/giveaway/confirm",
      async (route) => {
        bodies.push(route.request().postDataJSON());
        if (first) {
          first = false;
          await route.fetch();
          await route.abort("failed");
        } else await route.continue();
      },
    );
    await page
      .getByRole("button", { name: "Confirm changes", exact: true })
      .click();
    await expect(page.getByRole("main")).toContainText(
      "The confirmation result is uncertain.",
    );
    await expect(
      page.getByRole("button", { name: "Retry confirmation", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("link", { name: "Settings", exact: true })
      .first()
      .click();
    await page
      .getByRole("link", { name: /giveaway settings/i })
      .first()
      .click();
    await page
      .getByRole("link", { name: "Return to confirmation", exact: true })
      .click();
    await expect(page.getByRole("main")).toContainText(
      "The confirmation result is uncertain.",
    );
    await expect(
      page.getByRole("button", { name: "Retry confirmation", exact: true }),
    ).toBeEnabled();
    const response = page.waitForResponse((r) =>
      r.url().endsWith("/settings/giveaway/confirm"),
    );
    await page
      .getByRole("button", { name: "Retry confirmation", exact: true })
      .click();
    expect((await response).status()).toBe(200);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(
      (await readHistory(page)).items.filter(
        (x) => x.reason === "Fictional lost campaign response",
      ),
    ).toHaveLength(priorLost + 1);
  } finally {
    await f.close();
  }
});

test("I-45 retention change invalidates a timing review and requires explicit reload", async ({
  page,
}) => {
  const f = await settingsFixture(page, null);
  try {
    const before = await readSettings(page);
    await editTiming(
      page,
      "Fictional stale timing review",
      before.campaign?.timing.graceHours === 6 ? 7 : 6,
    );
    await reviewTiming(page);
    await saveTimingRetention(
      page,
      before.retention.days === 39 ? 40 : 39,
      "Fictional concurrent retention intent",
    );
    const pending = page.waitForResponse((r) =>
      r.url().endsWith("/settings/giveaway/confirm"),
    );
    await page
      .getByRole("button", { name: "Confirm changes", exact: true })
      .click();
    expect((await pending).status()).toBe(409);
    await expect(page.getByRole("main")).toContainText(
      /review|changed|reload/i,
    );
    await expect(
      page.getByRole("button", { name: "Confirm changes", exact: true }),
    ).toHaveCount(0);
    expect(
      (await readHistory(page)).items.filter(
        (x) => x.reason === "Fictional stale timing review",
      ),
    ).toHaveLength(0);
  } finally {
    await f.close();
  }
});

test("I-09 Owner demotion during timing review removes confirmation authority", async ({
  page,
}) => {
  const f = await settingsFixture(page, null);
  try {
    const before = await readSettings(page);
    await editTiming(
      page,
      "Fictional revoked Owner review",
      before.campaign?.timing.graceHours === 8 ? 9 : 8,
    );
    await reviewTiming(page);
    const role = v7();
    await f.db.query(
      "INSERT INTO role(id,name,is_owner,enabled,version) VALUES($1,$2,false,true,1)",
      [role, `Timing reader ${role}`],
    );
    await f.db.query(
      "INSERT INTO role_permission(role_id,permission_code) VALUES($1,'settings')",
      [role],
    );
    await f.db.query(
      "UPDATE admin SET role_id=$1,version=version+1 WHERE id=$2",
      [role, f.adminId],
    );
    const pending = page.waitForResponse((r) =>
      r.url().endsWith("/settings/giveaway/confirm"),
    );
    await page
      .getByRole("button", { name: "Confirm changes", exact: true })
      .click();
    expect((await pending).status()).toBe(403);
    await expect(
      page.getByRole("button", { name: "Confirm changes", exact: true }),
    ).toHaveCount(0);
    expect((await readSettings(page)).version).toBe(before.version);
  } finally {
    await f.close();
  }
});

test("I-45 transient 429 retries the exact reviewed operation", async ({
  page,
}) => {
  const f = await settingsFixture(page, null);
  try {
    const before = await readSettings(page);
    await editTiming(
      page,
      "Fictional throttled timing review",
      before.campaign?.timing.graceHours === 10 ? 11 : 10,
    );
    await reviewTiming(page);
    const bodies: unknown[] = [];
    await page.route(
      "**/api/admin/settings/giveaway/confirm",
      async (route) => {
        bodies.push(route.request().postDataJSON());
        if (bodies.length === 1)
          await route.fulfill({
            status: 429,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "rate_limited", retryable: true },
            }),
          });
        else await route.continue();
      },
    );
    const throttled = page.waitForResponse(
      (r) =>
        r.url().endsWith("/settings/giveaway/confirm") && r.status() === 429,
    );
    await page
      .getByRole("button", { name: "Confirm changes", exact: true })
      .click();
    await throttled;
    await expect(page.getByRole("main")).toContainText(
      "The confirmation result is uncertain.",
    );
    await expect(
      page.getByRole("button", { name: "Retry confirmation", exact: true }),
    ).toBeEnabled();
    const pending = page.waitForResponse((r) =>
      r.url().endsWith("/settings/giveaway/confirm"),
    );
    await page
      .getByRole("button", { name: "Retry confirmation", exact: true })
      .click();
    expect((await pending).status()).toBe(201);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
  } finally {
    await f.close();
  }
});

// These are explicit UI boundary projections; P-28 PostgreSQL integration tests
// independently prove the server's trusted start and any-snapshot lock predicates.
for (const lock of ["start", "snapshot"] as const) {
  test(`I-45 ${lock} lock response projection is read-only at both timing URLs`, async ({
    page,
  }) => {
    const f = await settingsFixture(page, null);
    try {
      await page.route("**/api/admin/settings", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.data.timingLocked = true;
        if (lock === "snapshot" && body.data.campaign)
          body.data.campaign.latestSnapshotId = v7();
        await route.fulfill({ response, json: body });
      });
      for (const path of [
        "/admin/settings/giveaway",
        "/admin/settings/giveaway/confirm",
      ]) {
        await page.goto(path);
        await expect(page.getByRole("main")).toContainText(/locked/);
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
}

test("I-45 crossing-start confirmation refusal projection clears mutation actions", async ({
  page,
}) => {
  const f = await settingsFixture(page, null);
  try {
    const state = await readSettings(page);
    await editTiming(
      page,
      "Fictional crossed-start refusal",
      state.campaign?.timing.graceHours === 12 ? 13 : 12,
    );
    await reviewTiming(page);
    await page.route("**/api/admin/settings/giveaway/confirm", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "timing_locked", retryable: false },
        }),
      }),
    );
    await page
      .getByRole("button", { name: "Confirm changes", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Confirm changes", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("main")).toContainText(
      /locked|started|result/i,
    );
    expect((await readSettings(page)).version).toBe(state.version);
  } finally {
    await f.close();
  }
});

// The timing worker owns its migrated schema and origin; avoid the ordinary
// settings fixture's intentionally fixed port-3000 mutation helper.
async function saveTimingRetention(page: Page, days: number, reason: string) {
  const state = await readSettings(page);
  const origin = new URL(page.url()).origin;
  const proposal = { days, reason, expectedVersion: state.version };
  const response = await page.request.post(
    "/api/admin/settings/retention/review",
    { headers: { Origin: origin }, data: proposal },
  );
  expect(response.status()).toBe(200);
  const review = (await response.json()).data;
  const confirmed = await page.request.post(
    "/api/admin/settings/retention/confirm",
    {
      headers: { Origin: origin },
      data: {
        ...proposal,
        reviewDigest: review.reviewDigest,
        operationId: v7(),
      },
    },
  );
  expect(confirmed.status()).toBe(201);
}

import type { Page } from "@playwright/test";
import { test, expect } from "../settings/test";
import {
  settingsFixture,
  readSettings,
  readHistory,
} from "../settings/helpers";
import { instantToWallClock } from "../../src/ui/pickers";
import type { Settings } from "../../src/shared/contracts/settings";

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
  // "UTC" is not selectable through TimezoneCombobox: it (and the Etc/*
  // aliases) are excluded from Intl.supportedValuesOf("timeZone")'s
  // canonical IANA list, which is the combobox's whole catalogue, so no
  // typed query can ever match it. Africa/Accra is a real catalogue entry
  // with the same fixed +00:00 offset and no DST, so it stands in for "UTC"
  // here without changing any of the literal instants below.
  const zone = delta ? "Africa/Accra" : values.timezone;
  // The timezone must be committed before the date/time pairs below are
  // filled: setWallClock() in settings-giveaway.tsx reads draft.timezone at
  // the moment each wall-clock pair is typed in, so an instant typed before
  // the zone is picked would be interpreted in the wrong (still-default)
  // zone.
  const tzInput = page.getByRole("combobox", { name: "Campaign timezone" });
  await tzInput.click();
  await tzInput.fill(zone);
  await page.getByRole("option", { name: zone, exact: true }).click();
  await expect(tzInput).toHaveValue(zone);

  for (const [label, instant] of [
    ["Launch", delta ? "2035-03-01T01:00:00Z" : values.launchAt],
    ["Purchase start", delta ? "2035-03-02T01:00:00Z" : values.purchaseStart],
    ["Purchase cutoff", delta ? "2035-03-10T01:59:59Z" : values.purchaseCutoff],
  ] as const) {
    const wall = instantToWallClock(instant, zone)!;
    await page.getByLabel(`${label} date`, { exact: true }).fill(wall.date);
    await page.getByLabel(`${label} time`, { exact: true }).fill(wall.time);
  }
  await page
    .getByLabel("Upload grace period (hours)", { exact: true })
    .fill(String(delta));
  await page.getByLabel("Reason for change", { exact: true }).fill(reason);
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
        "Launch date",
        "Launch time",
        "Purchase start date",
        "Purchase start time",
        "Purchase cutoff date",
        "Purchase cutoff time",
        "Upload grace period (hours)",
        "Reason for change",
      ])
        await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
      // settings-giveaway.tsx defaults a brand-new campaign's draft.timezone
      // to "Africa/Lagos" (the station's home zone), not empty.
      await expect(
        page.getByRole("combobox", { name: "Campaign timezone" }),
      ).toHaveValue("Africa/Lagos");
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

// WHR-230: the new date/time picker pair + TimezoneCombobox must convert
// wall-clock input to an explicit-offset instant using the *campaign's*
// selected zone, never the browser's own clock/zone. This describe block
// runs with the browser context's timezoneId pinned to Asia/Tokyo (+09:00),
// which is neither Africa/Lagos (the station/default zone, +01:00) nor the
// zone picked in these tests (America/New_York) -- if the browser's own
// zone ever leaked into the computed instant, these assertions would see
// +09:00 or a shifted wall-clock instead. The override is scoped to this
// describe block only, so it does not change the timezoneId (unset, the
// Playwright default) that the rest of this file's tests run under.
test.describe("WHR-230 pickers and timezone", () => {
  test.use({ timezoneId: "Asia/Tokyo" });

  const PICKED_ZONE = "America/New_York";

  async function api(page: Page, path: string, input?: unknown) {
    const origin = new URL(page.url()).origin;
    const response =
      input === undefined
        ? await page.request.get(`/api/admin/${path}`)
        : await page.request.post(`/api/admin/${path}`, {
            headers: { Origin: origin },
            data: input,
          });
    return response;
  }

  /** Seeds a campaign directly through the giveaway review/confirm API, bypassing
   * the UI entirely. See the "BUG" test below: the split date/time pickers cannot
   * currently combine a blank date+time pair through two independent field edits,
   * so the create flow cannot be driven through the UI yet.
   */
  async function seedTiming(
    page: Page,
    proposal: {
      launchAt: string;
      purchaseStart: string;
      purchaseCutoff: string;
      timezone: string;
      graceHours: number;
      reason: string;
    },
  ) {
    const before = (await (await api(page, "settings")).json())
      .data as Settings;
    const body = before.campaign
      ? {
          ...proposal,
          kind: "update" as const,
          campaignId: before.campaign.id,
          expectedCampaignVersion: before.campaign.version,
          expectedVersion: before.version,
        }
      : {
          ...proposal,
          kind: "create" as const,
          campaignId: null,
          expectedCampaignVersion: null,
          expectedVersion: before.version,
        };
    const reviewResponse = await api(page, "settings/giveaway/review", body);
    expect(reviewResponse.status(), "seed review").toBe(200);
    const review = (await reviewResponse.json()).data;
    const confirmResponse = await api(page, "settings/giveaway/confirm", {
      ...body,
      operationId: v7(),
      reviewDigest: review.reviewDigest,
    });
    expect(confirmResponse.status(), "seed confirm").toBe(201);
    return (await confirmResponse.json()).data;
  }

  test("WHR-230 editing an existing campaign: pickers pre-fill from the stored instant and submit the campaign-zone instant, never the browser's", async ({
    page,
  }) => {
    const f = await settingsFixture(page, null);
    try {
      await page.goto("/admin/settings/giveaway");
      // Seed a known campaign in Africa/Lagos, a fixed +01:00 zone, so the
      // expected wall-clock on pre-fill is unambiguous.
      await seedTiming(page, {
        launchAt: "2027-06-01T10:00:00.000+01:00",
        purchaseStart: "2027-06-02T10:00:00.000+01:00",
        purchaseCutoff: "2027-06-09T23:59:59.000+01:00",
        timezone: "Africa/Lagos",
        graceHours: 0,
        reason: "Fictional WHR-230 seed timing",
      });

      // Reload the edit screen: pre-fill must read the stored instant in the
      // *stored* zone (Lagos), not the browser's own Tokyo clock.
      await page.goto("/admin/settings/giveaway");
      await expect(
        page.getByRole("combobox", { name: "Campaign timezone" }),
      ).toHaveValue("Africa/Lagos");
      await expect(
        page.getByLabel("Launch date", { exact: true }),
      ).toHaveValue("2027-06-01");
      await expect(
        page.getByLabel("Launch time", { exact: true }),
      ).toHaveValue("10:00:00");
      await expect(
        page.getByLabel("Purchase cutoff date", { exact: true }),
      ).toHaveValue("2027-06-09");
      await expect(
        page.getByLabel("Purchase cutoff time", { exact: true }),
      ).toHaveValue("23:59:59");

      // Pick a non-default timezone in the combobox. The same stored instant
      // must now display as its America/New_York (EDT, -04:00 in June)
      // wall-clock equivalent -- not shifted by the browser's Tokyo clock.
      const tzInput = page.getByRole("combobox", {
        name: "Campaign timezone",
      });
      await tzInput.click();
      await tzInput.fill(PICKED_ZONE);
      await page
        .getByRole("option", { name: PICKED_ZONE, exact: true })
        .click();
      await expect(tzInput).toHaveValue(PICKED_ZONE);
      await expect(
        page.getByLabel("Launch date", { exact: true }),
      ).toHaveValue("2027-06-01");
      // 2027-06-01T10:00:00+01:00 == 2027-06-01T09:00:00Z; in June, New York
      // observes EDT (UTC-4), so the local wall-clock is 05:00:00.
      await expect(
        page.getByLabel("Launch time", { exact: true }),
      ).toHaveValue("05:00:00");

      // Make one real, interactive picker edit: nudge the Launch time while
      // keeping its (already-valid) date, the same way an attendant admin
      // would adjust a single field during a review.
      await page.getByLabel("Launch time", { exact: true }).fill("08:00:00");
      await page
        .getByLabel("Reason for change", { exact: true })
        .fill("Fictional WHR-230 timezone picker edit");

      const reviewRequest = page.waitForRequest(
        (r) =>
          r.url().endsWith("/settings/giveaway/review") &&
          r.method() === "POST",
      );
      const reviewResponse = page.waitForResponse((r) =>
        r.url().endsWith("/settings/giveaway/review"),
      );
      await page
        .getByRole("button", { name: "Review changes", exact: true })
        .click();
      const sentBody = (await reviewRequest).postDataJSON();
      expect(sentBody.timezone).toBe(PICKED_ZONE);
      // 2027-06-01T08:00:00 local New York time in June is EDT, -04:00 --
      // the browser's own +09:00 (Tokyo) must not appear anywhere.
      expect(sentBody.launchAt).toBe("2027-06-01T08:00:00.000-04:00");
      expect(sentBody.launchAt).not.toMatch(/\+09:00$/);
      expect((await reviewResponse).status()).toBe(200);

      const main = page.getByRole("main");
      await expect(main).toContainText("GMT-04:00");
      await expect(main).toContainText("America/New_York");
      await expect(main).not.toContainText("GMT+09:00");

      const confirmResponse = page.waitForResponse((r) =>
        r.url().endsWith("/settings/giveaway/confirm"),
      );
      await page
        .getByRole("button", { name: "Confirm changes", exact: true })
        .click();
      expect((await confirmResponse).status()).toBe(201);

      const after = await readSettings(page);
      expect(after.campaign?.timing.timezone).toBe(PICKED_ZONE);
      // The settings-read path normalizes stored instants to UTC server-side
      // (canonicalTimingInstants, pre-existing and unrelated to WHR-230) — same
      // instant, different serialization, so compare by instant, not string.
      expect(new Date(after.campaign!.timing.launchAt!).toISOString()).toBe(
        new Date("2027-06-01T08:00:00.000-04:00").toISOString(),
      );
    } finally {
      await f.close();
    }
  });

  test("WHR-230 locked campaign timing still renders read-only through KeyValueList", async ({
    page,
  }) => {
    const f = await settingsFixture(page, null);
    try {
      await page.route("**/api/admin/settings", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.data.timingLocked = true;
        await route.fulfill({ response, json: body });
      });
      await page.goto("/admin/settings/giveaway");
      await expect(page.getByRole("main")).toContainText(/locked/);
      // No date/time/timezone picker controls render in the locked state --
      // only the plain KeyValueList definition list.
      await expect(
        page.getByRole("main").locator("input, textarea, [role='combobox']"),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Confirm changes", exact: true }),
      ).toHaveCount(0);
    } finally {
      await f.close();
    }
  });

  // --- Regression test for a bug found and fixed during WHR-230. The
  // `setWallClock` closure in src/ui/admin/settings-giveaway.tsx originally
  // re-derived `wall` only from the already-*committed* `draft[key]` instant
  // on every render, so filling just one of a date/time pair while the other
  // was still blank (true of every field on a brand-new campaign) could never
  // complete the pair -- the just-typed value was wiped on the next render.
  // settings-giveaway.tsx now holds each field's wall-clock text in
  // `draft.wall` as its own source of truth, independent of whether the pair
  // resolves to an instant yet. This test keeps that regression covered.
  test("WHR-230 a brand-new campaign's date+time pickers can be completed by filling date then time", async ({
    page,
  }) => {
    const f = await settingsFixture(page, null);
    try {
      const before = await readSettings(page);
      if (before.campaign) {
        test.skip(
          true,
          "A campaign already exists in this fixture database; this bug only reproduces from a brand-new (no campaign) state.",
        );
      }
      await page.goto("/admin/settings/giveaway");
      await expect(
        page
          .getByRole("link", { name: "Create campaign", exact: true })
          .or(page.getByText("Create campaign"))
          .first(),
      ).toBeVisible();
      await page
        .getByLabel("Launch date", { exact: true })
        .fill("2026-02-01");
      await page.getByLabel("Launch time", { exact: true }).fill("09:00:00");
      await expect(
        page.getByLabel("Launch date", { exact: true }),
      ).toHaveValue("2026-02-01");
      await expect(
        page.getByLabel("Launch time", { exact: true }),
      ).toHaveValue("09:00:00");
    } finally {
      await f.close();
    }
  });
});

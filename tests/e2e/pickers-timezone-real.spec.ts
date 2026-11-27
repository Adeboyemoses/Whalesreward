import type { Page } from "@playwright/test";
import { v7 } from "uuid";
import { test, expect } from "../settings/test";
import { settingsFixture, readSettings } from "../settings/helpers";
import type { Settings } from "../../src/shared/contracts/settings";

// WHR-230: the new date/time picker pair + TimezoneCombobox must convert
// wall-clock input to an explicit-offset instant using the *campaign's*
// selected zone, never the browser's own clock/zone. The whole file runs
// with the browser context's timezoneId pinned to Asia/Tokyo (+09:00),
// which is neither Africa/Lagos (the station/default zone, +01:00) nor the
// zone picked in these tests (America/New_York) -- if the browser's own
// zone ever leaked into the computed instant, these assertions would see
// +09:00 or a shifted wall-clock instead.
//
// Environment note (see the test-engineer's report): this repo's giveaway
// timing review/confirm path (canonicalTimingInstants in
// src/server/modules/settings/service.ts) uses PostgreSQL 16's
// pg_input_is_valid(), matching docker-compose.yml's `postgres:16`. A local
// run without a real Postgres 16 (Docker unavailable, only Postgres 15
// locally installed) makes every giveaway review/confirm call fail with a
// generic 503, independent of anything in pickers.tsx or this test. That is
// an environment gap, not a product bug; it reproduces identically on the
// pre-existing tests/e2e/campaign-timing-real.spec.ts once its stale
// "Launch"/"Purchase start"/"Purchase cutoff" labels are updated to this
// screen's new "<label> date"/"<label> time" pairs.
test.use({ timezoneId: "Asia/Tokyo", trace: "off", video: "off" });
test.setTimeout(60000);

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
  const before = (await (await api(page, "settings")).json()).data as Settings;
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
    const tzInput = page.getByRole("combobox", { name: "Campaign timezone" });
    await tzInput.click();
    await tzInput.fill(PICKED_ZONE);
    await page.getByRole("option", { name: PICKED_ZONE, exact: true }).click();
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
    await page
      .getByLabel("Launch time", { exact: true })
      .fill("08:00:00");
    await page.getByLabel("Reason for change", { exact: true }).fill(
      "Fictional WHR-230 timezone picker edit",
    );

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
      page.getByRole("link", { name: "Create campaign", exact: true }).or(
        page.getByText("Create campaign"),
      ).first(),
    ).toBeVisible();
    await page.getByLabel("Launch date", { exact: true }).fill("2026-02-01");
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

import { expect, type Page } from "@playwright/test";
import { v7 } from "uuid";
import type {
  Settings,
  SettingsChange,
} from "../../src/shared/contracts/settings";
import { api, stationFixture, type StationFixture } from "../station/helpers";

export const origin = "http://127.0.0.1:3000";
export const daysLabel = "Photo retention period (days)";
export const reasonLabel = "Reason for change";
export const timingLocked =
  "Campaign dates can't be changed until Whales approves the timing rules";
export type RetentionReview = {
  section: "retention";
  expectedVersion: number;
  before: Settings;
  after: Settings;
  proposal: { days: number | null; reason: string };
  reviewDigest: string;
};

const connections = new WeakMap<Page, StationFixture["db"]>();
const reviews = new WeakMap<Page, RetentionReview>();

/** Only these tests take this session lock; no production request depends on it. */
export async function settingsFixture(
  page: Page,
  grants: string[] | null = ["settings"],
) {
  const f = await stationFixture(page, grants ?? undefined);
  await f.db.query("SELECT pg_advisory_lock(270014)");
  connections.set(page, f.db);
  return {
    ...f,
    async close() {
      connections.delete(page);
      reviews.delete(page);
      await f.db.query("SELECT pg_advisory_unlock(270014)");
      await f.db.end();
    },
  };
}
export const readSettings = (page: Page) =>
  api<Settings>(page.request, "settings");
export const readHistory = (page: Page, query = "") =>
  api<{ items: SettingsChange[]; nextCursor: string | null }>(
    page.request,
    `settings/history${query}`,
  );
/** A canonical metadata change is a real refusal, never permission to replace guards blindly. */
export async function rejectedMetadataReview(
  page: Page,
  review: RetentionReview,
  operationId: string,
  db = connections.get(page),
) {
  const latest = await readSettings(page);
  expect(latest.version).toBe(review.expectedVersion);
  expect(latest.retention).toEqual(review.before.retention);
  expect(latest.settingsVersionId).toBe(review.before.settingsVersionId);
  const stable = (value: Settings) => ({
    ...value,
    station: {
      ...value.station,
      products: value.station.products.map((product) => ({
        ...product,
        quantityPrecision: null,
      })),
    },
    campaign: value.campaign
      ? {
          ...value.campaign,
          dataVersion: "0",
          reconciliationRequired: false,
          reconciledDataVersion: null,
        }
      : null,
  });
  expect(
    stable(latest),
    "Only unrelated catalog/report metadata may drift",
  ).toEqual(stable(review.before));
  expect(
    latest,
    "A proven canonical metadata difference is required",
  ).not.toEqual(review.before);
  if (!db) throw new Error("Missing local rejection-check connection");
  const result = await db.query(
    `SELECT
    (SELECT count(*)::int FROM settings_version WHERE operation_id=$1) AS versions,
    (SELECT count(*)::int FROM mutation_receipt WHERE operation_id=$1) AS receipts`,
    [operationId],
  );
  expect(result.rows[0]).toEqual({ versions: 0, receipts: 0 });
  return latest;
}

export async function saveIntent(
  page: Page,
  days: number | null,
  reason: string,
  known?: Settings,
  db = connections.get(page),
) {
  let current = known ?? (await readSettings(page));
  if (current.retention.days === days) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const review = await api<RetentionReview>(
      page.request,
      "settings/retention/review",
      {
        days,
        reason,
        expectedVersion: current.version,
      },
    );
    const operationId = v7();
    const response = await page.request.post(
      "/api/admin/settings/retention/confirm",
      {
        headers: { Origin: origin },
        data: {
          ...review.proposal,
          expectedVersion: review.expectedVersion,
          reviewDigest: review.reviewDigest,
          operationId,
        },
      },
    );
    const result = await response.json();
    if (response.status() === 201) return result.data as SettingsChange;
    expect(
      response.status(),
      `Fixture confirmation: ${result.error?.code}`,
    ).toBe(409);
    expect(result.error?.code).toBe("review_stale");
    current = await rejectedMetadataReview(page, review, operationId, db);
    expect(
      attempt,
      "Canonical metadata changed on all three explicit fixture reviews",
    ).toBeLessThan(2);
  }
  throw new Error("Unreachable fixture review state");
}
export function nextDays(current: Settings, first = 37) {
  return current.retention.days === first ? first + 1 : first;
}
export async function editIntent(
  page: Page,
  days: number | null,
  reason: string,
) {
  await page.goto("/admin/settings/retention");
  await page
    .getByLabel(daysLabel, { exact: true })
    .fill(days === null ? "" : String(days));
  await page.getByLabel(reasonLabel, { exact: true }).fill(reason);
}
export async function reviewIntent(page: Page) {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/settings/retention/review") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  const result = await response;
  if (result.status() === 200)
    reviews.set(page, (await result.json()).data as RetentionReview);
  return result;
}
export async function confirmIntent(page: Page, status = 201) {
  const rejected: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const pending = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/settings/retention/confirm") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Confirm changes", exact: true })
      .click();
    const response = await pending;
    const result = await response.json();
    const operationId = response.request().postDataJSON().operationId as string;
    expect(rejected).not.toContain(operationId);
    if (response.status() === status) return response;
    expect(
      status,
      "Expected-refusal cases must never recover automatically",
    ).toBe(201);
    expect(response.status(), `Confirmation: ${result.error?.code}`).toBe(409);
    expect(result.error?.code).toBe("review_stale");
    const review = reviews.get(page);
    if (!review) throw new Error("Missing explicit UI review");
    await rejectedMetadataReview(page, review, operationId);
    expect(
      attempt,
      "Canonical metadata changed on all three explicit UI reviews",
    ).toBeLessThan(2);
    rejected.push(operationId);
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      /review is out of date/,
    );
    await page
      .getByRole("button", { name: "Reload settings", exact: true })
      .click();
    await expect(page.getByLabel(daysLabel, { exact: true })).toBeEnabled();
    expect((await reviewIntent(page)).status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: /^Confirm settings change/ }),
    ).toBeVisible();
  }
  throw new Error("Unreachable UI review state");
}

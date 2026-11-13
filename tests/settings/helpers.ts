import { expect, type Page } from "@playwright/test";
import { v7 } from "uuid";
import type {
  Settings,
  SettingsChange,
} from "../../src/shared/contracts/settings";
import { api, stationFixture } from "../station/helpers";

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

/** Only these tests take this session lock; no production request depends on it. */
export async function settingsFixture(
  page: Page,
  grants: string[] | null = ["settings"],
) {
  const f = await stationFixture(page, grants ?? undefined);
  await f.db.query("SELECT pg_advisory_lock(270014)");
  return {
    ...f,
    async close() {
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
export async function saveIntent(
  page: Page,
  days: number | null,
  reason: string,
  known?: Settings,
) {
  const current = known ?? (await readSettings(page));
  if (current.retention.days === days) return null;
  const review = await api<RetentionReview>(
    page.request,
    "settings/retention/review",
    { days, reason, expectedVersion: current.version },
  );
  return api<SettingsChange>(
    page.request,
    "settings/retention/confirm",
    {
      ...review.proposal,
      expectedVersion: review.expectedVersion,
      reviewDigest: review.reviewDigest,
      operationId: v7(),
    },
    201,
  );
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
  return response;
}
export async function confirmIntent(page: Page, status = 201) {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/settings/retention/confirm") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Confirm changes", exact: true })
    .click();
  expect((await response).status()).toBe(status);
}

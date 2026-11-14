import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { randomInt } from "node:crypto";
import type {
  Report,
  ReportFilter,
  ReportExport,
} from "../../src/shared/contracts/reports";
import { z } from "zod";
import { overviewSchema } from "../../src/shared/contracts/reports";
type Overview = z.infer<typeof overviewSchema>;
import { stationFixture, api } from "../station/helpers";
import { historicalSale } from "../helpers/cards-adversarial-fixture";
import { seedHistorical } from "../helpers/review-evidence-fixture";

export const origin = "http://127.0.0.1:3000";
export async function reportsBrowserFixture(
  page: Page,
  permissions = ["overview", "reports", "reportExport", "sales", "customers"],
) {
  const f = await stationFixture(page, permissions);
  await f.db.query("SELECT pg_advisory_lock(250025)");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  // Distinct old calendar dates isolate report predicates from unrelated local workflows.
  const day = `${randomInt(1000, 1900)}-${String(randomInt(1, 13)).padStart(2, "0")}-${String(randomInt(1, 28)).padStart(2, "0")}`;
  const filters: ReportFilter = {
    from: day,
    to: day,
    product: null,
    groupBy: "product",
  };
  const ids: string[] = [];
  async function sale(
    options: Parameters<typeof historicalSale>[1] = {},
    verified = false,
  ) {
    const row = await historicalSale(pool, options);
    ids.push(row.id);
    await seedHistorical(
      pool,
      "purchase",
      "UPDATE purchase SET app_captured_at=$2::date+interval '12 hours' WHERE id=$1",
      [row.id, day],
    );
    if (verified)
      await seedHistorical(
        pool,
        "purchase_revision",
        "UPDATE purchase_revision SET verified_sale_date=$2::date WHERE purchase_id=$1 AND state='accepted'",
        [row.id, day],
      );
    return row;
  }
  return {
    ...f,
    pool,
    day,
    filters,
    ids,
    sale,
    query: (input: ReportFilter = filters) =>
      api<Report>(page.request, "reports/query", input),
    overview: () => api<Overview>(page.request, "overview"),
    status: (id: string) =>
      api<ReportExport>(page.request, `reports/exports/${id}`),
    async close() {
      await pool.end();
      await f.db.query("SELECT pg_advisory_unlock(250025)");
      await f.db.end();
    },
  };
}
export async function viewedReport(page: Page, filters: ReportFilter) {
  await page.goto("/admin/reports");
  await page.getByLabel("From", { exact: true }).fill(filters.from);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/reports/query") &&
      r.request().postDataJSON().from === filters.from &&
      r.request().postDataJSON().to === filters.to &&
      r.status() === 200,
  );
  await page.getByLabel("To", { exact: true }).fill(filters.to);
  const result = (await (await response).json()).data as Report;
  await expect(
    page.getByRole("table", { name: "Sales breakdown" }),
  ).toBeVisible();
  return result;
}
export async function prepareExport(page: Page, format: "pdf" | "xlsx") {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/reports/exports") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: format === "pdf" ? "Export PDF" : "Export Excel",
      exact: true,
    })
    .click();
  const r = await response;
  expect([200, 202]).toContain(r.status());
  return {
    receipt: (await r.json()).data as ReportExport,
    input: r.request().postDataJSON(),
  };
}

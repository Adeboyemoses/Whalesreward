import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import {
  reportsBrowserFixture,
  viewedReport,
  prepareExport,
  origin,
} from "../reports/helpers";
import type { ReportSource } from "../../src/shared/contracts/reports";
import { api } from "../station/helpers";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.setTimeout(60000);

test("I-29 I-40 I-42 I-44 reports use accepted values and separate units, exclusions and source date evidence", async ({
  page,
}) => {
  const f = await reportsBrowserFixture(page);
  try {
    await f.sale(
      { amount: "2000000", acceptedAmount: "2100000", lateProposal: true },
      true,
    );
    await f.sale({ product: "cooking_gas", amount: "3000000" });
    await f.sale({ state: "held", amount: "400000" });
    await f.sale({ state: "photo_pending", amount: "500000" });
    await f.sale({ state: "cancelled", amount: "600000" });
    const report = await viewedReport(page, f.filters);
    expect(report.totals.purchases).toBe("2");
    expect(report.totals.spend).toEqual([
      { currency: "NGN", amountKobo: "5100000" },
    ]);
    expect(report.totals.litres).toBe("2.1");
    expect(report.totals.kilograms).toBe("3");
    const main = page.getByRole("main");
    await expect(main).toContainText("₦51,000.00");
    for (const label of ["Pending", "Held", "Cancelled", "Ineligible"])
      await expect(main).toContainText(label);
    const table = page.getByRole("table", { name: "Sales breakdown" });
    await expect(table).toContainText("₦21,000.00");
    await expect(table).toContainText("₦30,000.00");
    await page
      .getByRole("button", { name: "Show source sales", exact: true })
      .click();
    const sources = page.getByRole("table", { name: "Source sales" });
    await expect(sources).toContainText("Verified date");
    await expect(sources).toContainText("Reported date");
    const response = await api<{ items: ReportSource[] }>(
      page.request,
      "reports/sources",
      { ...f.filters, expectedDataVersion: report.dataVersion },
    );
    expect(response.items).toHaveLength(5);
    expect(response.items.filter((r) => r.included)).toHaveLength(2);
    expect(response.items.map((r) => r.quantity).sort()).toEqual([
      "0.4",
      "0.5",
      "0.6",
      "2.1",
      "3",
    ]);
    for (const row of response.items)
      expect(Object.keys(row)).not.toContain("customerName");
    for (const groupBy of ["attendant", "pump"] as const) {
      const pending = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/admin/reports/query") &&
          r.request().postDataJSON().groupBy === groupBy &&
          r.status() === 200,
      );
      await page
        .getByRole("button", { name: `By ${groupBy}`, exact: true })
        .click();
      const grouped = (await (await pending).json()).data;
      expect(grouped.totals).toEqual(report.totals);
      await expect(page.getByLabel("From", { exact: true })).toHaveValue(f.day);
      await expect(table).toContainText(
        groupBy === "attendant" ? "STAFF002" : "PUMP02",
      );
    }
  } finally {
    await f.close();
  }
});

test("I-44 changing report filters invalidates old figures and empty products show honest zeros", async ({
  page,
}) => {
  const f = await reportsBrowserFixture(page);
  try {
    await f.sale({ amount: "1234567" });
    await viewedReport(page, f.filters);
    await expect(page.getByRole("main")).toContainText("₦12,345.67");
    await page.getByLabel("From", { exact: true }).fill("");
    await expect(page.getByRole("main")).not.toContainText("₦12,345.67");
    await expect(
      page.getByRole("button", { name: "Export PDF", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("table", { name: "Sales breakdown" }),
    ).toHaveCount(0);
    await page.getByLabel("From", { exact: true }).fill(f.day);
    await expect(
      page.getByRole("table", { name: "Sales breakdown" }),
    ).toBeVisible();
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/reports/query") &&
        r.request().postDataJSON().product === "cooking_gas" &&
        r.status() === 200,
    );
    await page
      .getByLabel("Product", { exact: true })
      .selectOption("cooking_gas");
    expect((await (await response).json()).data.totals.purchases).toBe("0");
    await expect(page.getByRole("main")).toContainText(/No completed/);
    await expect(page.getByRole("main")).not.toContainText("₦12,345.67");
  } finally {
    await f.close();
  }
});

test("I-42 report source pagination rejects changed generation and requires explicit refresh", async ({
  page,
}) => {
  const f = await reportsBrowserFixture(page);
  try {
    for (let i = 0; i < 26; i++) await f.sale({ amount: "1000000" });
    const report = await viewedReport(page, f.filters);
    await page
      .getByRole("button", { name: "Show source sales", exact: true })
      .click();
    const rows = page
      .getByRole("table", { name: "Source sales" })
      .locator("tbody tr");
    await expect(rows).toHaveCount(25);
    await f.sale({ amount: "2000000" });
    const refused = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/reports/sources") && r.status() === 409,
    );
    await page
      .getByRole("button", { name: "More source rows", exact: true })
      .click();
    expect((await (await refused).json()).error.code).toBe("read_view_stale");
    await expect(page.getByRole("table", { name: "Source sales" })).toHaveCount(
      0,
    );
    const refreshed = page.waitForResponse(
      (r) => r.url().endsWith("/api/admin/reports/query") && r.status() === 200,
    );
    await page
      .getByRole("button", { name: "Refresh report", exact: true })
      .click();
    const next = (await (await refreshed).json()).data;
    expect(BigInt(next.dataVersion)).toBeGreaterThan(
      BigInt(report.dataVersion),
    );
    expect(next.totals.purchases).toBe("27");
    await page
      .getByRole("button", { name: "Show source sales", exact: true })
      .click();
    const freshRows = page
      .getByRole("table", { name: "Source sales" })
      .locator("tbody tr");
    await expect(freshRows).toHaveCount(25);
    await page
      .getByRole("button", { name: "More source rows", exact: true })
      .click();
    await expect(freshRows).toHaveCount(27);
    const codes = await freshRows.locator("td:first-child").allTextContents();
    expect(new Set(codes).size).toBe(27);
  } finally {
    await f.close();
  }
});

test("I-07 I-09 I-45 overview null launch and unavailable projections never become board sample totals", async ({
  page,
}) => {
  const f = await reportsBrowserFixture(page, ["overview", "reports"]);
  try {
    const data = await f.overview();
    expect(data.launchConfigured).toBe(false);
    expect(data.customersSinceLaunch).toBeNull();
    expect(data.attention).toBeNull();
    expect(data.recentSales).toBeNull();
    expect(data.recentCustomers).toBeNull();
    await page.goto("/admin");
    await expect(page.getByRole("main")).toContainText("Launch date not set");
    await expect(page.getByRole("main").getByRole("table")).toHaveCount(0);
    await page.goto("/admin/reports");
    await expect(
      page.getByRole("button", { name: "Export PDF", exact: true }),
    ).toHaveCount(0);
    const denied = await page.request.post("/api/admin/reports/exports", {
      headers: { Origin: origin },
      data: {},
    });
    expect(denied.status()).toBe(403);
    const role = (
      await f.db.query("SELECT role_id FROM admin WHERE id=$1", [f.adminId])
    ).rows[0].role_id;
    await f.db.query(
      "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='reports'",
      [role],
    );
    await page.reload();
    await expect(page.getByLabel("From", { exact: true })).toHaveCount(0);
    expect(
      (
        await page.request.post("/api/admin/reports/query", {
          headers: { Origin: origin },
          data: f.filters,
        })
      ).status(),
    ).toBe(403);
  } finally {
    await f.close();
  }
});

test("I-44 exports freeze exactly the viewed generation and download the real PDF and Excel", async ({
  page,
}) => {
  const f = await reportsBrowserFixture(page);
  try {
    await f.sale({ amount: "7654321" });
    const report = await viewedReport(page, f.filters);
    for (const format of ["pdf", "xlsx"] as const) {
      const result = await prepareExport(page, format);
      expect(result.input.filters).toEqual(report.filters);
      expect(result.input.expectedDataVersion).toBe(report.dataVersion);
      expect(result.receipt.sourceDataVersion).toBe(report.dataVersion);
      await expect
        .poll(async () => (await f.status(result.receipt.id)).state, {
          timeout: 20000,
        })
        .toBe("ready");
      const status = page.getByRole("button", {
        name: "Check export status",
        exact: true,
      });
      if (await status.isVisible()) await status.click();
      const fileResponse = page.waitForResponse((r) =>
        r
          .url()
          .endsWith(`/api/admin/reports/exports/${result.receipt.id}/file`),
      );
      const downloadEvent = page.waitForEvent("download");
      await page
        .getByRole("button", {
          name: format === "pdf" ? "Download PDF" : "Download Excel",
          exact: true,
        })
        .click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toMatch(
        format === "pdf" ? /\.pdf$/ : /\.xlsx$/,
      );
      expect(await download.failure()).toBeNull();
      const file = await fileResponse;
      expect(file.status()).toBe(200);
      expect((await file.allHeaders())["cache-control"]).toBe("no-store");
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      expect(bytes.byteLength).toBeGreaterThan(100);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        (await f.status(result.receipt.id)).sha256,
      );
    }
  } finally {
    await f.close();
  }
});

test("I-40 an uncertain export preparation retries identical intent without a second export", async ({
  page,
}) => {
  const f = await reportsBrowserFixture(page);
  try {
    await f.sale({ amount: "9876543" });
    const report = await viewedReport(page, f.filters);
    const inputs: Record<string, unknown>[] = [];
    let receiptId = "";
    await page.route("**/api/admin/reports/exports", async (route) => {
      inputs.push(route.request().postDataJSON());
      const result = await route.fetch();
      if (inputs.length === 1) {
        expect(result.status()).toBe(202);
        receiptId = (await result.json()).data.id;
        await route.abort("failed");
      } else await route.fulfill({ response: result });
    });
    await page.getByRole("button", { name: "Export PDF", exact: true }).click();
    const retry = page.getByRole("button", {
      name: "Retry preparation",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    await retry.click();
    await expect(retry).toHaveCount(0);
    expect(inputs).toHaveLength(2);
    expect(inputs[1]).toEqual(inputs[0]);
    expect(inputs[0]!.expectedDataVersion).toBe(report.dataVersion);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM report_export WHERE created_by=$1",
          [f.adminId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect((await f.status(receiptId)).id).toBe(receiptId);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});

test("I-44 failed and expired exports require fresh preparation, with PDF offered for precision failure", async ({
  page,
}) => {
  const f = await reportsBrowserFixture(page);
  try {
    await f.sale({ amount: "4567890" });
    await viewedReport(page, f.filters);
    const first = await prepareExport(page, "xlsx");
    await expect
      .poll(async () => (await f.status(first.receipt.id)).state, {
        timeout: 20000,
      })
      .toBe("ready");
    await f.db.query(
      "UPDATE report_export SET status='failed',failure_code='precision_not_representable' WHERE id=$1",
      [first.receipt.id],
    );
    await page
      .getByRole("button", { name: "Check export status", exact: true })
      .click();
    await expect(page.getByRole("main")).toContainText(
      /precision|exact|round/i,
    );
    await expect(
      page.getByRole("button", { name: "Prepare a new export", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download Excel", exact: true }),
    ).toHaveCount(0);
    const preparing = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/reports/exports") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Prepare a new export", exact: true })
      .click();
    const prepared = await preparing;
    expect(prepared.status()).toBe(202);
    const second = {
      receipt: (await prepared.json()).data,
      input: prepared.request().postDataJSON(),
    };
    expect(second.receipt.format).toBe("pdf");
    expect(second.receipt.id).not.toBe(first.receipt.id);
    expect(second.input.operationId).not.toBe(first.input.operationId);
    await expect
      .poll(async () => (await f.status(second.receipt.id)).state, {
        timeout: 20000,
      })
      .toBe("ready");
    await f.db.query(
      "UPDATE report_export SET prepared_at=statement_timestamp()-interval '25 hours',expires_at=statement_timestamp()-interval '1 hour' WHERE id=$1",
      [second.receipt.id],
    );
    await page
      .getByRole("button", { name: "Check export status", exact: true })
      .click();
    await expect(page.getByRole("main")).toContainText(/Expired|expired/);
    await expect(
      page.getByRole("button", { name: "Prepare a new export", exact: true }),
    ).toBeVisible();
    expect(
      (
        await page.request.get(
          `/api/admin/reports/exports/${second.receipt.id}/file`,
        )
      ).status(),
    ).toBe(410);
  } finally {
    await f.close();
  }
});

test("I-44 a delayed old filter response cannot replace the newly selected report", async ({
  page,
}) => {
  const f = await reportsBrowserFixture(page);
  let release = () => {};
  try {
    await f.sale({ amount: "3333333" });
    await f.sale({ product: "cooking_gas", amount: "4444444" });
    await viewedReport(page, f.filters);
    let reached = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    await page.route("**/api/admin/reports/query", async (route) => {
      const input = route.request().postDataJSON();
      const response = await route.fetch();
      if (input.product === "pms") {
        reached();
        await blocked;
      }
      await route.fulfill({ response });
    });
    await page.getByLabel("Product", { exact: true }).selectOption("pms");
    await started;
    const next = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/reports/query") &&
        r.request().postDataJSON().product === "cooking_gas" &&
        r.status() === 200,
    );
    await page
      .getByLabel("Product", { exact: true })
      .selectOption("cooking_gas");
    await next;
    await expect(
      page.getByRole("table", { name: "Sales breakdown" }),
    ).toContainText("₦44,444.44");
    const old = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/admin/reports/query") &&
        r.request().postDataJSON().product === "pms",
    );
    release();
    await old;
    await expect(
      page.getByRole("table", { name: "Sales breakdown" }),
    ).toContainText("₦44,444.44");
    await expect(page.getByRole("main")).not.toContainText("₦33,333.33");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});

test("I-07 I-09 a report response released after live permission revocation cannot restore private rows", async ({
  page,
}) => {
  const f = await reportsBrowserFixture(page);
  let release = () => {};
  try {
    await f.sale({ amount: "5555555" });
    await viewedReport(page, f.filters);
    let reached = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    await page.route("**/api/admin/reports/query", async (route) => {
      const response = await route.fetch();
      reached();
      await blocked;
      await route.fulfill({ response });
    });
    await page
      .getByRole("button", { name: "By attendant", exact: true })
      .click();
    await started;
    const role = (
      await f.db.query("SELECT role_id FROM admin WHERE id=$1", [f.adminId])
    ).rows[0].role_id;
    await f.db.query(
      "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='reports'",
      [role],
    );
    const session = page.waitForResponse((r) =>
      r.url().endsWith("/api/admin/session"),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await session;
    await expect(page.getByLabel("From", { exact: true })).toHaveCount(0);
    release();
    await page.unrouteAll({ behavior: "wait" });
    await expect(
      page.getByRole("table", { name: "Sales breakdown" }),
    ).toHaveCount(0);
    await expect(page.getByRole("main")).not.toContainText("₦55,555.55");
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});

test("I-07 overview attention destinations preserve only the matching sales filter", async ({
  page,
}) => {
  const f = await reportsBrowserFixture(page);
  try {
    const overview = await f.overview();
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "Overview", exact: true }),
    ).toBeVisible();
    for (const card of overview.attention ?? []) {
      if (!card.destination) continue;
      const href = `/admin/sales?status=${card.destination.filter.status}`;
      const link = page.getByRole("main").locator(`a[href="${href}"]`);
      await expect(link).toHaveCount(1);
      await expect(link).toContainText(card.count);
    }
    expect(overview.attention).toHaveLength(3);
  } finally {
    await f.close();
  }
});

for (const kind of ["sources", "groups"] as const) {
  test(`I-42 refreshing during a pending ${kind} page releases only the new view pager`, async ({
    page,
  }) => {
    const f = await reportsBrowserFixture(page);
    let releaseOld = () => {},
      releaseNew = () => {};
    try {
      for (let i = 0; i < 26; i++)
        await f.sale({ product: "diesel", amount: "1000000" });
      await viewedReport(page, f.filters);
      if (kind === "groups") {
        const grouped = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/admin/reports/query") &&
            r.request().postDataJSON().groupBy === "attendant" &&
            r.status() === 200,
        );
        await page
          .getByRole("button", { name: "By attendant", exact: true })
          .click();
        await grouped;
      } else
        await page
          .getByRole("button", { name: "Show source sales", exact: true })
          .click();
      const table = page.getByRole("table", {
        name: kind === "groups" ? "Sales breakdown" : "Source sales",
      });
      await expect(table.locator("tbody tr")).toHaveCount(25);
      let oldReached = () => {},
        newReached = () => {};
      const oldStarted = new Promise<void>((resolve) => {
        oldReached = resolve;
      });
      const newStarted = new Promise<void>((resolve) => {
        newReached = resolve;
      });
      const oldBlocked = new Promise<void>((resolve) => {
        releaseOld = resolve;
      });
      const newBlocked = new Promise<void>((resolve) => {
        releaseNew = resolve;
      });
      let calls = 0;
      const endpoint = kind === "groups" ? "query" : "sources";
      await page.route(`**/api/admin/reports/${endpoint}`, async (route) => {
        const input = route.request().postDataJSON();
        if (kind === "groups" && !input.cursor) {
          await route.continue();
          return;
        }
        const response = await route.fetch();
        calls++;
        if (calls === 1) {
          oldReached();
          await oldBlocked;
        } else if (calls === 2) {
          newReached();
          await newBlocked;
        }
        await route.fulfill({ response });
      });
      const moreName = kind === "groups" ? "More groups" : "More source rows";
      await page.getByRole("button", { name: moreName, exact: true }).click();
      await oldStarted;
      await expect(
        page.getByRole("button", { name: moreName, exact: true }),
      ).toBeDisabled();
      const refreshed = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/admin/reports/query") &&
          !r.request().postDataJSON().cursor &&
          r.status() === 200,
      );
      await page
        .getByRole("button", { name: "Refresh report", exact: true })
        .click();
      await refreshed;
      const newPager = page.getByRole("button", {
        name: kind === "groups" ? "More groups" : "Show source sales",
        exact: true,
      });
      // A refresh must detach the old in-flight page's lock before its response arrives.
      await expect(newPager).toBeEnabled();
      await newPager.click();
      await newStarted;
      await expect(newPager).toBeDisabled();
      const oldResponse = page.waitForResponse((r) =>
        r.url().endsWith(`/api/admin/reports/${endpoint}`),
      );
      releaseOld();
      await (await oldResponse).finished();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      // The obsolete request cannot publish rows or unlock the newer pending request.
      await expect(newPager).toBeDisabled();
      if (kind === "sources") await expect(table).toHaveCount(0);
      else await expect(table.locator("tbody tr")).toHaveCount(25);
      releaseNew();
      await expect(table.locator("tbody tr")).toHaveCount(
        kind === "sources" ? 25 : 26,
      );
      if (kind === "sources") {
        await expect(
          page.getByRole("button", { name: moreName, exact: true }),
        ).toBeEnabled();
        await page.getByRole("button", { name: moreName, exact: true }).click();
        await expect(table.locator("tbody tr")).toHaveCount(26);
      }
    } finally {
      releaseOld();
      releaseNew();
      await page.unrouteAll({ behavior: "wait" });
      await f.close();
    }
  });
}

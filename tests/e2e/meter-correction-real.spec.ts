import { test, expect, type Page } from "@playwright/test";
import {
  reviewFixture,
  heldSale,
  explain,
  confirm,
  adminDetail,
} from "../reviews/helpers";
import { installBrowserMeter } from "../reviews/meter-helpers";

test.use({ trace: "off", video: "off", screenshot: "off" });
async function edit(
  page: Page,
  id: string,
  amount = "11000.00",
  quantity = "11.00",
) {
  await page.goto(`/admin/sales/${id}/price-review/correct`);
  await page.getByLabel("Meter amount (₦)", { exact: true }).fill(amount);
  await page
    .getByLabel("Meter quantity (litres)", { exact: true })
    .fill(quantity);
  await explain(page);
}
test("I-26 I-31 I-35 exact meter pair records one revision and preserves another hold", async ({
  page,
  browser,
}) => {
  const f = await reviewFixture(page, browser);
  try {
    await installBrowserMeter(f.db);
    const sale = await heldSale(f, ["price", "date"], "1000000", "before", {
      amount: "11000.00",
      quantity: "11.00",
    });
    await edit(page, sale.id);
    await page.getByLabel("Meter amount (₦)", { exact: true }).fill("11000.01");
    await expect(
      page.getByLabel("Meter quantity (litres)", { exact: true }),
    ).toHaveValue("11.00");
    await page.getByLabel("Meter amount (₦)", { exact: true }).fill("11000.00");
    await page
      .getByRole("button", { name: "Open full size", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Full size meter photo" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Close photo", exact: true })
      .click();
    const before = await adminDetail(page, sale.id);
    let submitted: Record<string, unknown> | undefined;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/price-decision"))
        submitted = r.postDataJSON();
    });
    const result = await confirm(page, "Review correction");
    expect(submitted?.decision).toEqual({
      outcome: "correct_meter",
      amountKobo: "1100000",
      quantity: "11.00",
    });
    expect(result.creditedAfter).toBe(false);
    expect(
      result.remainingHolds.map((h: { kind: string }) => h.kind),
    ).toContain("date");
    const after = await adminDetail(page, sale.id);
    expect(after.original).toEqual(before.original);
    expect(
      (
        await f.db.query(
          "SELECT calculation,amount_kobo::text,quantity::text FROM purchase_revision WHERE purchase_id=$1 AND kind='price_resolution'",
          [sale.id],
        )
      ).rows,
    ).toEqual([
      {
        calculation: "meter_evidence",
        amount_kobo: "1100000",
        quantity: "11.000000",
      },
    ]);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM meter_evaluation WHERE purchase_id=$1",
          [sale.id],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await f.close();
  }
});
test("I-31 outside display allowance leaves meter decision and contribution unchanged", async ({
  page,
  browser,
}) => {
  const f = await reviewFixture(page, browser);
  try {
    await installBrowserMeter(f.db);
    const sale = await heldSale(f, ["price"]);
    const before = await adminDetail(page, sale.id);
    await edit(page, sale.id, "11000.00", "9.00");
    await confirm(page, "Review correction", 422);
    await expect(page.getByRole("alert")).toContainText(
      /rate|allowance|rounding/i,
    );
    const after = await adminDetail(page, sale.id);
    expect(after.original).toEqual(before.original);
    expect(after.version).toBe(before.version);
    expect(after.credited).toBe(false);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM meter_evaluation WHERE purchase_id=$1",
          [sale.id],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await f.close();
  }
});
test("I-39 stale meter confirmation cannot overwrite a newer sale version", async ({
  page,
  browser,
}) => {
  const f = await reviewFixture(page, browser);
  try {
    await installBrowserMeter(f.db);
    const sale = await heldSale(f, ["price"]);
    await edit(page, sale.id);
    await page
      .getByRole("button", { name: "Review correction", exact: true })
      .click();
    await f.db.query("UPDATE purchase SET version=version+1 WHERE id=$1", [
      sale.id,
    ]);
    const response = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" && r.url().endsWith("/price-decision"),
    );
    await page
      .getByRole("button", { name: "Confirm decision", exact: true })
      .click();
    expect((await response).status()).toBe(409);
    await expect(page.getByRole("alert")).toContainText(/changed|reload/i);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM meter_evaluation WHERE purchase_id=$1",
          [sale.id],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await f.close();
  }
});

test("I-22 I-31 unchanged pair is refused and lost meter response replays one exact operation", async ({
  page,
  browser,
}) => {
  const f = await reviewFixture(page, browser);
  try {
    await installBrowserMeter(f.db);
    const sale = await heldSale(f, ["price"]);
    await edit(page, sale.id, "10000.00", sale.original.entry.quantity);
    await confirm(page, "Review correction", 409);
    await expect(page.getByRole("alert")).toContainText(
      /same|match|unchanged/i,
    );
    await page.reload();
    await edit(page, sale.id);
    const bodies: unknown[] = [];
    let first = true;
    await page.route(
      "**/api/admin/sales/*/holds/*/price-decision",
      async (route) => {
        bodies.push(route.request().postDataJSON());
        if (first) {
          first = false;
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          await route.abort("failed");
        } else await route.continue();
      },
    );
    await page
      .getByRole("button", { name: "Review correction", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm decision", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry same decision", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Meter amount (₦)", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Retry same decision", exact: true })
      .click();
    await expect(page.getByText(/Decision recorded\./).first()).toBeVisible();
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(
      (
        await f.db.query(
          "SELECT count(*)::int n FROM meter_evaluation WHERE purchase_id=$1",
          [sale.id],
        )
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await page.unrouteAll({ behavior: "wait" });
    await f.close();
  }
});

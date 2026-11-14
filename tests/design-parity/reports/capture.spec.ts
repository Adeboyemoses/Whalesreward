import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { reportsBrowserFixture, viewedReport } from "../../reports/helpers";
import { fixtureId } from "../../helpers/cards-adversarial-fixture";
import { seedHistorical } from "../../helpers/review-evidence-fixture";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.setTimeout(90000);
test("I-44 independent B02 E05 E06 E07 fidelity at 1440 and 390 px", async ({
  page,
}) => {
  const f = await reportsBrowserFixture(page);
  try {
    const boardRows = [
      ["2026-10-27", "pms", 20000],
      ["2026-10-27", "diesel", 9000],
      ["2026-10-28", "pms", 20000],
      ["2026-10-28", "cooking_gas", 14000],
      ["2026-10-29", "kerosene", 9000],
      ["2026-10-30", "pms", 21000],
      ["2026-10-31", "pms", 11000],
      ["2026-10-31", "kerosene", 4500],
      ["2026-10-31", "cooking_gas", 4500],
      ["2026-11-01", "diesel", 27000],
      ["2026-11-01", "pms", 2500],
      ["2026-11-02", "pms", 15500],
      ["2026-11-02", "cooking_gas", 11500],
    ] as const;
    // Historical board fixtures only. All reads and rendering below use the real HTTP service.
    for (const [day, product, naira] of process.env.WHR_FIDELITY_REUSE === "1"
      ? []
      : boardRows) {
      const row = await f.sale({
        product: product === "kerosene" ? "diesel" : product,
        amount: String(naira * 100),
      });
      if (product === "kerosene") {
        const db = await f.pool.connect();
        try {
          await db.query("BEGIN");
          for (const table of [
            "purchase",
            "assignment",
            "product_price_version",
          ])
            await db.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
          const original = (
            await db.query(
              "SELECT assignment_id,price_version_id FROM purchase WHERE id=$1",
              [row.id],
            )
          ).rows[0];
          await db.query("UPDATE assignment SET pump_id=$2 WHERE id=$1", [
            original.assignment_id,
            fixtureId(16),
          ]);
          await db.query(
            "UPDATE product_price_version SET product_id=$2,version=(SELECT coalesce(max(version),0)+1 FROM product_price_version WHERE product_id=$2) WHERE id=$1",
            [original.price_version_id, fixtureId(11)],
          );
          await db.query(
            "UPDATE purchase SET product_id=$2,pump_id=$3 WHERE id=$1",
            [row.id, fixtureId(11), fixtureId(16)],
          );
          await db.query("SET CONSTRAINTS ALL IMMEDIATE");
          for (const table of [
            "purchase",
            "assignment",
            "product_price_version",
          ])
            await db.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
          await db.query("COMMIT");
        } catch (e) {
          await db.query("ROLLBACK");
          throw e;
        } finally {
          db.release();
        }
      }
      await seedHistorical(
        f.pool,
        "purchase",
        "UPDATE purchase SET app_captured_at=$2::date+interval '12 hours' WHERE id=$1",
        [row.id, day],
      );
      const rate =
        product === "pms"
          ? 1000
          : product === "diesel"
            ? 1200
            : product === "kerosene"
              ? 900
              : 1500;
      await seedHistorical(
        f.pool,
        "purchase_revision",
        "UPDATE purchase_revision SET quantity=$2,rate_kobo=$3 WHERE purchase_id=$1 AND state='accepted'",
        [row.id, String(naira / rate), String(rate * 100)],
      );
    }
    const filters = {
      from: "2026-10-27",
      to: "2026-11-02",
      product: null,
      groupBy: "product" as const,
    };
    const report = await viewedReport(page, filters);
    expect(report.totals.purchases).toBe("13");
    expect(report.totals.spend).toEqual([
      { currency: "NGN", amountKobo: "16950000" },
    ]);
    expect(report.totals.litres).toBe("135");
    expect(report.totals.kilograms).toBe("20");
    async function capture(id: string, width = 1440) {
      await page.setViewportSize({
        width,
        height: width === 1440 ? 1000 : 844,
      });
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        main: document.querySelector("main")?.getBoundingClientRect().toJSON(),
        controls: [
          ...document.querySelectorAll("main button,main input,main select"),
        ].map((e) => ({
          label: e.getAttribute("aria-label") || e.textContent || e.id,
          height: e.getBoundingClientRect().height,
        })),
      }));
      expect(metrics.document).toBe(metrics.viewport);
      await page.screenshot({
        path: `tests/design-parity/reports/${id}-${width}.built.png`,
        fullPage: true,
      });
      await writeFile(
        `tests/design-parity/reports/${id}-${width}.metrics.json`,
        JSON.stringify(metrics, null, 2) + "\n",
      );
    }
    await capture("E05");
    for (const [id, groupBy] of [
      ["E06", "attendant"],
      ["E07", "pump"],
    ] as const) {
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/admin/reports/query") &&
          r.request().postDataJSON().groupBy === groupBy &&
          r.status() === 200,
      );
      await page
        .getByRole("button", { name: `By ${groupBy}`, exact: true })
        .click();
      await response;
      await expect(
        page.getByRole("table", { name: "Sales breakdown" }),
      ).toBeVisible();
      await capture(id);
    }
    await capture("E07", 390);
    await page.goto("/admin");
    await expect(page.getByRole("main")).toContainText("Launch date not set");
    await capture("B02");
    await capture("B02", 390);
  } finally {
    await f.close();
  }
});

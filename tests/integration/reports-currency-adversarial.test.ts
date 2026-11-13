import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { z } from "zod";
import {
  reportsFixture,
  config,
  historicalSale,
  memoryArtifacts,
} from "../helpers/reports-adversarial-fixture";
import {
  createReportExport,
  readReport,
} from "../../src/server/modules/reports/service";
import {
  downloadReportExport,
  prepareReportExport,
} from "../../src/server/modules/reports/exports";
import {
  reportSchema,
  reportSourceSchema,
} from "../../src/shared/contracts/reports";
import { newId } from "../../src/server/lib/ids";

let f: Awaited<ReturnType<typeof reportsFixture>>;
describe("M4 prospective currency projections on real PostgreSQL", () => {
  beforeAll(async () => {
    f = await reportsFixture();
  }, 30000);
  afterAll(async () => {
    await f?.close();
  });

  it("I-44 preserves independent included and excluded currency totals through sources and frozen XLSX without enabling live USD capture", async () => {
    // Production is intentionally NGN-only. Prove that guard before widening
    // only this disposable fixture schema to exercise M4's prospective read
    // contract. This does not claim production accepts USD purchases.
    await expect(
      historicalSale(f.pool, { currency: "USD" }),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "ck_product_price_version_currency",
    });
    expect(
      (await f.pool.query("SELECT count(*)::text n FROM purchase")).rows[0].n,
    ).toBe("0");
    if (!/^cards_adversarial_[a-f0-9]+$/.test(f.schema))
      throw new Error("Disposable fixture schema required");
    for (const table of [
      "product_price_version",
      "purchase",
      "purchase_revision",
    ]) {
      const constraint = `ck_${table}_currency`;
      const definition = (
        await f.pool.query(
          "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2",
          [table, constraint],
        )
      ).rows[0]?.definition as string;
      expect(definition).toContain("'NGN'");
      await f.pool.query(
        `ALTER TABLE ${table} DROP CONSTRAINT ${constraint}, ADD CONSTRAINT ${constraint} CHECK(currency ~ '^[A-Z]{3}$')`,
      );
    }
    // Currency is supplied at insertion. Every original/revision immutability,
    // acceptance, attribution, evidence and generation trigger remains enabled.
    const ngn = await historicalSale(f.pool, { amount: "9000000" });
    const usd = await historicalSale(f.pool, {
      product: "cooking_gas",
      currency: "USD",
      amount: "100",
    });
    const gasNgn = await historicalSale(f.pool, {
      product: "cooking_gas",
      amount: "200",
    });
    const heldNgn = await historicalSale(f.pool, {
      state: "held",
      amount: "300",
    });
    const heldUsd = await historicalSale(f.pool, {
      product: "cooking_gas",
      currency: "USD",
      state: "held",
      amount: "400",
    });
    const pendingUsd = await historicalSale(f.pool, {
      product: "cooking_gas",
      currency: "USD",
      state: "photo_pending",
      amount: "500",
    });
    const cancelledNgn = await historicalSale(f.pool, {
      state: "cancelled",
      amount: "600",
    });
    const report = reportSchema.parse(
      await readReport(f.pool, config, f.admin.token, "query", f.filters),
    );
    expect(report.totals).toMatchObject({
      purchases: "3",
      spend: [
        { currency: "NGN", amountKobo: "9000200" },
        { currency: "USD", amountKobo: "100" },
      ],
      litres: "9",
      kilograms: "0.0003",
    });
    expect(report.groups.items.map((g) => g.key)).toEqual([
      "cooking_gas",
      "pms",
    ]);
    expect(report.groups.items[0]!.totals.spend).toEqual([
      { currency: "NGN", amountKobo: "200" },
      { currency: "USD", amountKobo: "100" },
    ]);
    expect(report.groups.items[1]!.totals.spend).toEqual([
      { currency: "NGN", amountKobo: "9000000" },
    ]);
    expect(report.excluded).toEqual([
      {
        state: "cancelled",
        records: "1",
        spend: [{ currency: "NGN", amountKobo: "600" }],
      },
      {
        state: "held",
        records: "2",
        spend: [
          { currency: "NGN", amountKobo: "300" },
          { currency: "USD", amountKobo: "400" },
        ],
      },
      {
        state: "pending",
        records: "1",
        spend: [{ currency: "USD", amountKobo: "500" }],
      },
      { state: "ineligible", records: "0", spend: [] },
    ]);
    expect(report.daily).toHaveLength(1);
    expect(report.daily[0]!.totals).toEqual(report.totals);
    const page = z
      .object({ items: z.array(reportSourceSchema), dataVersion: z.string() })
      .parse(
        await readReport(f.pool, config, f.admin.token, "sources", {
          ...f.filters,
          expectedDataVersion: report.dataVersion,
        }),
      );
    expect(page.dataVersion).toBe(report.dataVersion);
    const expected = [
      [ngn.id, "NGN", "9000000", true, 90000],
      [usd.id, "USD", "100", true, 1],
      [gasNgn.id, "NGN", "200", true, 2],
      [heldNgn.id, "NGN", "300", false, 3],
      [heldUsd.id, "USD", "400", false, 4],
      [pendingUsd.id, "USD", "500", false, 5],
      [cancelledNgn.id, "NGN", "600", false, 6],
    ] as const;
    expect(page.items).toHaveLength(expected.length);
    for (const [purchaseId, currency, amountKobo, included] of expected)
      expect(
        page.items.find((row) => row.purchaseId === purchaseId),
      ).toMatchObject({ currency, amountKobo, included });
    const prepared = await createReportExport(f.pool, config, f.admin.token, {
      operationId: newId(),
      format: "xlsx",
      filters: f.filters,
      expectedDataVersion: report.dataVersion,
    });
    const snapshot = (
      await f.pool.query(
        "SELECT frozen_snapshot FROM report_export WHERE id=$1",
        [prepared.data.id],
      )
    ).rows[0].frozen_snapshot;
    expect(snapshot.report.totals).toEqual(report.totals);
    expect(snapshot.report.excluded).toEqual(report.excluded);
    expect(snapshot.report.groups.items).toEqual(report.groups.items);
    expect(snapshot.sources).toEqual(page.items);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /customerId|customerName|phone|provenance|photoUrl|photoKey|signature/i,
    );
    await historicalSale(f.pool, { amount: "7000000" });
    expect(
      reportSchema.parse(
        await readReport(f.pool, config, f.admin.token, "query", f.filters),
      ).dataVersion,
    ).not.toBe(report.dataVersion);
    const storage = memoryArtifacts();
    expect(
      await prepareReportExport(f.pool, { storage }, prepared.data.id),
    ).toMatchObject({ processed: true, delivered: true });
    const file = await downloadReportExport(
      f.pool,
      f.admin.token,
      prepared.data.id,
      storage,
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(file.bytes).buffer);
    const reportSheet = book.getWorksheet("Report")!,
      sourceSheet = book.getWorksheet("Source sales")!;
    const spend: unknown[][] = [],
      excluded: unknown[][] = [],
      groups: unknown[] = [];
    reportSheet.eachRow((row) => {
      if (row.getCell(1).value === "Spend")
        spend.push([row.getCell(2).value, row.getCell(3).value]);
      if (row.getCell(1).value === "Excluded spend")
        excluded.push([row.getCell(2).value, row.getCell(3).value]);
      if (row.getCell(1).value === "Group") groups.push(row.getCell(2).value);
    });
    expect(spend.slice(0, 2)).toEqual([
      ["NGN", 90002],
      ["USD", 1],
    ]);
    expect(excluded).toEqual([
      ["NGN", 6],
      ["NGN", 3],
      ["USD", 4],
      ["USD", 5],
    ]);
    expect(groups).toEqual(["cooking_gas", "pms"]);
    expect(sourceSheet.rowCount).toBe(8);
    for (const [id, currency, , included, displayAmount] of expected) {
      const row = sourceSheet
        .getRows(2, 7)!
        .find((row) => row.getCell(1).value === id)!;
      expect(row.getCell(19).value).toBe(currency);
      expect(row.getCell(18).value).toBe(displayAmount);
      expect(row.getCell(22).value).toBe(included);
    }
  });
});

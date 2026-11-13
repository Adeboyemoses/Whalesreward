import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  meterDatabase,
  meterFixture,
  meterSucceeded,
} from "../helpers/meter-fixture";
import { config } from "../helpers/cards-adversarial-fixture";
import {
  readReport,
  createReportExport,
} from "../../src/server/modules/reports/service";
import {
  prepareReportExport,
  downloadReportExport,
} from "../../src/server/modules/reports/exports";
import {
  reportSchema,
  reportSourceSchema,
} from "../../src/shared/contracts/reports";
import { memoryArtifacts } from "../helpers/reports-adversarial-fixture";
import { newId } from "../../src/server/lib/ids";
import ExcelJS from "exceljs";
import { z } from "zod";
let db: Awaited<ReturnType<typeof meterDatabase>>;
describe("WO-core-13 P-26 accepted meter contributions", () => {
  beforeAll(async () => {
    db = await meterDatabase();
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });
  it("I-29 actual meter decision is aggregated and exported as stored instead of recalculating its pair", async () => {
    const x = await meterFixture(db, {
      rate: "110000",
      quantity: "11.223",
      amountKobo: "1234567",
    });
    await meterSucceeded(x);
    const filters = {
      from: "2026-11-10",
      to: "2026-11-10",
      product: null,
      groupBy: "product" as const,
    };
    const report = reportSchema.parse(
      await readReport(db.pool, config, x.token, "query", filters),
    );
    expect(report.totals).toMatchObject({
      purchases: "1",
      spend: [{ currency: "NGN", amountKobo: "1234567" }],
      litres: "11.223",
      kilograms: "0",
    });
    const page = z.object({ items: z.array(reportSourceSchema) }).parse(
      await readReport(db.pool, config, x.token, "sources", {
        ...filters,
        expectedDataVersion: report.dataVersion,
      }),
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      purchaseId: x.sale.purchaseId,
      amountKobo: "1234567",
      quantity: "11.223",
      included: true,
      valuesSource: "accepted_revision",
    });
    expect(JSON.stringify(page)).not.toMatch(
      /meter|profile|provenance|transcription|photo|signature|referenceIds/i,
    );
    const out = await createReportExport(db.pool, config, x.token, {
        operationId: newId(),
        format: "xlsx",
        filters,
        expectedDataVersion: report.dataVersion,
      }),
      storage = memoryArtifacts();
    await prepareReportExport(db.pool, { storage }, out.data.id);
    const file = await downloadReportExport(
        db.pool,
        x.token,
        out.data.id,
        storage,
      ),
      book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(file.bytes).buffer);
    const row = book.getWorksheet("Source sales")!.getRow(2);
    expect(row.values).toContain(11.223);
    // Depending on the column's declared currency basis, exact money is kobo or decimal naira.
    expect(row.values).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(JSON.stringify(row.values)).toContain("12345.67");
    expect(JSON.stringify(row.values)).not.toMatch(
      /meter-reconciliation|fictional\/final|Inspected retained/,
    );
  });
});

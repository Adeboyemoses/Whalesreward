import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { z } from "zod";
import {
  reportsFixture,
  config,
  historicalSale,
  seedHistorical,
  memoryArtifacts,
  gate,
} from "../helpers/reports-adversarial-fixture";
import {
  readReport,
  createReportExport,
  readReportExport,
} from "../../src/server/modules/reports/service";
import {
  prepareReportExport,
  downloadReportExport,
} from "../../src/server/modules/reports/exports";
import { writeReportAudit } from "../../src/server/modules/audit/write-reports";
import { m4ReportAuditSchema } from "../../src/shared/contracts/audit";
import { readAudit } from "../../src/server/modules/audit/service";
import {
  reportSchema,
  reportExportSchema,
} from "../../src/shared/contracts/reports";
import { newId } from "../../src/server/lib/ids";
let f: Awaited<ReturnType<typeof reportsFixture>>;
const query = async () =>
  reportSchema.parse(
    await readReport(f.pool, config, f.admin.token, "query", f.filters),
  );
async function request(format: "pdf" | "xlsx" = "xlsx") {
  const report = await query();
  const input = {
    operationId: newId(),
    format,
    filters: f.filters,
    expectedDataVersion: report.dataVersion,
  };
  const result = await createReportExport(f.pool, config, f.admin.token, input);
  return {
    input,
    result,
    report,
    exported: reportExportSchema.parse(result.data),
  };
}
const status = async (id: string) =>
  reportExportSchema.parse(await readReportExport(f.pool, f.admin.token, id));
async function audit(id: string) {
  return z
    .object({
      items: z.array(
        z
          .object({
            id: z.string(),
            schemaVersion: z.number(),
            action: z.string(),
            actor: z.unknown(),
            changes: z.array(
              z.object({
                field: z.string(),
                before: z.unknown(),
                after: z.unknown(),
              }),
            ),
          })
          .passthrough(),
      ),
    })
    .parse(
      await readAudit(f.pool, config, f.admin.token, "search", {
        targetId: id,
        area: "reports",
      }),
    ).items;
}
async function revoke() {
  await f.pool.query(
    "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='reportExport'",
    [f.admin.roleId],
  );
}
describe("WO-core-13 frozen report export adversaries", () => {
  beforeEach(async () => {
    f = await reportsFixture();
  }, 30000);
  afterEach(async () => {
    await f?.close();
  });
  it("I-41 one immutable request and terminal audit survive replay and source changes", async () => {
    const original = await historicalSale(f.pool, { amount: "1234567" });
    const { input, exported, report } = await request();
    await historicalSale(f.pool, { amount: "7654321" });
    expect((await query()).dataVersion).not.toBe(report.dataVersion);
    expect(
      await createReportExport(f.pool, config, f.admin.token, input),
    ).toMatchObject({ replayed: true, data: exported });
    await expect(
      createReportExport(f.pool, config, f.admin.token, {
        ...input,
        format: "pdf",
      }),
    ).rejects.toMatchObject({ code: "operation_conflict", status: 409 });
    await expect(
      createReportExport(f.pool, config, f.admin.token, {
        ...input,
        operationId: newId(),
      }),
    ).rejects.toMatchObject({ code: "read_view_stale", status: 409 });
    const storage = memoryArtifacts();
    expect(
      await prepareReportExport(f.pool, { storage }, exported.id),
    ).toMatchObject({ processed: true, delivered: true });
    expect(
      await prepareReportExport(f.pool, { storage }, exported.id),
    ).toMatchObject({ processed: false });
    const ready = await status(exported.id);
    expect(ready).toMatchObject({
      state: "ready",
      sourceDataVersion: report.dataVersion,
      failureCode: null,
    });
    expect(Date.parse(ready.expiresAt!) - Date.parse(ready.preparedAt!)).toBe(
      86400000,
    );
    const file = await downloadReportExport(
      f.pool,
      f.admin.token,
      exported.id,
      storage,
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(file.bytes).buffer);
    const rows = book.getWorksheet("Source sales")!;
    expect(rows.rowCount).toBe(2);
    expect(JSON.stringify(rows.getRow(2).values)).toContain(original.id);
    expect(JSON.stringify(rows.getRow(2).values)).not.toContain("7654321");
    const events = await audit(exported.id);
    expect(events.map((x) => x.action).sort()).toEqual([
      "report_export_prepared",
      "report_export_requested",
    ]);
    expect(events.every((x) => x.schemaVersion === 2)).toBe(true);
    expect(
      events.find((x) => x.action === "report_export_prepared")?.actor,
    ).toMatchObject({ kind: "system", service: "export" });
    expect(
      events.every((x) =>
        x.changes.some(
          (c) => c.field === "creatorAdminId" && c.after === f.admin.adminId,
        ),
      ),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(
      /phone|photo|provenance|fictional\/final|object_key|signature/i,
    );
    expect(
      await createReportExport(f.pool, config, f.admin.token, input),
    ).toMatchObject({ replayed: true, data: { state: "pending" } });
    expect(await audit(exported.id)).toHaveLength(2);
  });
  it("export ceiling rejects 100001 real source rows atomically without truncation", async () => {
    const first = await historicalSale(f.pool, {
      state: "received",
      amount: "1",
    });
    const before = await query();
    await seedHistorical(
      f.pool,
      "purchase",
      `INSERT INTO purchase SELECT copy.* FROM purchase p CROSS JOIN generate_series(1,100000) AS g(n) CROSS JOIN LATERAL jsonb_populate_record(NULL::purchase,to_jsonb(p)||jsonb_build_object('id',('019a7000-0000-7000-8000-'||lpad(g.n::text,12,'0'))::uuid,'operation_id',('019a7000-0001-7000-8000-'||lpad(g.n::text,12,'0'))::uuid,'sale_code','LIMIT-'||g.n)) AS copy WHERE p.id=$1`,
      [first.id],
    );
    expect(
      (await f.pool.query("SELECT count(*)::text n FROM purchase")).rows[0].n,
    ).toBe("100001");
    await expect(
      createReportExport(f.pool, config, f.admin.token, {
        operationId: newId(),
        format: "pdf",
        filters: f.filters,
        expectedDataVersion: before.dataVersion,
      }),
    ).rejects.toMatchObject({ code: "export_too_large", status: 422 });
    expect(
      (await f.pool.query("SELECT count(*)::text n FROM report_export")).rows[0]
        .n,
    ).toBe("0");
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::text n FROM audit_event WHERE action='report_export_requested'",
        )
      ).rows[0].n,
    ).toBe("0");
  }, 60000);
  it("I-07 both status and file are creator-only even for another equally privileged administrator", async () => {
    const { exported } = await request("pdf");
    const storage = memoryArtifacts();
    await prepareReportExport(f.pool, { storage }, exported.id);
    const other = await f.actor(["reports", "reportExport"]);
    await expect(
      readReportExport(f.pool, other.token, exported.id),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      downloadReportExport(f.pool, other.token, exported.id, storage),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    const viewer = await f.actor(["reports"]);
    await expect(
      createReportExport(f.pool, config, viewer.token, {
        operationId: newId(),
        format: "pdf",
        filters: f.filters,
        expectedDataVersion: (await query()).dataVersion,
      }),
    ).rejects.toMatchObject({ code: "permission_denied", status: 403 });
  });
  it("I-09 revoked creator cannot prepare or publish and terminal failure is audited once", async () => {
    const { exported } = await request();
    const storage = memoryArtifacts();
    await revoke();
    await prepareReportExport(f.pool, { storage }, exported.id);
    expect(storage.objects.size).toBe(0);
    expect(
      (
        await f.pool.query("SELECT status FROM report_export WHERE id=$1", [
          exported.id,
        ])
      ).rows[0].status,
    ).toBe("failed");
    expect(
      await prepareReportExport(f.pool, { storage }, exported.id),
    ).toMatchObject({ processed: false });
    const events = await audit(exported.id);
    expect(
      events.filter((x) => x.action === "report_export_failed"),
    ).toHaveLength(1);
    expect(
      events.find((x) => x.action === "report_export_failed")?.actor,
    ).toMatchObject({ kind: "system", service: "export" });
  });
  it("I-09 storage upload holds no security lock and revocation during upload prevents publication", async () => {
    const { exported } = await request("pdf"),
      entered = gate(),
      release = gate(),
      storage = memoryArtifacts();
    const running = prepareReportExport(
      f.pool,
      {
        storage: {
          ...storage,
          write: async (key, bytes, type, signal) => {
            entered.release();
            await release.promise;
            await storage.write(key, bytes, type, signal);
          },
        },
      },
      exported.id,
    );
    await entered.promise;
    const db = await f.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL lock_timeout='500ms'");
      await db.query("SELECT id FROM security_state WHERE id=true FOR UPDATE");
      await db.query(
        "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='reportExport'",
        [f.admin.roleId],
      );
      await db.query("COMMIT");
    } finally {
      await db.query("ROLLBACK");
      db.release();
      release.release();
    }
    expect(await running).toMatchObject({ delivered: false });
    expect(
      (
        await f.pool.query(
          "SELECT status,object_key FROM report_export WHERE id=$1",
          [exported.id],
        )
      ).rows[0],
    ).toMatchObject({ object_key: null });
    expect(
      (await audit(exported.id)).filter(
        (x) => x.action === "report_export_prepared",
      ),
    ).toHaveLength(0);
  });
  it("I-52 hung storage is bounded while unrelated authorized reads remain responsive", async () => {
    const { exported } = await request("pdf"),
      entered = gate();
    const start = Date.now();
    const running = prepareReportExport(
      f.pool,
      {
        storage: {
          ...memoryArtifacts(),
          write: async () => {
            entered.release();
            await new Promise<void>(() => {});
          },
        },
      },
      exported.id,
    );
    await entered.promise;
    const db = await f.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SET LOCAL lock_timeout='500ms'");
      await db.query("SELECT id FROM security_state WHERE id=true FOR UPDATE");
      await db.query("COMMIT");
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
    expect((await query()).totals.purchases).toBe("0");
    expect(await running).toMatchObject({ processed: true, delivered: false });
    expect(Date.now() - start).toBeLessThan(8000);
    expect(await status(exported.id)).toMatchObject({
      state: "pending",
      failureCode: null,
    });
  }, 15000);
  it("I-41 version-2 report audit validates fields at persistence and safely projects malformed historical payloads", async () => {
    const { exported } = await request();
    const entry = (await audit(exported.id)).find(
      (x) => x.action === "report_export_requested",
    )!;
    const original = m4ReportAuditSchema.parse(
      await readAudit(f.pool, config, f.admin.token, "detail", {}, entry.id),
    );
    const db = await f.pool.connect();
    try {
      for (const changes of [
        original.changes.slice(1),
        [
          ...original.changes,
          {
            field: "privatePath",
            before: null,
            after: "private/report-secret",
          },
        ],
        original.changes.map((c) =>
          c.field === "sourceDataVersion" ? { ...c, after: 1 } : c,
        ),
      ]) {
        const invalid = Object.assign({}, original, {
          id: newId(),
          changes,
        }) as Parameters<typeof writeReportAudit>[1];
        await expect(writeReportAudit(db, invalid)).rejects.toMatchObject({
          name: "ZodError",
        });
      }
    } finally {
      db.release();
    }
    expect(await audit(exported.id)).toHaveLength(1);
    await seedHistorical(
      f.pool,
      "audit_event",
      "UPDATE audit_event SET changes=$2::jsonb WHERE id=$1",
      [
        entry.id,
        JSON.stringify([
          {
            field: "privatePath",
            before: null,
            after: "private/report-secret",
          },
        ]),
      ],
    );
    const projected = await readAudit(
      f.pool,
      config,
      f.admin.token,
      "detail",
      {},
      entry.id,
    );
    expect(projected).toMatchObject({ schemaVersion: 0 });
    expect(JSON.stringify(projected)).not.toContain("private/report-secret");
  });
  it("I-09 stream start rechecks authority after artifact I/O and leaves bytes private", async () => {
    const { exported } = await request("pdf"),
      storage = memoryArtifacts(),
      entered = gate(),
      release = gate();
    await prepareReportExport(f.pool, { storage }, exported.id);
    const running = downloadReportExport(f.pool, f.admin.token, exported.id, {
      ...storage,
      read: async (key, max, signal) => {
        entered.release();
        await release.promise;
        return storage.read(key, max, signal);
      },
    });
    const failure = expect(running).rejects.toMatchObject({
      code: "permission_denied",
      status: 403,
    });
    await entered.promise;
    await revoke();
    release.release();
    await failure;
    expect((await audit(exported.id)).map((x) => x.action).sort()).toEqual([
      "report_export_prepared",
      "report_export_requested",
    ]);
  });
  it("I-52 expired leases fence a slow renderer and only the new worker can publish", async () => {
    const { exported } = await request("pdf"),
      storage = memoryArtifacts(),
      entered = gate(),
      release = gate();
    const first = prepareReportExport(
      f.pool,
      {
        storage,
        render: async () => {
          entered.release();
          await release.promise;
          return {
            bytes: Buffer.from("old fictional artifact"),
            contentType: "application/pdf",
          };
        },
      },
      exported.id,
    );
    await entered.promise;
    await f.pool.query(
      "UPDATE report_export SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [exported.id],
    );
    expect(
      await prepareReportExport(f.pool, { storage }, exported.id),
    ).toMatchObject({ delivered: true });
    release.release();
    expect(await first).toMatchObject({ delivered: false });
    const file = await downloadReportExport(
      f.pool,
      f.admin.token,
      exported.id,
      storage,
    );
    expect(Buffer.from(file.bytes).subarray(0, 4).toString()).toBe("%PDF");
    expect(
      (await audit(exported.id)).filter(
        (x) => x.action === "report_export_prepared",
      ),
    ).toHaveLength(1);
  });
  it("failed render exhaustion is terminal with 409 export_failed and replay never restarts it", async () => {
    const { exported, input } = await request(),
      storage = memoryArtifacts();
    await f.pool.query("UPDATE report_export SET attempts=3 WHERE id=$1", [
      exported.id,
    ]);
    await prepareReportExport(f.pool, { storage }, exported.id);
    expect(await status(exported.id)).toMatchObject({
      state: "failed",
      failureCode: "preparation_failed",
    });
    await expect(
      downloadReportExport(f.pool, f.admin.token, exported.id, storage),
    ).rejects.toMatchObject({ code: "export_failed", status: 409 });
    await createReportExport(f.pool, config, f.admin.token, input);
    expect(
      await prepareReportExport(f.pool, { storage }, exported.id),
    ).toMatchObject({ processed: false });
    expect(
      (await audit(exported.id)).filter(
        (x) => x.action === "report_export_failed",
      ),
    ).toHaveLength(1);
  });
  it("24-hour expiry and corrupt stored bytes deny downloads without deleting source evidence", async () => {
    await historicalSale(f.pool, {});
    const { exported } = await request("pdf"),
      storage = memoryArtifacts();
    await expect(
      downloadReportExport(f.pool, f.admin.token, exported.id, storage),
    ).rejects.toMatchObject({ code: "export_not_ready", status: 409 });
    await prepareReportExport(f.pool, { storage }, exported.id);
    const key = [...storage.objects.keys()][0]!;
    storage.objects.set(key, Buffer.from("tampered"));
    await expect(
      downloadReportExport(f.pool, f.admin.token, exported.id, storage),
    ).rejects.toMatchObject({ code: "export_failed", status: 409 });
    await f.pool.query(
      "UPDATE report_export SET prepared_at=statement_timestamp()-interval '25 hours',expires_at=statement_timestamp()-interval '1 hour' WHERE id=$1",
      [exported.id],
    );
    expect(await status(exported.id)).toMatchObject({ state: "expired" });
    await expect(
      downloadReportExport(f.pool, f.admin.token, exported.id, storage),
    ).rejects.toMatchObject({ code: "export_expired", status: 410 });
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::text n FROM photo_asset WHERE state='validated'",
        )
      ).rows[0].n,
    ).toBe("1");
  });
  it("exact XLSX refuses unsafe precision, includes exclusions and never executes formula-like labels", async () => {
    const safe = await historicalSale(f.pool, { amount: "1234567" });
    await historicalSale(f.pool, { state: "cancelled", amount: "500" });
    await seedHistorical(
      f.pool,
      "purchase",
      "UPDATE purchase SET seller_name='=HYPERLINK(\"https://example.test\",\"unsafe\")',seller_username='+SUM(1,1)' WHERE id=$1",
      [safe.id],
    );
    const { exported } = await request(),
      storage = memoryArtifacts();
    await prepareReportExport(f.pool, { storage }, exported.id);
    const file = await downloadReportExport(
        f.pool,
        f.admin.token,
        exported.id,
        storage,
      ),
      book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(file.bytes).buffer);
    expect(book.worksheets.map((s) => s.name)).toEqual([
      "Report",
      "Source sales",
    ]);
    const sheet = book.getWorksheet("Source sales")!;
    expect(sheet.rowCount).toBe(3);
    expect(JSON.stringify(sheet.getRow(1).values)).toMatch(
      /Included in totals/i,
    );
    let found = false;
    for (const ws of book.worksheets)
      ws.eachRow((row) =>
        row.eachCell((cell) => {
          expect(cell.type).not.toBe(ExcelJS.ValueType.Formula);
          if (String(cell.value).includes("HYPERLINK")) {
            found = true;
            expect(cell.type).toBe(ExcelJS.ValueType.String);
          }
        }),
      );
    expect(found).toBe(true);
    await historicalSale(f.pool, { amount: "9007199254740993" });
    const unsafe = await request();
    await prepareReportExport(f.pool, { storage }, unsafe.exported.id);
    expect(await status(unsafe.exported.id)).toMatchObject({
      state: "failed",
      failureCode: "precision_not_representable",
    });
    await expect(
      downloadReportExport(f.pool, f.admin.token, unsafe.exported.id, storage),
    ).rejects.toMatchObject({ code: "export_failed", status: 409 });
    const pdf = await request("pdf");
    await prepareReportExport(f.pool, { storage }, pdf.exported.id);
    expect(await status(pdf.exported.id)).toMatchObject({ state: "ready" });
  });
});

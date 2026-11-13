import {
  readSettings,
  reviewSettings,
  confirmSettings,
} from "../../src/server/modules/settings/service";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  reportsFixture,
  config,
  fixtureId,
  historicalSale,
  seedHistorical,
  flagPair,
  lateRequest,
} from "../helpers/reports-adversarial-fixture";
import { readReport } from "../../src/server/modules/reports/service";
import { readOverview } from "../../src/server/modules/overview/service";
import { readSales } from "../../src/server/modules/sales/service";
import { customerRead } from "../../src/server/modules/customers/service";
import {
  reportSchema,
  reportSourceSchema,
} from "../../src/shared/contracts/reports";
import { newId } from "../../src/server/lib/ids";
const sourcesSchema = z.object({
  items: z.array(reportSourceSchema),
  nextCursor: z.string().nullable(),
  dataVersion: z.string(),
  asOf: z.string(),
});
let f: Awaited<ReturnType<typeof reportsFixture>>;
const query = async (patch: Record<string, unknown> = {}) =>
  reportSchema.parse(
    await readReport(f.pool, config, f.admin.token, "query", {
      ...f.filters,
      ...patch,
    }),
  );
const sources = async (
  dataVersion: string,
  patch: Record<string, unknown> = {},
) =>
  sourcesSchema.parse(
    await readReport(f.pool, config, f.admin.token, "sources", {
      ...f.filters,
      expectedDataVersion: dataVersion,
      ...patch,
    }),
  );
describe("WO-core-13 operational reporting adversaries", () => {
  beforeEach(async () => {
    f = await reportsFixture();
  }, 30000);
  afterEach(async () => {
    await f?.close();
  });
  it("I-42 one accepted predicate separates currencies and units, retains flags and matches customer totals", async () => {
    const accepted = await historicalSale(f.pool, {
      amount: "1234567",
      acceptedAmount: "2000000",
      lateProposal: true,
    });
    const gas = await historicalSale(f.pool, {
      product: "cooking_gas",
      amount: "3000000",
    });
    await historicalSale(f.pool, { state: "held", amount: "4000000" });
    await historicalSale(f.pool, { state: "photo_pending", amount: "5000000" });
    await historicalSale(f.pool, { state: "cancelled", amount: "6000000" });
    await flagPair(f.pool, accepted.id, gas.id);
    await lateRequest(f.pool, accepted.id);
    const report = await query();
    expect(report.totals).toMatchObject({
      purchases: "2",
      spend: [{ currency: "NGN", amountKobo: "5000000" }],
      litres: "2",
      kilograms: "3",
    });
    expect(report.excluded).toEqual([
      {
        state: "cancelled",
        records: "1",
        spend: [{ currency: "NGN", amountKobo: "6000000" }],
      },
      {
        state: "held",
        records: "1",
        spend: [{ currency: "NGN", amountKobo: "4000000" }],
      },
      {
        state: "pending",
        records: "1",
        spend: [{ currency: "NGN", amountKobo: "5000000" }],
      },
      { state: "ineligible", records: "0", spend: [] },
    ]);
    const page = await sources(report.dataVersion);
    expect(page.items.find((x) => x.purchaseId === accepted.id)).toMatchObject({
      amountKobo: "2000000",
      quantity: "2",
      included: true,
      duplicateFlag: true,
      correctionPending: true,
      valuesSource: "accepted_revision",
    });
    expect(page.items.find((x) => x.purchaseId === gas.id)).toMatchObject({
      included: true,
      duplicateFlag: true,
      unit: "kilogram",
    });
    expect(
      await customerRead(
        f.pool,
        config,
        f.admin.token,
        "profile",
        {},
        fixtureId(26),
      ),
    ).toMatchObject({
      recordedSpendKobo: "5000000",
      completedPurchaseCount: "2",
    });
    expect(JSON.stringify(page)).not.toMatch(
      /phone|customerId|customerName|provenance|photoUrl|photoKey|signature|recoveryExecutor/i,
    );
  });
  it("I-42 exclusion precedence is cancelled, held or policy-blocked, incomplete, then ineligible", async () => {
    const cancelled = await historicalSale(f.pool, {
      state: "cancelled",
      amount: "1000000",
    });
    const incomplete = await historicalSale(f.pool, {
      state: "received",
      amount: "2000000",
    });
    const invalid = await historicalSale(f.pool, { amount: "3000000" });
    for (const id of [cancelled.id, incomplete.id])
      await f.pool.query(
        "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_time_unresolved','fictional',clock_timestamp(),1)",
        [newId(), id],
      );
    await seedHistorical(
      f.pool,
      "purchase",
      "UPDATE purchase SET customer_id=NULL WHERE id=$1",
      [invalid.id],
    );
    const report = await query(),
      page = await sources(report.dataVersion);
    expect(
      page.items.find((x) => x.purchaseId === cancelled.id)?.exclusion,
    ).toBe("cancelled");
    expect(
      page.items.find((x) => x.purchaseId === incomplete.id)?.exclusion,
    ).toBe("held");
    expect(page.items.find((x) => x.purchaseId === invalid.id)?.exclusion).toBe(
      "ineligible",
    );
    expect(report.totals.purchases).toBe("0");
  });
  it("I-05 report groups preserve original seller and pump after offboarding and profile edits", async () => {
    const sale = await historicalSale(f.pool, {});
    const before = await query({ groupBy: "attendant" });
    await f.pool.query(
      "UPDATE auth_user SET display_name='Updated Fictional Seller',username='updated.seller',username_normalized='updated.seller' WHERE id=$1",
      [fixtureId(3)],
    );
    await f.pool.query(
      "UPDATE assignment SET effective_until=clock_timestamp() WHERE id=$1",
      [fixtureId(18)],
    );
    const after = await query({ groupBy: "attendant" });
    expect(after.groups.items).toEqual(before.groups.items);
    expect(after.groups.items[0]?.attendant).toMatchObject({
      id: fixtureId(6),
      name: "Grace Okon",
      username: "grace.okon",
    });
    const page = await sources(after.dataVersion);
    expect(page.items.find((x) => x.purchaseId === sale.id)).toMatchObject({
      attendant: {
        id: fixtureId(6),
        name: "Grace Okon",
        username: "grace.okon",
      },
      pump: { id: fixtureId(14) },
    });
  });
  it("I-44 all-time recorded purchases remain exact with no campaign", async () => {
    await historicalSale(f.pool, { amount: "9007199254740993" });
    await historicalSale(f.pool, { amount: "123" });
    const report = await query();
    expect(report.totals.spend).toEqual([
      { currency: "NGN", amountKobo: "9007199254741116" },
    ]);
    expect(report.totals.purchases).toBe("2");
    expect(
      (await f.pool.query("SELECT count(*)::text n FROM campaign")).rows[0].n,
    ).toBe("0");
  });
  it("I-29 PostgreSQL sums beyond BIGINT and JavaScript safe integers remain exact", async () => {
    await historicalSale(f.pool, { amount: "9223372036854775807" });
    await historicalSale(f.pool, { amount: "9223372036854775807" });
    const report = await query();
    expect(report.totals).toMatchObject({
      purchases: "2",
      spend: [{ currency: "NGN", amountKobo: "18446744073709551614" }],
      litres: "18446744073709.551614",
    });
    expect(
      (await sources(report.dataVersion)).items.every(
        (x) => x.amountKobo === "9223372036854775807",
      ),
    ).toBe(true);
  });
  it("inclusive Lagos sale days use accepted verified date without substituting trusted receipt", async () => {
    const first = await historicalSale(f.pool, { amount: "100" });
    const second = await historicalSale(f.pool, { amount: "200" });
    const third = await historicalSale(f.pool, { amount: "300" });
    for (const [id, at] of [
      [first.id, "2026-11-09T23:00:00.000Z"],
      [second.id, "2026-11-10T22:59:59.999Z"],
      [third.id, "2026-11-10T23:00:00.000Z"],
    ])
      await seedHistorical(
        f.pool,
        "purchase",
        "UPDATE purchase SET app_captured_at=$2 WHERE id=$1",
        [id, at],
      );
    const filters = { from: "2026-11-10", to: "2026-11-10" };
    expect((await query(filters)).totals.spend).toEqual([
      { currency: "NGN", amountKobo: "300" },
    ]);
    await seedHistorical(
      f.pool,
      "purchase_revision",
      "UPDATE purchase_revision SET verified_sale_date='2026-11-11' WHERE purchase_id=$1",
      [first.id],
    );
    const report = await query(filters),
      page = await sources(report.dataVersion, filters);
    expect(report.totals.spend).toEqual([
      { currency: "NGN", amountKobo: "200" },
    ]);
    expect(page.items.map((x) => x.purchaseId)).toEqual([second.id]);
  });
  it("all group pages keep full totals and source cursor binds filters and generation", async () => {
    await historicalSale(f.pool, { amount: "1000000" });
    await historicalSale(f.pool, { product: "diesel", amount: "2000000" });
    await historicalSale(f.pool, { product: "cooking_gas", amount: "3000000" });
    const first = await query({ limit: 1 });
    expect(first.groups.nextCursor).toBeTruthy();
    const next = await query({
      limit: 1,
      cursor: first.groups.nextCursor,
      expectedDataVersion: first.dataVersion,
    });
    expect(next.totals).toEqual(first.totals);
    expect(next.daily).toEqual(first.daily);
    expect(next.groups.items[0]?.key).not.toBe(first.groups.items[0]?.key);
    const page = await sources(first.dataVersion, { limit: 1 });
    expect(page.nextCursor).toBeTruthy();
    await expect(
      sources(first.dataVersion, {
        limit: 1,
        cursor: page.nextCursor,
        product: "pms",
      }),
    ).rejects.toBeDefined();
    await historicalSale(f.pool, { amount: "4000000" });
    await expect(
      sources(first.dataVersion, { cursor: page.nextCursor }),
    ).rejects.toMatchObject({ code: "read_view_stale", status: 409 });
    await expect(
      query({ expectedDataVersion: first.dataVersion }),
    ).rejects.toMatchObject({ code: "read_view_stale", status: 409 });
  });
  it("retention intent preserves operational generation and source-page validity", async () => {
    await historicalSale(f.pool, {});
    const before = await query(),
      administrator = await f.actor(["settings"]);
    const settings = await readSettings(
      f.pool,
      config,
      administrator.token,
      "get",
    );
    if (!("version" in settings)) throw new Error("Settings expected");
    const proposal = {
      days: 31,
      expectedVersion: settings.version,
      reason: "Record retention intent without enabling deletion",
    };
    const review = await reviewSettings(
      f.pool,
      config,
      administrator.token,
      "retention",
      proposal,
    );
    await confirmSettings(f.pool, config, administrator.token, "retention", {
      ...proposal,
      reviewDigest: review.reviewDigest,
      operationId: newId(),
    });
    const after = await query();
    expect(after.dataVersion).toBe(before.dataVersion);
    expect(after.totals).toEqual(before.totals);
    expect((await sources(before.dataVersion)).items).toHaveLength(1);
  });
  it("flag and original validation changes invalidate the report generation", async () => {
    const a = await historicalSale(f.pool, {}),
      b = await historicalSale(f.pool, {});
    let version = (await query()).dataVersion;
    await flagPair(f.pool, a.id, b.id);
    await expect(sources(version)).rejects.toMatchObject({
      code: "read_view_stale",
    });
    version = (await query()).dataVersion;
    await f.pool.query(
      "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_time_unresolved','fictional',clock_timestamp(),1)",
      [newId(), a.id],
    );
    await expect(sources(version)).rejects.toMatchObject({
      code: "read_view_stale",
    });
    expect((await query()).totals.purchases).toBe("1");
  });
  it("one PostgreSQL snapshot never exposes an uncommitted flag or a generation without its data", async () => {
    const a = await historicalSale(f.pool, {}),
      b = await historicalSale(f.pool, {});
    const before = await query(),
      writer = await f.pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query(
        "INSERT INTO duplicate_flag(id,purchase_id,other_purchase_id,reason,state,version) VALUES($1,$2,$3,'Fictional concurrent flag','open',1)",
        [newId(), ...[a.id, b.id].sort()],
      );
      const [during, page] = await Promise.all([
        query(),
        sources(before.dataVersion),
      ]);
      expect(during.dataVersion).toBe(before.dataVersion);
      expect(page.items.every((x) => !x.duplicateFlag)).toBe(true);
      await writer.query("COMMIT");
      const after = await query();
      expect(BigInt(after.dataVersion)).toBeGreaterThan(
        BigInt(before.dataVersion),
      );
      expect(
        (await sources(after.dataVersion)).items.every((x) => x.duplicateFlag),
      ).toBe(true);
      await expect(sources(before.dataVersion)).rejects.toMatchObject({
        code: "read_view_stale",
      });
    } finally {
      await writer.query("ROLLBACK");
      writer.release();
    }
  });
  it("I-07 overview permission gates match M3 status filters across all days", async () => {
    const a = await historicalSale(f.pool, { lateProposal: true }),
      b = await historicalSale(f.pool, {});
    await historicalSale(f.pool, { state: "photo_pending" });
    await lateRequest(f.pool, a.id);
    await flagPair(f.pool, a.id, b.id);
    await seedHistorical(
      f.pool,
      "purchase",
      "UPDATE purchase SET app_captured_at='2026-01-01T12:00:00Z' WHERE id=$1",
      [a.id],
    );
    const overview = await readOverview(f.pool, config, f.admin.token);
    expect(overview).toMatchObject({
      customersSinceLaunch: null,
      launchConfigured: false,
    });
    const parsed = z
      .object({
        attention: z.array(z.object({ status: z.string(), count: z.string() })),
        recentSales: z.array(z.unknown()),
        recentCustomers: z.array(z.unknown()),
        recordedToday: z.unknown(),
      })
      .parse(overview);
    for (const status of ["late_correction", "incomplete", "duplicate"]) {
      const sales = z
        .object({ summary: z.object({ records: z.string() }) })
        .parse(
          await readSales(f.pool, config, f.admin.token, "admin", "search", {
            status,
          }),
        );
      expect(parsed.attention.find((x) => x.status === status)?.count).toBe(
        sales.summary.records,
      );
    }
    expect(parsed.recordedToday).toEqual((await query()).totals);
    expect(parsed.recentSales.length).toBeLessThanOrEqual(5);
    expect(parsed.recentCustomers.length).toBeLessThanOrEqual(5);
    const limited = await f.actor(["overview"]);
    expect(await readOverview(f.pool, config, limited.token)).toMatchObject({
      attention: null,
      recentSales: null,
      recentCustomers: null,
    });
    await f.pool.query(
      "DELETE FROM role_permission WHERE role_id=$1 AND permission_code='sales'",
      [f.admin.roleId],
    );
    expect(await readOverview(f.pool, config, f.admin.token)).toMatchObject({
      attention: null,
      recentSales: null,
    });
    expect(JSON.stringify(overview)).not.toMatch(
      /phone|provenance|photoUrl|photoKey|signature/i,
    );
  });
  it("overview counts trusted registrations since configured launch and bounds recent sales to five", async () => {
    await seedHistorical(
      f.pool,
      "customer",
      "UPDATE customer SET registered_station_id=$1,registered_by_user_id='019a5000-0000-7000-8000-000000000003',created_at=CASE WHEN id=$2 THEN '2026-11-09T22:59:59Z'::timestamptz ELSE '2026-11-09T23:00:00Z'::timestamptz END",
      [fixtureId(8), fixtureId(26)],
    );
    await f.pool.query(
      "UPDATE station_reporting_state SET launch_at='2026-11-09T23:00:00Z' WHERE station_id=$1",
      [fixtureId(8)],
    );
    for (let i = 0; i < 6; i++)
      await historicalSale(f.pool, { amount: String(100 + i) });
    const overview = z
      .object({
        customersSinceLaunch: z.string(),
        launchConfigured: z.boolean(),
        recentSales: z.array(
          z.object({ id: z.string(), receivedAt: z.string() }),
        ),
        recentCustomers: z.array(z.object({ id: z.string() })),
      })
      .parse(await readOverview(f.pool, config, f.admin.token));
    const expected = (
      await f.pool.query(
        "SELECT count(*)::text n FROM customer WHERE registered_station_id=$1 AND created_at>='2026-11-09T23:00:00Z'",
        [fixtureId(8)],
      )
    ).rows[0].n;
    expect(overview.customersSinceLaunch).toBe(expected);
    expect(BigInt(expected)).toBeGreaterThan(0n);
    expect(overview.launchConfigured).toBe(true);
    expect(overview.recentSales).toHaveLength(5);
    expect(overview.recentCustomers.length).toBeGreaterThan(0);
    expect(overview.recentSales.map((x) => x.id)).toEqual(
      (
        await f.pool.query(
          "SELECT id FROM purchase ORDER BY server_received_at DESC,id DESC LIMIT 5",
        )
      ).rows.map((x) => x.id),
    );
  });
  it("reports permission grants neither sales evidence nor export authority", async () => {
    const viewer = await f.actor(["reports"]);
    expect(
      await readReport(f.pool, config, viewer.token, "query", f.filters),
    ).toMatchObject({ totals: { purchases: "0" } });
    const none = await f.actor([]);
    await expect(
      readReport(f.pool, config, none.token, "query", f.filters),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(
      readOverview(f.pool, config, viewer.token),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });
});

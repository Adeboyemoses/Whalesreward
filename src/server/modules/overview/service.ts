import { overviewSchema } from "../../../shared/contracts/reports";
import type pg from "pg";
import type { AdminConfig } from "../admin-access/config";
import { transaction } from "../admin-access/repo";
import { stationDate } from "../../lib/time";
import { reportAuthority, dataset, totals } from "../reports/data";
export async function readOverview(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
) {
  void config;
  return transaction(pool, async (db) => {
    const { actor, station } = await reportAuthority(db, token, "overview");
    const at = (await db.query("SELECT clock_timestamp() at")).rows[0]!
      .at as Date;
    const day = stationDate(at);
    const d = await dataset(
      db,
      station.id,
      { from: day, to: day, product: null, groupBy: "product" },
      true,
    );
    return overviewSchema.parse({
      asOf: d.asOf,
      day: stationDate(new Date(d.asOf)),
      timezone: "Africa/Lagos" as const,
      dataVersion: d.dataVersion,
      recordedToday: totals(d.sources.filter((r) => r.included)),
      customersSinceLaunch: d.launch_at ? d.customers : null,
      launchConfigured: !!d.launch_at,
      attention: actor.permissions.includes("sales")
        ? (["late_correction", "incomplete", "duplicate"] as const).map(
            (status) => ({
              status,
              count: d.attention[status],
              destination: { path: "/admin/sales", filter: { status } },
            }),
          )
        : null,
      recentSales: actor.permissions.includes("sales") ? d.recent_sales : null,
      recentCustomers: actor.permissions.includes("customers")
        ? d.recent_customers
        : null,
    });
  });
}

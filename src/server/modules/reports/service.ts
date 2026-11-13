import type pg from "pg";
import type { AdminConfig } from "../admin-access/config";
import { transaction } from "../admin-access/repo";
import { AuthError } from "../auth/errors";
import {
  reportQuerySchema,
  reportSourcesInputSchema,
  reportFilterSchema,
} from "../../../shared/contracts/reports";
import {
  reportAuthority,
  validateFilter,
  dataset,
  reportFromRows,
  page,
} from "./data";
export async function readReport(
  pool: pg.Pool,
  config: AdminConfig,
  token: string | undefined,
  action: "query" | "sources",
  input: unknown,
) {
  const p = (
      action === "query" ? reportQuerySchema : reportSourcesInputSchema
    ).parse(input),
    filters = reportFilterSchema.parse({
      from: p.from,
      to: p.to,
      product: p.product,
      groupBy: p.groupBy,
    });
  validateFilter(filters);
  return transaction(pool, async (db) => {
    const { actor, station } = await reportAuthority(db, token),
      data = await dataset(db, station.id, filters);
    if (
      p.expectedDataVersion !== undefined &&
      p.expectedDataVersion !== data.dataVersion
    )
      throw new AuthError("read_view_stale", 409);
    const scope = JSON.stringify([action, station.id, actor.admin_id, filters]);
    if (action === "sources")
      return {
        ...page(
          data.sources,
          p.limit,
          config.secret,
          scope,
          data.dataVersion,
          p.cursor,
        ),
        asOf: data.asOf,
        dataVersion: data.dataVersion,
      };
    const report = reportFromRows(
      filters,
      data.asOf,
      data.dataVersion,
      data.sources,
    );
    return {
      ...report,
      groups: page(
        report.groups.items,
        p.limit,
        config.secret,
        scope,
        data.dataVersion,
        p.cursor,
      ),
    };
  });
}
export { createReportExport, readReportExport } from "./export-service";

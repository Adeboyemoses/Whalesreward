import { z } from "zod";
import { adminRequest, AdminError, adminOperationId } from "./admin-api";
import { authId } from "../shared/contracts/auth";
import { saleDateSchema } from "../shared/contracts/sales";
import {
  dataVersionSchema,
  overviewSchema,
  reportSchema,
  reportQuerySchema,
  reportSourcesInputSchema,
  reportSourceSchema,
  reportExportSchema,
  reportExportInputSchema,
  REPORT_LIMITS,
  type Report,
  type ReportFilter,
  type ReportExport,
  type Totals,
} from "../shared/contracts/reports";
import { formatAggregateNaira } from "../shared/aggregate-display";
const sourcesSchema = z.strictObject({
  items: z.array(reportSourceSchema),
  nextCursor: z.string().nullable(),
  asOf: z.iso.datetime({ offset: true }),
  dataVersion: dataVersionSchema,
});
export type ReportSources = z.infer<typeof sourcesSchema>;
export type Overview = z.infer<typeof overviewSchema>;
export type FrozenReportExport = Readonly<
  z.infer<typeof reportExportInputSchema>
>;
const sameFilters = (a: ReportFilter, b: ReportFilter) =>
  a.from === b.from &&
  a.to === b.to &&
  a.product === b.product &&
  a.groupBy === b.groupBy;
export class AdminReportsApi {
  constructor(private request: typeof adminRequest = adminRequest) {}
  private async read<T>(path: string, schema: z.ZodType<T>, body?: unknown) {
    const result = schema.safeParse(await this.request<unknown>(path, body));
    if (!result.success) throw new AdminError("invalid_response", 200);
    return result.data;
  }
  overview() {
    return this.read("overview", overviewSchema);
  }
  async query(
    filters: ReportFilter,
    expectedDataVersion?: string,
    cursor?: string,
  ) {
    const result = await this.read(
      "reports/query",
      reportSchema,
      reportQuerySchema.parse({
        ...filters,
        expectedDataVersion,
        cursor,
        limit: 25,
      }),
    );
    if (
      !sameFilters(result.filters, filters) ||
      (expectedDataVersion !== undefined &&
        result.dataVersion !== expectedDataVersion)
    )
      throw new AdminError("invalid_response", 200);
    return result;
  }
  async sources(
    filters: ReportFilter,
    expectedDataVersion: string,
    cursor?: string,
  ) {
    const result = await this.read(
      "reports/sources",
      sourcesSchema,
      reportSourcesInputSchema.parse({
        ...filters,
        expectedDataVersion,
        cursor,
        limit: 25,
      }),
    );
    if (result.dataVersion !== expectedDataVersion)
      throw new AdminError("invalid_response", 200);
    return result;
  }
  freeze(
    report: Pick<Report, "filters" | "dataVersion">,
    format: "pdf" | "xlsx",
  ): FrozenReportExport {
    const body = reportExportInputSchema.parse({
      operationId: adminOperationId(),
      format,
      filters: report.filters,
      expectedDataVersion: report.dataVersion,
    });
    Object.freeze(body.filters);
    return Object.freeze(body);
  }
  async prepare(body: FrozenReportExport) {
    const result = await this.read("reports/exports", reportExportSchema, body);
    if (
      result.format !== body.format ||
      result.sourceDataVersion !== body.expectedDataVersion ||
      !sameFilters(result.filters, body.filters)
    )
      throw new AdminError("invalid_response", 202);
    return result;
  }
  async status(artifact: ReportExport) {
    const result = await this.read(
      `reports/exports/${encodeURIComponent(authId.parse(artifact.id))}`,
      reportExportSchema,
    );
    if (
      result.id !== artifact.id ||
      result.format !== artifact.format ||
      result.sourceDataVersion !== artifact.sourceDataVersion ||
      !sameFilters(result.filters, artifact.filters)
    )
      throw new AdminError("invalid_response", 200);
    return result;
  }
}
export function validateReportDates(from: string, to: string) {
  if (
    !saleDateSchema.safeParse(from).success ||
    !saleDateSchema.safeParse(to).success
  )
    return "Enter a valid From and To date (Africa/Lagos). Both dates are required.";
  if (from > to) return "From must be on or before To (Africa/Lagos).";
  if (
    (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) /
      86400000 +
      1 >
    REPORT_LIMITS.days
  )
    return `Choose no more than ${REPORT_LIMITS.days} inclusive days.`;
  return "";
}
export function reportMoney(spend: Totals["spend"]) {
  return spend.length
    ? spend
        .map(({ currency, amountKobo }) =>
          currency === "NGN"
            ? formatAggregateNaira(amountKobo)
            : `${currency} ${formatAggregateNaira(amountKobo).slice(1)}`,
        )
        .join(" · ")
    : "No recorded spend";
}
export function reportUncertain(error: unknown) {
  return (
    !(error instanceof AdminError) ||
    error.status === 0 ||
    error.status === 429 ||
    error.status >= 500 ||
    error.code === "invalid_response"
  );
}
export function reportMessage(error: unknown) {
  const code = error instanceof AdminError ? error.code : "";
  return (
    (
      {
        read_view_stale:
          "The report changed since you opened it. Refresh the report to see one consistent set of totals and rows.",
        date_invalid: "Enter a valid From and To date (Africa/Lagos).",
        date_range_invalid: "From must be on or before To (Africa/Lagos).",
        range_too_large: `Choose no more than ${REPORT_LIMITS.days} inclusive days.`,
        export_too_large:
          "This report is too large to export. Choose a shorter period or one product.",
        export_not_ready:
          "The export is still being prepared. Check its status again.",
        export_failed: "File preparation failed. Prepare a new export.",
        export_expired: "This file has expired. Prepare a new export.",
        aggregate_overflow:
          "This report exceeds the supported total. Choose a shorter period or one product.",
      } as Record<string, string>
    )[code] ??
    (error instanceof Error
      ? error.message
      : "The report could not be loaded. Try again.")
  );
}
const mime = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
export async function reportFile(
  artifact: ReportExport,
  live: () => boolean,
): Promise<Blob> {
  if (!live()) throw new AdminError("obsolete");
  let response: Response;
  try {
    response = await fetch(
      `/api/admin/reports/exports/${encodeURIComponent(authId.parse(artifact.id))}/file`,
      {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      },
    );
  } catch {
    throw new AdminError("network");
  }
  if (!live()) throw new AdminError("obsolete");
  if (!response.ok) {
    let code = "unavailable";
    try {
      const data = await response.json();
      if (typeof data?.error?.code === "string") code = data.error.code;
    } catch {}
    throw new AdminError(code, response.status);
  }
  if (
    response.headers.get("content-type")?.split(";")[0]?.trim() !==
    mime[artifact.format]
  )
    throw new AdminError("invalid_response");
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (
    artifact.format === "pdf"
      ? !String.fromCharCode(...bytes).startsWith("%PDF-")
      : !(
          bytes[0] === 80 &&
          bytes[1] === 75 &&
          bytes[2] === 3 &&
          bytes[3] === 4
        )
  )
    throw new AdminError("invalid_response");
  if (!live()) throw new AdminError("obsolete");
  return blob;
}

/** Exact drawing scale only. Values/labels remain the server's original kobo. */
export function reportChartCeiling(maximumKobo: string): bigint {
  // Validate using the shared aggregate boundary, including the 30-digit limit.
  formatAggregateNaira(maximumKobo);
  const maximum = BigInt(maximumKobo);
  const power = 10n ** BigInt(Math.max(0, maximumKobo.length - 1));
  const tick = ((maximum + power * 4n - 1n) / (power * 4n) || 1n) * power;
  const proposed = tick * 4n;
  return proposed.toString().length > 30 ? maximum : proposed;
}

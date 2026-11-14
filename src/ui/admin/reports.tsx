"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import { AdminError } from "@/client/admin-api";
import {
  AdminReportsApi,
  reportFile,
  reportChartCeiling,
  reportMessage,
  reportMoney,
  reportUncertain,
  validateReportDates,
  type FrozenReportExport,
  type ReportSources,
} from "@/client/admin-reports-api";
import type { AdminSession } from "@/client/admin-session";
import type {
  Report,
  ReportExport,
  ReportFilter,
  Totals,
} from "@/shared/contracts/reports";
import { formatAggregateQuantity } from "@/shared/aggregate-display";
import { adminTime, adminAction } from "@/client/admin-display";
import { Button, DataTable, KPI, Notice, TextField } from "@/ui";
import { PageHead, productNames } from "./station-common";
import { useAdminSession } from "./session";
const dateText = (day: string) =>
  adminTime(`${day}T12:00:00+01:00`).split(" · ")[0] ?? day;
const filterText = (f: ReportFilter) =>
  `${dateText(f.from)} to ${dateText(f.to)} · ${f.product ? productNames[f.product] : "All products"} · By ${f.groupBy}`;
export function SpendKPI({
  totals,
  label = "Recorded spend",
}: {
  totals: Totals;
  label?: string;
}) {
  return (
    <KPI
      label={label}
      value={totals.spend.length ? reportMoney(totals.spend) : "0.00"}
      footnote={
        totals.spend.length
          ? `${totals.purchases} completed purchases`
          : "No recorded spend · no currency groups"
      }
    />
  );
}
function DailyChart({ report }: { report: Report }) {
  // Each currency keeps its own scale. Only the server's daily series supplies bars;
  // integer ratios below are drawing geometry, never monetary totals or rounding.
  const currencies = [
    ...new Set(
      report.daily.flatMap((d) => d.totals.spend.map((s) => s.currency)),
    ),
  ];
  return (
    <section className="wr-sheet wr-report-chart">
      <h2>
        Recorded spend by day
        <span className="wr-help">Completed purchases only</span>
      </h2>
      {!report.daily.length && <p>No completed purchases in this period.</p>}
      {currencies.map((currency) => {
        const points = report.daily.flatMap((d) => {
          const spend = d.totals.spend.find((s) => s.currency === currency);
          return spend ? [{ day: d.day, spend }] : [];
        });
        const max = points.reduce(
          (m, p) =>
            BigInt(p.spend.amountKobo) > m ? BigInt(p.spend.amountKobo) : m,
          0n,
        );
        const ceiling = reportChartCeiling(max.toString());
        const width = Math.max(1040, points.length * 135 + 100);
        const step = (width - 100) / Math.max(1, points.length);
        return (
          <div
            className="wr-report-chart-scroll"
            key={currency}
            tabIndex={0}
            role="region"
            aria-label={`Daily recorded spend, ${currency}`}
          >
            <svg
              viewBox={`0 0 ${width} 300`}
              style={{ minWidth: width }}
              role="img"
              aria-label={`Recorded spend by day in ${currency}`}
            >
              {[0, 1, 2, 3, 4].map((i) => (
                <g key={i}>
                  <line
                    x1="90"
                    x2={width - 16}
                    y1={256 - i * 60}
                    y2={256 - i * 60}
                    stroke="var(--line-100)"
                  />
                  <text
                    x="80"
                    y={260 - i * 60}
                    textAnchor="end"
                    className="wr-report-axis"
                  >
                    {reportMoney([
                      {
                        currency,
                        amountKobo: ((ceiling * BigInt(i)) / 4n).toString(),
                      },
                    ])}
                  </text>
                </g>
              ))}
              {points.map((p, i) => {
                const height =
                  Number((BigInt(p.spend.amountKobo) * 240000n) / ceiling) /
                  1000;
                const x = 100 + i * step + step * 0.2;
                return (
                  <g key={p.day}>
                    <title>
                      {dateText(p.day)} · {reportMoney([p.spend])}
                    </title>
                    <rect
                      x={x}
                      y={256 - height}
                      width={step * 0.56}
                      height={height}
                      rx="4"
                      fill="var(--whale-600)"
                    />
                    <text
                      x={x + step * 0.28}
                      y={250 - height}
                      textAnchor="middle"
                      className="wr-report-value"
                    >
                      {reportMoney([p.spend])}
                    </text>
                    <text
                      x={x + step * 0.28}
                      y="276"
                      textAnchor="middle"
                      className="wr-report-axis"
                    >
                      {dateText(p.day).replace(/ \d{4}$/, "")}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })}
      <p className="wr-help">
        Days with completed purchases in the selected period. A day without a
        bar is not a claim of zero station sales.
      </p>
    </section>
  );
}
type ExportState = {
  frozen: FrozenReportExport | null;
  artifact: ReportExport | null;
  error: string;
  uncertain: boolean;
};
function ExportControls({
  report,
  canExport,
  onStale,
}: {
  report: Report | null;
  canExport: boolean;
  onStale: (e: unknown) => void;
}) {
  const { store, epoch } = useAdminSession();
  const api = useMemo(() => new AdminReportsApi(store.request), [store]);
  const [state, update] = useState<ExportState>(
    () =>
      (store.lists.get("reports:export") as ExportState | undefined) ?? {
        frozen: null,
        artifact: null,
        error: "",
        uncertain: false,
      },
  );
  const current = useRef(state),
    busyRef = useRef(false),
    alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const urls = useRef(new Set<string>());
  useLayoutEffect(() => {
    alive.current = true;
    const savedUrls = urls.current;
    return () => {
      alive.current = false;
      savedUrls.forEach((url) => URL.revokeObjectURL(url));
      savedUrls.clear();
    };
  }, []);
  const valid = () => store.getSnapshot().epoch === epoch;
  function save(next: ExportState) {
    if (!valid()) return;
    current.current = next;
    store.lists.set("reports:export", next);
    if (alive.current) update(next);
  }
  async function prepare(format: "pdf" | "xlsx", retry = false) {
    if (!canExport || busyRef.current || (!retry && !report)) return;
    const frozen = retry
      ? current.current.frozen
      : report
        ? api.freeze(report, format)
        : null;
    if (!frozen) return;
    const start: ExportState = {
      frozen,
      artifact: null,
      error: "",
      uncertain: true,
    };
    save(start);
    busyRef.current = true;
    setBusy(true);
    try {
      const artifact = await api.prepare(frozen);
      save({ ...start, artifact, uncertain: false });
    } catch (e) {
      if (!valid()) return;
      const uncertain = reportUncertain(e);
      save({
        ...start,
        error: uncertain
          ? "The preparation result is uncertain. Retry preparation with the same request before preparing another export."
          : reportMessage(e),
        uncertain,
      });
      if (e instanceof AdminError && e.code === "read_view_stale") onStale(e);
    } finally {
      busyRef.current = false;
      if (alive.current && valid()) setBusy(false);
    }
  }
  async function check() {
    const old = current.current;
    if (!old.artifact || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const artifact = await api.status(old.artifact);
      save({ ...old, artifact, error: "" });
    } catch (e) {
      save({ ...old, error: reportMessage(e) });
    } finally {
      busyRef.current = false;
      if (alive.current && valid()) setBusy(false);
    }
  }
  useEffect(() => {
    if (state.artifact?.state !== "pending" || state.error || !canExport)
      return;
    const timer = window.setTimeout(() => void check(), 3000);
    return () => window.clearTimeout(timer);
    // One bounded request at a time; errors switch to explicit status refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.artifact, state.error, canExport]);
  async function download() {
    const artifact = current.current.artifact;
    if (!artifact || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const blob = await reportFile(artifact, () => valid() && alive.current);
      if (!valid() || !alive.current) return;
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `report-${artifact.id}.${artifact.format}`;
      anchor.click();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
        urls.current.delete(url);
      }, 30000);
    } catch (e) {
      if (!valid()) return;
      if (
        e instanceof AdminError &&
        (e.status === 401 ||
          e.code === "permission_denied" ||
          e.code === "password_change_required")
      ) {
        store.clear("Your permissions changed. Sign in again.");
        return;
      }
      const next = { ...current.current, error: reportMessage(e) };
      if (
        e instanceof AdminError &&
        (e.code === "export_failed" || e.code === "export_expired")
      )
        next.artifact = {
          ...artifact,
          state: e.code === "export_failed" ? "failed" : "expired",
        };
      save(next);
    } finally {
      busyRef.current = false;
      if (alive.current && valid()) setBusy(false);
    }
  }
  if (!canExport)
    return (
      <p className="wr-help">
        Report export is unavailable with your current permissions.
      </p>
    );
  const artifact = state.artifact;
  return (
    <div className="wr-report-export">
      <div className="wr-row">
        <Button
          variant="secondary"
          disabled={!report || busy || state.uncertain}
          onClick={() => void prepare("pdf")}
        >
          <Download size={18} aria-hidden="true" />
          Export PDF
        </Button>
        <Button
          variant="secondary"
          disabled={!report || busy || state.uncertain}
          onClick={() => void prepare("xlsx")}
        >
          <Download size={18} aria-hidden="true" />
          Export Excel
        </Button>
      </div>
      {(artifact || state.error || state.uncertain) && (
        <section className="wr-report-export-status" aria-label="Report export">
          {artifact && (
            <>
              <p role="status">
                <b>{adminAction(artifact.state)}</b> ·{" "}
                {artifact.format === "pdf" ? "PDF" : "Excel"}
              </p>
              <p className="wr-help">
                {filterText(artifact.filters)} · Generation{" "}
                {artifact.sourceDataVersion} · Snapshot{" "}
                {adminTime(artifact.snapshotAt)}
              </p>
            </>
          )}
          {state.error && (
            <Notice tone="warning" role="alert">
              {state.error}
            </Notice>
          )}
          {state.uncertain && !busy && (
            <Button
              variant="secondary"
              onClick={() => void prepare(state.frozen!.format, true)}
            >
              Retry preparation
            </Button>
          )}
          {artifact?.state === "pending" && (
            <>
              <p>File preparation is pending.</p>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void check()}
              >
                Check export status
              </Button>
            </>
          )}
          {artifact?.state === "ready" && (
            <>
              <p className="wr-help">
                {artifact.expiresAt
                  ? `Expires ${adminTime(artifact.expiresAt)}`
                  : "Expiry unavailable"}
              </p>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void download()}
              >
                Download {artifact.format === "pdf" ? "PDF" : "Excel"}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void check()}
              >
                Check export status
              </Button>
            </>
          )}
          {(artifact?.state === "failed" || artifact?.state === "expired") && (
            <>
              <p>
                {artifact.state === "expired"
                  ? "This file has expired."
                  : artifact.failureCode === "precision_not_representable"
                    ? "Excel cannot represent these figures exactly. Prepare PDF to preserve every digit."
                    : "File preparation failed."}
              </p>
              <Button
                variant="secondary"
                disabled={!report || busy}
                onClick={() =>
                  void prepare(
                    artifact.failureCode === "precision_not_representable"
                      ? "pdf"
                      : artifact.format,
                  )
                }
              >
                Prepare a new export
              </Button>
            </>
          )}
          {busy && <p role="status">Working…</p>}
        </section>
      )}
    </div>
  );
}
export function ReportsPortal({ session }: { session: AdminSession }) {
  if (!session.permissions?.includes("reports"))
    return (
      <Notice tone="danger" role="alert">
        Your current permissions do not allow reports access.
      </Notice>
    );
  return <ReportsContent session={session} />;
}
function ReportsContent({ session }: { session: AdminSession }) {
  const { store, epoch } = useAdminSession();
  const api = useMemo(() => new AdminReportsApi(store.request), [store]);
  const today = () =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const [filters, setFilters] = useState<ReportFilter>(() => ({
    from: today(),
    to: today(),
    product: null,
    groupBy: "product",
  }));
  const [report, setReport] = useState<Report | null>(null),
    [sources, setSources] = useState<ReportSources | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [paging, setPaging] = useState(false),
    [serial, reload] = useState(0);
  const generation = useRef(0),
    pagingLock = useRef(false),
    alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Request-generation fence, not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
    };
  }, []);
  const valid = (id: number) =>
    alive.current &&
    generation.current === id &&
    store.getSnapshot().epoch === epoch;
  const validation = validateReportDates(filters.from, filters.to);
  function invalidate(e: unknown) {
    generation.current++;
    setReport(null);
    setSources(null);
    setError(reportMessage(e));
    setBusy(false);
    setPaging(false);
    pagingLock.current = false;
  }
  function change(next: ReportFilter) {
    generation.current++;
    setReport(null);
    setSources(null);
    setError("");
    setBusy(!validateReportDates(next.from, next.to));
    setFilters(next);
    setPaging(false);
    pagingLock.current = false;
  }
  useEffect(() => {
    const id = ++generation.current;
    if (validation) return;
    void api
      .query(filters)
      .then(
        (data) => {
          if (valid(id)) setReport(data);
        },
        (e) => {
          if (valid(id)) setError(reportMessage(e));
        },
      )
      .finally(() => {
        if (valid(id)) setBusy(false);
      });
    // Filter identity and refresh invalidate the complete view together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, filters, serial, validation]);
  async function more(kind: "groups" | "sources") {
    if (!report || pagingLock.current) return;
    const id = generation.current;
    pagingLock.current = true;
    setPaging(true);
    setError("");
    try {
      if (kind === "groups") {
        const result = await api.query(
          report.filters,
          report.dataVersion,
          report.groups.nextCursor ?? undefined,
        );
        if (valid(id))
          setReport({
            ...report,
            groups: {
              ...result.groups,
              items: [...report.groups.items, ...result.groups.items],
            },
          });
      } else {
        const result = await api.sources(
          report.filters,
          report.dataVersion,
          sources?.nextCursor ?? undefined,
        );
        if (valid(id))
          setSources({
            ...result,
            items: [...(sources?.items ?? []), ...result.items],
          });
      }
    } catch (e) {
      if (valid(id)) {
        if (e instanceof AdminError && e.code === "read_view_stale")
          invalidate(e);
        else setError(reportMessage(e));
      }
    } finally {
      if (valid(id)) {
        pagingLock.current = false;
        setPaging(false);
      }
    }
  }
  return (
    <div className="wr-report-page">
      <PageHead
        eyebrow="Station performance"
        title="Reports"
        subtitle="Completed recorded purchases · sale dates in Lagos"
      />
      <ExportControls
        report={report}
        canExport={session.permissions?.includes("reportExport") ?? false}
        onStale={invalidate}
      />
      <div className="wr-toolbar wr-report-filters">
        <TextField
          label="From"
          type="date"
          value={filters.from}
          required
          aria-invalid={!!validation}
          aria-describedby="report-date-help"
          onChange={(e) => change({ ...filters, from: e.target.value })}
        />
        <TextField
          label="To"
          type="date"
          value={filters.to}
          required
          aria-invalid={!!validation}
          aria-describedby="report-date-help"
          onChange={(e) => change({ ...filters, to: e.target.value })}
        />
        <div className="wr-field wr-narrow">
          <label className="wr-label" htmlFor="report-product">
            Product
          </label>
          <div className="wr-select-wrap">
            <select
              className="wr-input wr-select"
              id="report-product"
              value={filters.product ?? ""}
              onChange={(e) =>
                change({
                  ...filters,
                  product: (e.target.value as ReportFilter["product"]) || null,
                })
              }
            >
              <option value="">All products</option>
              {Object.entries(productNames).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
            <ChevronDown size={18} aria-hidden="true" />
          </div>
        </div>
        <p className="wr-help" id="report-date-help">
          Both dates are required and inclusive. An inverted range blocks the
          report and exports.
        </p>
      </div>
      {validation && (
        <Notice tone="danger" role="alert">
          {validation}
        </Notice>
      )}
      {error && (
        <Notice tone="warning" role="alert">
          {error}
        </Notice>
      )}
      {busy && <p role="status">Loading report…</p>}
      {!validation && (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            generation.current++;
            setReport(null);
            setSources(null);
            setBusy(true);
            setError("");
            reload((n) => n + 1);
          }}
        >
          Refresh report
        </Button>
      )}
      {report && (
        <>
          <p className="wr-help">
            As of {adminTime(report.asOf)} · Africa/Lagos · Generation{" "}
            {report.dataVersion}. Sale date uses a verified date when available,
            otherwise the reported date.
          </p>
          <div className="wr-kpis wr-report-kpis">
            <SpendKPI totals={report.totals} />
            <KPI
              label="Completed purchases"
              value={report.totals.purchases}
              footnote="Customer, details and photo received"
            />
            <KPI
              label="Liquid products"
              value={formatAggregateQuantity(report.totals.litres, "litre")}
              footnote="PMS, diesel, kerosene"
            />
            <KPI
              label="Cooking gas"
              value={formatAggregateQuantity(
                report.totals.kilograms,
                "kilogram",
              )}
              footnote="Never added to litres"
            />
          </div>
          <Notice>
            <b>Excluded from totals: </b>
            {report.excluded.length
              ? report.excluded
                  .map(
                    (e) =>
                      `${adminAction(e.state)}: ${e.records} (${reportMoney(e.spend)})`,
                  )
                  .join(" · ")
              : "None"}
            . Pending counts cover records visible to the server. Operational
            figures from loyalty records; giveaway qualification and payment
            reconciliation are separate.
          </Notice>
          <DailyChart report={report} />
        </>
      )}
      <div className="wr-toolbar wr-report-grouping">
        <h2>Sales breakdown</h2>
        <div className="wr-segments wr-cols-3" aria-label="Group by">
          {(["product", "attendant", "pump"] as const).map((groupBy) => (
            <button
              type="button"
              className="wr-segment"
              aria-pressed={filters.groupBy === groupBy}
              key={groupBy}
              onClick={() => change({ ...filters, groupBy })}
            >
              By {groupBy}
            </button>
          ))}
        </div>
        {report && (
          <span className="wr-help">{filterText(report.filters)}</span>
        )}
      </div>
      {report && (
        <>
          {report.groups.items.length ? (
            <div className="wr-report-breakdown">
              <DataTable
                caption="Sales breakdown"
                columns={[
                  { key: "group", label: adminAction(report.filters.groupBy) },
                  { key: "count", label: "Purchases" },
                  { key: "spend", label: "Recorded spend", amount: true },
                  { key: "litres", label: "Litres" },
                  { key: "kilograms", label: "Kilograms" },
                ]}
                rows={report.groups.items.map((g) => ({
                  id: g.key,
                  cells: {
                    group: g.attendant ? (
                      <>
                        <b>{g.attendant.name}</b>
                        <span className="wr-sub">
                          <span className="wr-mono">
                            {g.attendant.staffCode}
                          </span>{" "}
                          · {g.attendant.username}
                        </span>
                      </>
                    ) : g.pump ? (
                      <>
                        <b>{g.pump.name}</b>
                        <span className="wr-sub">
                          <span className="wr-mono">{g.pump.code}</span> ·{" "}
                          {productNames[g.pump.product]}
                        </span>
                      </>
                    ) : (
                      <b>{g.product ? productNames[g.product] : g.key}</b>
                    ),
                    count: g.totals.purchases,
                    spend: reportMoney(g.totals.spend),
                    litres: /^0(?:\.0+)?$/.test(g.totals.litres) ? (
                      <span className="wr-muted">none</span>
                    ) : (
                      formatAggregateQuantity(g.totals.litres, "litre")
                    ),
                    kilograms: /^0(?:\.0+)?$/.test(g.totals.kilograms) ? (
                      <span className="wr-muted">none</span>
                    ) : (
                      formatAggregateQuantity(g.totals.kilograms, "kilogram")
                    ),
                  },
                }))}
              />
            </div>
          ) : (
            <p>No completed purchases in this period.</p>
          )}
          {report.groups.nextCursor && (
            <Button
              variant="secondary"
              disabled={paging}
              onClick={() => void more("groups")}
            >
              More groups
            </Button>
          )}
          <p className="wr-help">
            Historical sales stay with their original attendant and pump. Litres
            and kilograms are never added together. Groups sort by recorded
            spend; this is operational reporting, not a prize ranking.
          </p>
          {!sources && (
            <Button
              variant="secondary"
              disabled={paging}
              onClick={() => void more("sources")}
            >
              Show source sales
            </Button>
          )}
          {sources && (
            <>
              <DataTable
                caption="Source sales"
                summary="Reported date or verified date · included and excluded records"
                columns={[
                  { key: "sale", label: "Sale" },
                  { key: "day", label: "Sale date" },
                  { key: "attendant", label: "Attendant / pump" },
                  { key: "product", label: "Product" },
                  { key: "amount", label: "Amount", amount: true },
                  { key: "quantity", label: "Quantity" },
                  { key: "state", label: "Included in totals" },
                ]}
                rows={sources.items.map((s) => ({
                  id: s.purchaseId,
                  cells: {
                    sale: <span className="wr-mono">{s.saleCode}</span>,
                    day: (
                      <>
                        {dateText(s.saleDate)}
                        <span className="wr-sub">
                          {s.dateEvidence === "verified"
                            ? "Verified date"
                            : "Reported date"}
                        </span>
                      </>
                    ),
                    attendant: (
                      <>
                        {s.attendant.name}
                        <span className="wr-sub">
                          <span className="wr-mono">
                            {s.attendant.staffCode}
                          </span>{" "}
                          · {s.attendant.username} · {s.pump.name} (
                          {s.pump.code})
                        </span>
                      </>
                    ),
                    product: productNames[s.product],
                    amount: reportMoney([
                      { currency: s.currency, amountKobo: s.amountKobo },
                    ]),
                    quantity: formatAggregateQuantity(s.quantity, s.unit),
                    state: (
                      <>
                        {s.included
                          ? "Yes"
                          : `No · ${adminAction(s.exclusion ?? s.state)}`}
                        <span className="wr-sub">
                          {adminAction(s.state)} ·{" "}
                          {s.valuesSource === "accepted_revision"
                            ? "Accepted values"
                            : "Original values"}
                        </span>
                        {s.duplicateFlag && (
                          <span className="wr-sub">
                            Possible duplicate · counted unless cancelled
                          </span>
                        )}
                        {s.correctionPending && (
                          <span className="wr-sub">
                            Correction pending · accepted values remain
                            effective
                          </span>
                        )}
                      </>
                    ),
                  },
                }))}
              />
              {sources.items.length === 0 && (
                <p>No source sales in this period.</p>
              )}
              {sources.nextCursor && (
                <Button
                  variant="secondary"
                  disabled={paging}
                  onClick={() => void more("sources")}
                >
                  More source rows
                </Button>
              )}
            </>
          )}
          {paging && <p role="status">Loading rows…</p>}
        </>
      )}
    </div>
  );
}

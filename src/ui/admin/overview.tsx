"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  AdminReportsApi,
  reportMessage,
  reportMoney,
  type Overview,
} from "@/client/admin-reports-api";
import type { AdminSession } from "@/client/admin-session";
import { adminTime, adminAction } from "@/client/admin-display";
import { Button, DataTable, KPI, Notice } from "@/ui";
import { PageHead } from "./station-common";
import { SaleStatus } from "./sales-common";
import { useAdminSession } from "./session";
import { SpendKPI } from "./reports";
const labels = {
  late_correction: {
    title: "Late correction",
    reason: "Admin decision required",
  },
  incomplete: {
    title: "Incomplete uploads",
    reason: "Server-visible records awaiting completion",
  },
  duplicate: { title: "Possible duplicate", reason: "Counted until cancelled" },
};
export function OverviewPortal({ session }: { session: AdminSession }) {
  if (!session.permissions?.includes("overview"))
    return (
      <Notice tone="danger" role="alert">
        Your current permissions do not allow overview access.
      </Notice>
    );
  return <OverviewContent session={session} />;
}
function OverviewContent({ session }: { session: AdminSession }) {
  const { store, epoch } = useAdminSession();
  const api = useMemo(() => new AdminReportsApi(store.request), [store]);
  const [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [serial, reload] = useState(0);
  useEffect(() => {
    let live = true;
    void api
      .overview()
      .then(
        (value) => {
          if (live && store.getSnapshot().epoch === epoch) setData(value);
        },
        (e) => {
          if (live && store.getSnapshot().epoch === epoch)
            setError(reportMessage(e));
        },
      )
      .finally(() => {
        if (live && store.getSnapshot().epoch === epoch) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [api, store, epoch, serial]);
  const sales = session.permissions?.includes("sales"),
    customers = session.permissions?.includes("customers");
  return (
    <div className="wr-overview-page">
      <PageHead
        eyebrow={session.station?.name ?? "Station"}
        title="Overview"
        subtitle={
          data
            ? `Recorded activity · ${adminTime(`${data.day}T12:00:00+01:00`).split(" · ")[0]}`
            : "Recorded activity today · Africa/Lagos"
        }
        action={
          <span className="wr-secondary">
            {session.account.name} · {session.role?.name}
          </span>
        }
      />
      {loading && <p role="status">Loading overview…</p>}
      {error && (
        <>
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
          <Button
            variant="secondary"
            onClick={() => {
              setData(null);
              setError("");
              setLoading(true);
              reload((s) => s + 1);
            }}
          >
            Refresh overview
          </Button>
        </>
      )}
      {data && (
        <>
          <div className="wr-kpis">
            <SpendKPI
              totals={data.recordedToday}
              label="Recorded spend today"
            />
            <KPI
              label="Completed purchases"
              value={data.recordedToday.purchases}
              footnote="Details and photo received"
            />
            <KPI
              label="Customers registered"
              value={
                data.launchConfigured && data.customersSinceLaunch !== null
                  ? data.customersSinceLaunch
                  : "Launch date not set"
              }
              footnote="Since launch"
            />
          </div>
          <section className="wr-section">
            <div className="wr-table-cap">
              <h2>Needs attention</h2>
              <span>Exceptions</span>
            </div>
            {sales && data.attention !== null ? (
              <>
                <div className="wr-attn">
                  {data.attention.map((item) => {
                    const label = labels[item.status];
                    const content = (
                      <>
                        <span className="wr-attn-n">{item.count}</span>
                        <span>
                          <span className="wr-attn-t">{label.title}</span>
                          <br />
                          <span className="wr-attn-s">{label.reason}</span>
                        </span>
                        <span className="wr-attn-arrow">
                          <ArrowRight aria-hidden="true" strokeWidth={1.75} />
                        </span>
                      </>
                    );
                    return item.destination ? (
                      <Link
                        key={item.status}
                        href={`${item.destination.path}?status=${encodeURIComponent(item.destination.filter.status)}`}
                      >
                        {content}
                      </Link>
                    ) : (
                      <div
                        className="wr-overview-unavailable"
                        key={item.status}
                      >
                        {content}
                        <p>Sales navigation is unavailable.</p>
                      </div>
                    );
                  })}
                </div>
                <p className="wr-help">
                  Incomplete counts cover only records visible to the server.
                  One sale may appear in more than one card.
                </p>
              </>
            ) : (
              <p>
                Sales attention is unavailable with your current permissions.
              </p>
            )}
          </section>
          <div className="wr-two-col wr-overview-recent">
            <section>
              {sales && data.recentSales !== null ? (
                <>
                  <DataTable
                    caption="Recent sales"
                    summary="Latest 5"
                    columns={[
                      { key: "customer", label: "Customer" },
                      { key: "attendant", label: "Attendant / pump" },
                      { key: "status", label: "Status" },
                      {
                        key: "amount",
                        label: "Amount",
                        amount: true,
                        align: "right",
                      },
                    ]}
                    rows={data.recentSales.map((s) => ({
                      id: s.id,
                      cells: {
                        customer: (
                          <>
                            <Link href={`/admin/sales/${s.id}`}>
                              <b>{s.customerName ?? "Customer unavailable"}</b>
                            </Link>
                            <span className="wr-sub">
                              <span className="wr-mono">{s.saleCode}</span> ·{" "}
                              {adminTime(s.receivedAt)}
                            </span>
                          </>
                        ),
                        attendant: (
                          <>
                            {s.attendantName}
                            <span className="wr-sub">
                              {s.username} · {s.pumpCode}
                            </span>
                          </>
                        ),
                        status: (
                          <SaleStatus
                            sale={{ ...s, credited: s.state === "credited" }}
                          />
                        ),
                        amount: reportMoney([
                          { currency: s.currency, amountKobo: s.amountKobo },
                        ]),
                      },
                    }))}
                  />
                  {data.recentSales.length === 0 && <p>No recent sales.</p>}
                  <p className="wr-help">
                    Flagged sales remain counted unless an admin cancels them.
                  </p>
                </>
              ) : (
                <>
                  <h2>Recent sales</h2>
                  <p>
                    Recent sales are unavailable with your current permissions.
                  </p>
                </>
              )}
            </section>
            <section>
              <div className="wr-table-cap">
                <h2>Recent customers</h2>
                <span>Latest 5</span>
              </div>
              {customers && data.recentCustomers !== null ? (
                <div className="wr-overview-customers">
                  {data.recentCustomers.map((c) => (
                    <Link
                      href={`/admin/customers/${c.id}`}
                      key={c.id}
                      className="wr-overview-customer"
                    >
                      <span className="wr-overview-avatar" aria-hidden="true">
                        {c.name
                          .split(/\s+/)
                          .map((word) => word[0])
                          .slice(0, 2)
                          .join("")}
                      </span>
                      <span>
                        <b>{c.name}</b>
                        <span className="wr-sub">
                          <span className="wr-mono">{c.customerCode}</span> ·{" "}
                          {adminAction(c.category)}
                        </span>
                        <span className="wr-sub">
                          Joined {adminTime(c.createdAt)}
                        </span>
                      </span>
                    </Link>
                  ))}
                  {data.recentCustomers.length === 0 && (
                    <p>No recent customers.</p>
                  )}
                </div>
              ) : (
                <p>
                  Recent customers are unavailable with your current
                  permissions.
                </p>
              )}
            </section>
          </div>
          <p className="wr-help">
            As of {adminTime(data.asOf)} · Africa/Lagos. Recorded loyalty
            purchases are operational figures, separate from giveaway
            qualification.
          </p>
        </>
      )}
    </div>
  );
}

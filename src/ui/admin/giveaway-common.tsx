"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { AdminGiveawayApi, giveawayMessage } from "@/client/admin-giveaway-api";
import type { Campaign, RankingRow } from "@/client/admin-giveaway-schemas";
import type { Totals } from "@/shared/contracts/reports";
import { categories, type Category } from "@/client/customer-admin-types";
import { reportMoney } from "@/client/admin-reports-api";
import { formatAggregateQuantity } from "@/shared/aggregate-display";
import { Button, DataTable, KeyValueList, Notice } from "@/ui";
import { useAdminSession } from "./session";
import { SelectField } from "./station-common";
import { campaignTime } from "./settings-giveaway";
export function useGiveawayApi() {
  const { store } = useAdminSession();
  return useMemo(() => new AdminGiveawayApi(store.request), [store]);
}
export function useGiveawayRead<T>(key: string, load: () => Promise<T>) {
  const { store, epoch } = useAdminSession();
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string;
    busy: boolean;
  }>({ key: "", data: null, error: "", busy: true });
  const [serial, setSerial] = useState(0);
  const viewKey = `${key}:${serial}`;
  useEffect(() => {
    let alive = true;
    void load().then(
      (data) => {
        if (alive && store.getSnapshot().epoch === epoch)
          setState({ key: viewKey, data, error: "", busy: false });
      },
      (e) => {
        if (alive && store.getSnapshot().epoch === epoch)
          setState({ key: viewKey, data: null, error: giveawayMessage(e), busy: false });
      },
    );
    return () => {
      alive = false;
    };
  }, [viewKey, load, store, epoch]);
  return {
    ...(state.key === viewKey ? state : { data: null, error: "", busy: true }),
    reload: () => setSerial((x) => x + 1),
  };
}
export function GiveawayReadState({
  busy,
  error,
  reload,
}: {
  busy: boolean;
  error: string;
  reload: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  return (
    <>
      {busy && <p role="status">Loading finalization evidence…</p>}
      {error && (
        <div ref={ref} tabIndex={-1}>
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
          <Button variant="secondary" onClick={reload}>
            Retry
          </Button>
        </div>
      )}
    </>
  );
}
export function CategoryField({
  value,
  onChange,
  disabled = false,
}: {
  value: Category | undefined;
  onChange: (v: Category | undefined) => void;
  disabled?: boolean;
}) {
  return (
    <SelectField
      label="Customer category"
      value={value ?? ""}
      onChange={(v) => onChange(v ? (v as Category) : undefined)}
      disabled={disabled}
    >
      <option value="">All customers</option>
      {Object.entries(categories).map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </SelectField>
  );
}
export function RankingTable({
  rows,
  caption,
  summary,
  sales = false,
  category,
  basis = "campaign_qualifying",
}: {
  rows: RankingRow[];
  caption: string;
  summary?: string;
  sales?: boolean;
  category?: Category;
  basis?: string;
}) {
  return (
    <>
      <DataTable
        caption={caption}
        summary={summary}
        columns={[
          { key: "rank", label: "Rank" },
          { key: "customer", label: "Customer" },
          { key: "category", label: "Fixed category" },
          { key: "purchases", label: "Transactions" },
          {
            key: "spend",
            label:
              basis === "recorded_all_time"
                ? "Recorded spend"
                : "Qualifying spend",
            amount: true,
          },
          ...(sales ? [{ key: "action", label: "Purchases" }] : []),
        ]}
        rows={rows.map((r) => ({
          id: r.customerId,
          cells: {
            rank: (
              <>
                <b className="wr-leaderboard-rank">{r.rank}</b>
                {r.sharedRank && <span className="wr-sub">Shared rank</span>}
              </>
            ),
            customer: (
              <>
                <b>{r.name}</b>
                <span className="wr-sub wr-mono">
                  {r.cardCode ?? r.customerCode}
                </span>
              </>
            ),
            category: categories[r.category],
            purchases: r.totals.purchases,
            spend: (
              <>
                {reportMoney(r.totals.spend)}
                <span className="wr-sub">
                  {formatAggregateQuantity(r.totals.litres, "litre")} ·{" "}
                  {formatAggregateQuantity(r.totals.kilograms, "kilogram")}
                </span>
              </>
            ),
            action: sales ? (
              <Link
                href={`/admin/sales?${new URLSearchParams({ customerId: r.customerId, from: "leaderboards", ...(category ? { category } : {}), basis })}`}
              >
                View purchases
              </Link>
            ) : null,
          },
        }))}
      />
      <p className="wr-help">
        Equal spend shares a rank. Transaction counts and quantities do not
        break ties. Prize allocation stays with the client.
      </p>
    </>
  );
}
export function TotalFacts({
  totals,
  customers,
}: {
  totals: Totals;
  customers: string;
}) {
  return (
    <KeyValueList
      items={[
        { label: "Customers", value: customers },
        { label: "Included purchases", value: totals.purchases },
        {
          label: "Spend",
          value: (
            <span className="wr-amount-md">{reportMoney(totals.spend)}</span>
          ),
        },
        {
          label: "Liquid quantity",
          value: formatAggregateQuantity(totals.litres, "litre"),
        },
        {
          label: "Cooking gas quantity",
          value: formatAggregateQuantity(totals.kilograms, "kilogram"),
        },
      ]}
    />
  );
}
export function TimingFacts({
  timing,
  asOf,
}: {
  timing: Campaign["timing"];
  asOf?: string;
}) {
  return (
    <>
      <KeyValueList
        items={[
          {
            label: "Launch",
            value: campaignTime(timing.launchAt, timing.timezone),
          },
          {
            label: "Eligible period start",
            value: campaignTime(timing.purchaseStart, timing.timezone),
          },
          {
            label: "Purchase cutoff",
            value: campaignTime(timing.purchaseCutoff, timing.timezone),
          },
          {
            label: "Upload grace deadline",
            value: campaignTime(timing.uploadDeadline, timing.timezone),
          },
          {
            label: "Upload grace period (hours)",
            value: timing.graceHours ?? "Not set",
          },
          { label: "Campaign timezone", value: timing.timezone },
          ...(asOf
            ? [
                {
                  label: "Server time",
                  value: campaignTime(asOf, timing.timezone),
                },
              ]
            : []),
        ]}
      />
      <p className="wr-help">
        Upload grace permits delayed uploads of eligible purchases; it does not
        extend the purchase cutoff.
      </p>
    </>
  );
}
export function Pager({
  previous,
  next,
  busy,
  onPrevious,
  onNext,
  children,
}: {
  previous: boolean;
  next: boolean;
  busy: boolean;
  onPrevious: () => void;
  onNext: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="wr-row wr-giveaway-actions">
      <Button
        variant="secondary"
        disabled={!previous || busy}
        onClick={onPrevious}
      >
        Previous
      </Button>
      <Button variant="secondary" disabled={!next || busy} onClick={onNext}>
        Next
      </Button>
      {children}
    </div>
  );
}
export function usePageCursor() {
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  return {
    cursor: pages.at(-1),
    previous: pages.length > 1,
    next: (cursor: string | null) => {
      if (cursor) setPages((p) => [...p, cursor]);
    },
    back: () => setPages((p) => (p.length > 1 ? p.slice(0, -1) : p)),
    reset: () => setPages([undefined]),
  };
}

"use client";

import { useId, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cx, type Tone } from "./shared";
import { StatusPill } from "./feedback";
import { Brand } from "./navigation";
export type KeyValue = { label: string; value: ReactNode; mono?: boolean };
export function KeyValueList({
  items,
  total,
}: {
  items: readonly KeyValue[];
  total?: ReactNode;
}) {
  return (
    <>
      <dl className="wr-kv">
        {items.map((item) => (
          <div className="wr-kv-row" key={item.label}>
            <dt>{item.label}</dt>
            <dd className={item.mono ? "wr-mono" : undefined}>{item.value}</dd>
          </div>
        ))}
      </dl>
      {total && (
        <dl className="wr-total">
          <dt>Total</dt>
          <dd>{total}</dd>
        </dl>
      )}
    </>
  );
}
export function ListRow({
  name,
  amount,
  metadata,
  status,
  tone,
  action = "View details",
  href,
}: {
  name: string;
  amount: string;
  metadata: string;
  status: string;
  tone: Tone;
  action?: string;
  href: string;
}) {
  return (
    <a className="wr-list-row" href={href}>
      <div className="wr-list-main">
        <b>{name}</b>
        <span className="wr-list-amount">{amount}</span>
      </div>
      <div className="wr-list-meta">{metadata}</div>
      <div className="wr-list-foot">
        <StatusPill tone={tone} small>
          {status}
        </StatusPill>
        <span className="wr-action">{action}</span>
      </div>
    </a>
  );
}
export function LoyaltyCard({
  name,
  code,
  category,
  customerId,
  station,
  status = "Active",
}: {
  name: string;
  code: string;
  category: string;
  customerId?: string;
  station: string;
  status?: "Active" | "Replaced" | "Retired";
}) {
  return (
    <div className="wr-loyalty-card">
      <div className="wr-loyalty-head">
        <Brand surface="" />
        <StatusPill tone={status === "Active" ? "synced" : "neutral"} small>
          {status}
        </StatusPill>
      </div>
      <div>
        <div className="wr-sub">Loyalty member</div>
        <div className="wr-code wr-accent">{code}</div>
      </div>
      <div className="wr-loyalty-foot">
        <div>
          <b>{name}</b>
          <div className="wr-sub">
            {category}
            {customerId && (
              <>
                {" · "}
                <span className="wr-mono">{customerId}</span>
              </>
            )}
          </div>
        </div>
        <div className="wr-sub">Whales Energy · {station}</div>
      </div>
    </div>
  );
}
export type TableColumn = {
  key: string;
  label: string;
  align?: "right";
  amount?: boolean;
};
export function DataTable({
  caption,
  summary,
  columns,
  rows,
}: {
  caption: string;
  summary?: string;
  columns: readonly TableColumn[];
  rows: readonly { id: string; cells: Record<string, ReactNode> }[];
}) {
  const id = useId();
  return (
    <div className="wr-section">
      <div className="wr-table-cap">
        <h2 id={id}>{caption}</h2>
        {summary && <span>{summary}</span>}
      </div>
      <div
        className="wr-table-wrap"
        role="region"
        aria-labelledby={id}
        tabIndex={0}
      >
        <table className="wr-table">
          <caption className="wr-visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  scope="col"
                  key={column.key}
                  className={column.align === "right" ? "wr-right" : undefined}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(
                      column.align === "right" && "wr-right",
                      column.amount && "wr-amount",
                    )}
                  >
                    {row.cells[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export function KPI({
  label,
  value,
  footnote,
}: {
  label: string;
  value: string;
  footnote: string;
}) {
  return (
    <div className="wr-kpi">
      <div className="wr-kpi-label">{label}</div>
      <div className="wr-kpi-value">{value}</div>
      <div className="wr-kpi-foot">{footnote}</div>
    </div>
  );
}
export function Attention({
  count,
  title,
  reason,
  href,
}: {
  count: number;
  title: string;
  reason: string;
  href: string;
}) {
  return (
    <a href={href}>
      <span className="wr-attn-n">{count}</span>
      <span>
        <span className="wr-attn-t">{title}</span>
        <br />
        <span className="wr-attn-s">{reason}</span>
      </span>
      <span className="wr-attn-arrow">
        <ArrowRight aria-hidden="true" strokeWidth={1.75} />
      </span>
    </a>
  );
}

"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdminSession } from "@/client/admin-session";
import {
  AdminAuditApi,
  auditMessage,
  auditTitle,
  auditValue,
  auditFieldLabel,
} from "@/client/admin-audit";
import {
  auditAreas,
  auditDate,
  type AuditEvent,
  type AuditChange,
  type AuditSearch,
} from "@/shared/contracts/audit";
import { AdminError } from "@/client/admin-api";
import { adminAction, adminTime } from "@/client/admin-display";
import { Button, DataTable, KeyValueList, Notice, TextField } from "@/ui";
import { PageHead, Sheet, SelectField } from "./station-common";
import { useMemory } from "./customers-common";
import { useAdminSession } from "./session";
const areas: Record<string, string> = {
  sales: "Sales",
  customers: "Customers",
  cards: "Loyalty cards",
  prices: "Product prices",
  assignments: "Pump assignments",
  access: "Admin access",
  settings: "Settings",
  recovery: "Customer recovery",
};
function useAuditApi() {
  const { store } = useAdminSession();
  return useMemo(() => new AdminAuditApi(store.request), [store]);
}
function useRead<T>(load: () => Promise<T>) {
  const [state, set] = useState<{
    data: T | null;
    error: string;
    busy: boolean;
  }>({ data: null, error: "", busy: true });
  const [serial, retry] = useState(0);
  useEffect(() => {
    let live = true;
    void (async () => {
      set({ data: null, error: "", busy: true });
      try {
        const data = await load();
        if (live) set({ data, error: "", busy: false });
      } catch (e) {
        if (live) set({ data: null, error: auditMessage(e), busy: false });
      }
    })();
    return () => {
      live = false;
    };
  }, [load, serial]);
  return { ...state, retry: () => retry((x) => x + 1) };
}
function State({
  busy,
  error,
  retry,
}: {
  busy: boolean;
  error: string;
  retry: () => void;
}) {
  return (
    <>
      {busy && <p role="status">Loading…</p>}
      {error && (
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
      )}
      {error && (
        <Button variant="secondary" onClick={retry}>
          Retry loading
        </Button>
      )}
    </>
  );
}
export function AuditPortal({
  path,
  session,
}: {
  path: string[];
  session: AdminSession;
}) {
  if (!session.permissions?.includes("audit"))
    return (
      <Notice tone="danger" role="alert">
        Your current permissions do not allow audit access.
      </Notice>
    );
  return path[1] ? <Detail key={path[1]} id={path[1]} /> : <List />;
}
type Filters = {
  query: string;
  area: string;
  actorKind: string;
  from: string;
  to: string;
  targetId: string;
};
function List() {
  const api = useAuditApi();
  const [view, setView] = useMemory<{
    filters: Filters;
    cursor?: string;
    previous: (string | undefined)[];
  }>("audit:view", {
    filters: {
      query: "",
      area: "",
      actorKind: "",
      from: "",
      to: "",
      targetId: "",
    },
    previous: [],
  });
  const { filters, cursor, previous } = view;
  const change = (field: keyof Filters, value: string) =>
    setView({
      filters: { ...filters, [field]: value },
      cursor: undefined,
      previous: [],
    });
  const load = useCallback(() => {
    if (
      (filters.from && !auditDate.safeParse(filters.from).success) ||
      (filters.to && !auditDate.safeParse(filters.to).success)
    )
      return Promise.reject(new AdminError("date_invalid", 422));
    const input = Object.fromEntries(
      Object.entries(filters)
        .filter(([, v]) => v.trim())
        .map(([k, v]) => [k, v.trim()]),
    );
    return api.search({ ...input, cursor, limit: 6 } as AuditSearch);
  }, [api, filters, cursor]);
  const result = useRead(load);
  const data = result.data;
  return (
    <>
      <PageHead
        title="Audit history"
        eyebrow="Accountability"
        subtitle="Who changed what, when, and why"
        action={<span className="wr-pill">Read-only records</span>}
      />
      <div className="wr-toolbar wr-audit-toolbar">
        <TextField
          label="Search history"
          placeholder="Name, username, customer or record ID"
          value={filters.query}
          maxLength={120}
          onChange={(e) => change("query", e.target.value)}
        />
        <SelectField
          label="Area"
          value={filters.area}
          onChange={(v) => change("area", v)}
        >
          <option value="">All areas</option>
          {auditAreas.map((a) => (
            <option key={a} value={a}>
              {areas[a]}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Performed by"
          value={filters.actorKind}
          onChange={(v) => change("actorKind", v)}
        >
          <option value="">Everyone</option>
          {["admin", "attendant", "system"].map((a) => (
            <option key={a} value={a}>
              {adminAction(a)}
            </option>
          ))}
        </SelectField>
        <TextField
          label="From"
          type="date"
          value={filters.from}
          onChange={(e) => change("from", e.target.value)}
        />
        <TextField
          label="To"
          type="date"
          value={filters.to}
          onChange={(e) => change("to", e.target.value)}
        />
        <TextField
          label="Target ID"
          placeholder="Record UUID"
          value={filters.targetId}
          onChange={(e) => change("targetId", e.target.value)}
        />
      </div>
      <p className="wr-help">Inclusive dates · Africa/Lagos (UTC+01:00)</p>
      <State {...result} />
      {data && (
        <>
          <DataTable
            caption="Recorded events"
            summary={`${data.items.length} events on this page · newest first · all times Africa/Lagos (UTC+01:00)`}
            columns={[
              { key: "time", label: "Date / time" },
              { key: "action", label: "Action" },
              { key: "target", label: "Record / customer" },
              { key: "actor", label: "Performed by" },
              { key: "view", label: "" },
            ]}
            rows={data.items.map((e) => ({
              id: e.id,
              cells: {
                time: adminTime(e.occurredAt),
                action: (
                  <>
                    <b>{auditTitle(e)}</b>
                    <span className="wr-sub">{areas[e.area]}</span>
                  </>
                ),
                target: (
                  <>
                    <b>
                      {e.target.subjectAtEvent ?? adminAction(e.target.kind)}
                    </b>
                    <span className="wr-sub wr-mono">
                      {e.target.code ?? e.target.id}
                    </span>
                  </>
                ),
                actor: (
                  <>
                    <b>{e.actor?.nameAtEvent ?? "Actor not recorded"}</b>
                    <span className="wr-sub">
                      {e.actor ? adminAction(e.actor.kind) : "Unknown"} ·{" "}
                      {e.actor && e.actor.kind !== "system"
                        ? e.actor.usernameAtEvent
                        : e.actor
                          ? "Automated action"
                          : "Not recorded"}
                    </span>
                  </>
                ),
                view: <Link href={`/admin/audit/${e.id}`}>View</Link>,
              },
            }))}
          />
          {!data.items.length && (
            <Notice>No events match these filters.</Notice>
          )}
        </>
      )}
      <div className="wr-row">
        <Button
          variant="secondary"
          disabled={!previous.length || result.busy}
          onClick={() =>
            setView({
              ...view,
              cursor: previous.at(-1),
              previous: previous.slice(0, -1),
            })
          }
        >
          Previous
        </Button>
        <span className="wr-help">Page {previous.length + 1} · 6 per page</span>
        <Button
          variant="secondary"
          disabled={!data?.nextCursor || result.busy || !!result.error}
          onClick={() => {
            if (data?.nextCursor)
              setView({
                ...view,
                cursor: data.nextCursor,
                previous: [...previous, cursor],
              });
          }}
        >
          Next
        </Button>
      </div>
      <p className="wr-help">
        Audit records cannot be edited or deleted. A later correction creates
        another event and preserves the earlier record. Phone numbers are not
        shown.
      </p>
    </>
  );
}
function Detail({ id }: { id: string }) {
  const api = useAuditApi();
  const load = useCallback(() => api.detail(id), [api, id]);
  const result = useRead(load);
  const e = result.data;
  return (
    <>
      <PageHead
        title={e ? auditTitle(e) : "Event details"}
        eyebrow="Audit history / Event details"
        subtitle={
          e ? `${e.eventCode} · ${adminTime(e.occurredAt)} · Lagos` : undefined
        }
        back={{ href: "/admin/audit", label: "Back to history" }}
      />
      <State {...result} />
      {e && <Event event={e} />}
    </>
  );
}
function Event({ event: e }: { event: AuditEvent }) {
  const actor = e.actor;
  return (
    <>
      <div className="wr-two-col">
        <Sheet
          title="Event record"
          badge={
            <span
              className={`wr-pill${actor?.kind === "system" ? " wr-offline" : ""}`}
            >
              {actor ? adminAction(actor.kind) : "Unknown actor"}
            </span>
          }
        >
          <KeyValueList
            items={[
              { label: "Event ID", value: e.eventCode, mono: true },
              { label: "Area", value: areas[e.area] },
              {
                label: "Record",
                value: e.target.code ?? e.target.id,
                mono: true,
              },
              { label: "Target ID", value: e.target.id, mono: true },
              { label: "Target kind", value: adminAction(e.target.kind) },
              {
                label: "Customer / subject",
                value: e.target.subjectAtEvent ?? "Not recorded",
              },
              {
                label: "Actor type",
                value: actor ? adminAction(actor.kind) : "Not recorded",
              },
              {
                label: "Performed by",
                value: actor?.nameAtEvent ?? "Not recorded",
              },
              {
                label: "Username",
                value:
                  actor && actor.kind !== "system"
                    ? actor.usernameAtEvent
                    : actor
                      ? "Automated action"
                      : "Not recorded",
              },
              {
                label: "Actor ID",
                value: actor
                  ? actor.kind === "system"
                    ? `SERVICE-${actor.service.toUpperCase()}`
                    : actor.code
                  : "Not recorded",
                mono: true,
              },
              {
                label: "Role at event",
                value:
                  actor && actor.kind !== "system"
                    ? (actor.roleAtEvent ?? "Not recorded")
                    : "Not applicable",
              },
              {
                label: "Recorded time",
                value: adminTime(e.occurredAt) + " · Lagos",
              },
            ]}
          />
        </Sheet>
        <div className="wr-audit-context">
          <section className="wr-sheet wr-audit-reason">
            <h2>Reason / reference</h2>
            <p>
              {e.action === "legacy_event"
                ? "older event, details not available"
                : e.reason}
            </p>
          </section>
          <Sheet title="Original seller">
            {e.originatingSeller ? (
              <>
                <b>{e.originatingSeller.name}</b>
                <p>
                  {e.originatingSeller.username} ·{" "}
                  <span className="wr-mono">
                    {e.originatingSeller.staffCode}
                  </span>
                </p>
              </>
            ) : (
              <p>Not recorded for this event.</p>
            )}
          </Sheet>
        </div>
      </div>
      {e.action !== "legacy_event" && (
        <DataTable
          caption="Recorded changes"
          summary="Previous and new values"
          columns={[
            { key: "field", label: "Field" },
            { key: "before", label: "Before" },
            { key: "after", label: "After" },
          ]}
          rows={e.changes.map((c) => ({
            id: c.field,
            cells: {
              field: <b>{auditFieldLabel(c.field)}</b>,
              before: <ChangeValue event={e} change={c} side="before" />,
              after: <ChangeValue event={e} change={c} side="after" />,
            },
          }))}
        />
      )}
      {!!e.relatedEventIds.length && (
        <Sheet title="Related events">
          <ul>
            {e.relatedEventIds.map((id) => (
              <li key={id}>
                <Link className="wr-mono" href={`/admin/audit/${id}`}>
                  {id}
                </Link>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
      <p className="wr-help">
        Audit records cannot be edited or deleted from this page. A later
        correction creates another event and preserves this record.
      </p>
    </>
  );
}

function ChangeValue({
  event,
  change,
  side,
}: {
  event: AuditEvent;
  change: AuditChange;
  side: "before" | "after";
}) {
  const value = change[side];
  const text = auditValue(event, change, side);
  const states = [
    "state",
    "batchStatus",
    "correctionState",
    "duplicateState",
    "recoveryState",
    "verificationState",
    "policyState",
  ];
  if (value === null || !states.includes(change.field)) return text;
  const tone = [
    "cancelled",
    "rejected",
    "revoked",
    "expired",
    "inactive",
  ].includes(String(value))
    ? "failed"
    : [
          "credited",
          "active",
          "accepted",
          "verified",
          "cleared",
          "submitted",
        ].includes(String(value))
      ? "synced"
      : value === "awaiting_review" || value === "held"
        ? "held"
        : "pending";
  return <span className={`wr-pill wr-sm wr-${tone}`}>{text}</span>;
}

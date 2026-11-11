"use client";
import Link from "next/link";
import { Clock } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { AdminSession } from "@/client/admin-session";
import type {
  AdminSaleDetail,
  AdminSalePage,
  FrozenDecision,
} from "@/client/admin-sales-api";
import {
  type Correction,
  type Decision,
  saleFilterSchema,
} from "@/shared/contracts/sales";
import {
  isRecoveryExecutor,
  saleMoney,
  saleQuantity,
  saleRate,
  valuePair,
  salesMessage,
} from "@/client/sales-display";
import {
  formatAggregateNaira,
  formatAggregateQuantity,
} from "@/shared/aggregate-display";
import { categories } from "@/client/customer-admin-types";
import { adminTime } from "@/client/admin-display";
import { AdminError } from "@/client/admin-api";
import {
  Button,
  DataTable,
  KeyValueList,
  Notice,
  StatusPill,
  TextField,
} from "@/ui";
import {
  PageHead,
  Sheet,
  SelectField,
  Reason,
  productNames,
  useViewGuard,
} from "./station-common";
import { useMemory } from "./customers-common";
import { useAdminSession } from "./session";
import {
  useSalesApi,
  useSalesRead,
  useSaleDetail,
  SaleStatus,
  ReadState,
  AdminSalePhoto,
  AdminSaleHistory,
} from "./sales-common";
const statusOptions = {
  all: "All records",
  completed: "Completed",
  incomplete: "Incomplete upload",
  late_correction: "Late correction",
  duplicate: "Possible duplicate",
  price_review: "Price review",
  card_review: "Card review",
  date_review: "Date review",
  cancelled: "Cancelled",
  policy_review: "Policy review",
};
const mediumNames = {
  vehicle: "Vehicle",
  keg: "Keg",
  three_wheeler: "Three-wheeler",
  bike: "Bike",
  cylinder: "Cylinder",
};
export function SalesPortal({
  path,
  session,
}: {
  path: string[];
  session: AdminSession;
}) {
  const search = useSearchParams();
  const customer = search.get("customer") ?? search.get("customerId");
  const suffix = customer ? `?customer=${encodeURIComponent(customer)}` : "";
  if (!session.permissions?.includes("sales"))
    return (
      <Notice tone="danger" role="alert">
        Your current permissions do not allow sales access.
      </Notice>
    );
  return (
    <div className="wr-sales">
      {path[1] ? (
        <SaleDetail
          key={path[1] + ":" + (path[2] ?? "")}
          id={path[1]}
          reviewing={path[2] === "late-correction"}
          suffix={suffix}
          session={session}
        />
      ) : (
        <SalesList customer={customer} session={session} />
      )}
    </div>
  );
}
function SalesList({
  customer,
  session,
}: {
  customer: string | null;
  session: AdminSession;
}) {
  const [filters, setFilters] = useMemory("sales:filters", {
    query: "",
    status: "all",
    day: "",
  });
  const [draft, setDraft] = useMemory("sales:draft", filters);
  return (
    <>
      <PageHead
        title="Sales"
        eyebrow={session.station?.name ?? "Station"}
        subtitle="Purchase records and exceptions"
      />
      {customer && (
        <Notice>
          <b>Customer filter applied</b>
          <p className="wr-mono">{customer}</p>
          <p>
            All related purchase records. This customer remains selected until
            cleared.
          </p>
          <Link className="wr-btn wr-btn-secondary" href="/admin/sales">
            Clear customer filter
          </Link>
        </Notice>
      )}
      <form
        className="wr-toolbar wr-sales-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...draft });
        }}
      >
        <TextField
          label="Search sales"
          placeholder="Customer, card, sale or attendant"
          value={draft.query}
          maxLength={120}
          onChange={(e) => setDraft({ ...draft, query: e.target.value })}
        />
        <SelectField
          label="Record status"
          value={draft.status}
          onChange={(status) => {
            setDraft({ ...draft, status });
            setFilters({ ...draft, status });
          }}
        >
          {Object.entries(statusOptions).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Day"
          type="date"
          value={draft.day}
          onChange={(e) => setDraft({ ...draft, day: e.target.value })}
        />
        <Button type="submit">Search</Button>
      </form>
      <p className="wr-help">
        Day uses the verified sale date where available; otherwise it is the
        app-reported date, not proof of capture time.
      </p>
      <SalesResults
        key={JSON.stringify([filters, customer])}
        filters={filters}
        customer={customer}
      />
    </>
  );
}
function SalesResults({
  filters,
  customer,
}: {
  filters: { query: string; status: string; day: string };
  customer: string | null;
}) {
  const api = useSalesApi();
  const [cursor, setCursor] = useMemory<string | undefined>(
    "sales:cursor:" + JSON.stringify([filters, customer]),
    undefined,
  );
  const [previous, setPrevious] = useMemory<(string | undefined)[]>(
    "sales:previous:" + JSON.stringify([filters, customer]),
    [],
  );
  const load = useCallback(async () => {
    const parsed = saleFilterSchema.safeParse({
      query: filters.query.trim() || undefined,
      status: filters.status,
      day: filters.day || undefined,
      customerId: customer ?? undefined,
      cursor,
      limit: 25,
    });
    if (!parsed.success)
      throw new Error("Check the search, customer filter and calendar day.");
    return api.search(parsed.data);
  }, [api, filters, customer, cursor]);
  const result = useSalesRead<AdminSalePage>(
      JSON.stringify([filters, customer, cursor]),
      load,
    ),
    data = result.data;
  const suffix = customer ? `?customer=${encodeURIComponent(customer)}` : "";
  return (
    <>
      <ReadState {...result} />
      {!result.busy && !result.error && data?.items.length === 0 && (
        <Notice>No sales match these filters.</Notice>
      )}
      <DataTable
        caption="Recorded purchases"
        summary={
          data
            ? `${data.summary.records} records in filtered set · ${data.summary.completed} completed · ${data.summary.spend.map((v) => formatAggregateNaira(v.amountKobo)).join(" · ") || "₦0.00"} recorded spend`
            : undefined
        }
        columns={[
          { key: "sale", label: "Sale / customer" },
          { key: "purchase", label: "Purchase", amount: true },
          { key: "attendant", label: "Attendant / pump" },
          { key: "status", label: "Status" },
          { key: "action", label: "" },
        ]}
        rows={(data?.items ?? []).map((s) => ({
          id: s.id,
          cells: {
            sale: (
              <>
                <b>{s.customer?.name ?? "Customer pending"}</b>
                <span className="wr-sub">
                  <span className="wr-mono">{s.saleCode}</span> ·{" "}
                  {adminTime(s.appCapturedAt)} (app-reported)
                </span>
              </>
            ),
            purchase: (
              <>
                {saleMoney(s.displayedValues.amountKobo)}
                <span className="wr-sub">
                  {saleQuantity(s.displayedValues)} · {productNames[s.product]}
                </span>
              </>
            ),
            attendant: (
              <>
                <b>{s.seller.name}</b>
                <span className="wr-sub">
                  {s.seller.username} · {s.pump.code}
                </span>
              </>
            ),
            status: <SaleStatus sale={s} />,
            action: <Link href={`/admin/sales/${s.id}${suffix}`}>View</Link>,
          },
        }))}
      />
      {data && (
        <p className="wr-help">
          {data.summary.quantities
            .map(
              (q) =>
                `${formatAggregateQuantity(q.quantity, q.unit)} · ${productNames[q.product]}`,
            )
            .join(" · ")}{" "}
          · Snapshot {adminTime(data.asOf)}
        </p>
      )}
      <div className="wr-row">
        <Button
          variant="secondary"
          disabled={!previous.length || result.busy}
          onClick={() => {
            setCursor(previous.at(-1));
            setPrevious(previous.slice(0, -1));
          }}
        >
          Previous
        </Button>
        <span className="wr-help">Current page · newest receipt first</span>
        <Button
          variant="secondary"
          disabled={!data?.nextCursor || result.busy}
          onClick={() => {
            if (data?.nextCursor) {
              setPrevious([...previous, cursor]);
              setCursor(data.nextCursor);
            }
          }}
        >
          Next
        </Button>
      </div>
      <p className="wr-help">
        Incomplete uploads and unresolved holds do not count toward loyalty.
        Flagged duplicates remain counted until cancelled. Pending corrections
        leave accepted values effective.
      </p>
    </>
  );
}
function SaleDetail({
  id,
  reviewing,
  suffix,
  session,
}: {
  id: string;
  reviewing: boolean;
  suffix: string;
  session: AdminSession;
}) {
  const result = useSaleDetail(id),
    [expanded, setExpanded] = useState<AdminSaleDetail | null>(null);
  const sale = expanded ?? result.data;
  if (!sale)
    return (
      <>
        <PageHead
          title="Sale details"
          eyebrow="Sales / Purchase record"
          back={{ href: "/admin/sales" + suffix, label: "Back to sales" }}
        />
        <ReadState {...result} />
      </>
    );
  return (
    <>
      <PageHead
        title={`Sale ${sale.saleCode}`}
        eyebrow="Sales / Purchase record"
        subtitle={`${sale.customer?.name ?? "Customer pending"}${sale.customer ? ` · ${categories[sale.customer.category]}` : ""}`}
        back={{ href: "/admin/sales" + suffix, label: "Back to sales" }}
      />
      <ReadState {...result} />
      {sale.correctionPending ? (
        <div className="wr-notice">
          <Clock aria-hidden="true" strokeWidth={1.75} />
          <div>
            <b>Late correction awaiting review.</b> The recorded{" "}
            {saleMoney(sale.displayedValues.amountKobo)} remains effective until
            an authorized decision.
          </div>
        </div>
      ) : (
        <Notice tone={sale.credited ? "success" : "info"}>
          {sale.credited ? (
            <>
              <b>Completed.</b> Purchase details and photo have been received;
              no routine approval is needed.
            </>
          ) : (
            <>
              <b>
                {sale.state === "cancelled" ? "Cancelled." : "Not credited."}
              </b>{" "}
              Recorded details and history are retained.
            </>
          )}
        </Notice>
      )}
      <div className="wr-two-col">
        <Sheet title="Purchase details" badge={<SaleStatus sale={sale} />}>
          <KeyValueList
            items={[
              {
                label: "Customer name",
                value: sale.customer?.name ?? "Customer pending",
              },
              {
                label: "Customer card",
                value: sale.capturedCardCode,
                mono: true,
              },
              {
                label: "Recorded amount",
                value: saleMoney(sale.displayedValues.amountKobo),
              },
              { label: "Quantity", value: saleQuantity(sale.displayedValues) },
              {
                label: "Entry mode",
                value:
                  sale.displayedValues.basis === "amount"
                    ? "Amount"
                    : "Quantity",
              },
              { label: "Rate at capture", value: saleRate(sale.original) },
              {
                label: "Bought into",
                value: mediumNames[sale.original.medium],
              },
              {
                label: "Station / pump",
                value: `${sale.station.code} · ${sale.pump.code} · ${productNames[sale.product]}`,
              },
              { label: "Recorded by", value: sale.seller.name },
              {
                label: "Username / attendant ID",
                value: `${sale.seller.username} · ${sale.seller.staffCode}`,
                mono: true,
              },
              {
                label: "App capture time",
                value: adminTime(sale.appCapturedAt) + " (app-reported)",
              },
              {
                label: "Server receipt",
                value: adminTime(sale.serverReceivedAt),
              },
              {
                label: "Verified sale date",
                value: sale.verifiedSaleDate ?? "Not independently verified",
              },
              {
                label: "Loyalty credit",
                value: sale.credited
                  ? "Recorded spend included"
                  : "Not credited",
              },
            ]}
          />
        </Sheet>
        <AdminSalePhoto sale={sale} />
      </div>
      {sale.currentRevisionId &&
        sale.displayedSource === "accepted_revision" && (
          <Sheet title="Retained original entry">
            <p className="wr-amount-md">{valuePair(sale.original)}</p>
            <p className="wr-help">
              {saleRate(sale.original)} · {sale.original.basis} entry ·{" "}
              {sale.original.calculation === "meter_evidence"
                ? "Independent meter evidence"
                : "Captured rate"}
            </p>
          </Sheet>
        )}
      {reviewing ? (
        <LateReview
          sale={sale}
          session={session}
          reload={() => {
            setExpanded(null);
            result.reload();
          }}
        />
      ) : (
        sale.correctionPending && (
          <Sheet title="Late correction request">
            <p>
              Recorded values remain effective until an authorized admin
              decides.
            </p>
            <Link
              className="wr-btn wr-btn-secondary"
              href={`/admin/sales/${id}/late-correction${suffix}`}
            >
              Review late correction
            </Link>
          </Sheet>
        )
      )}
      <AdminSaleHistory
        key={sale.id + ":" + sale.version}
        sale={sale}
        onCorrections={setExpanded}
      />
    </>
  );
}
function LateReview({
  sale,
  session,
  reload,
}: {
  sale: AdminSaleDetail;
  session: AdminSession;
  reload: () => void;
}) {
  const pending = sale.corrections.filter(
    (c) => c.state === "awaiting_review" || c.state === "pending_validation",
  );
  const [selected, setSelected] = useState<string | null>(null);
  const c = pending.find((p) => p.id === selected) ?? pending[0];
  if (!c)
    return (
      <Sheet title="Late correction request">
        <Notice>
          No open correction appears in this history page. Load more corrections
          below if older requests remain, or reload the current record.
        </Notice>
        <Button variant="secondary" onClick={reload}>
          Reload current record
        </Button>
      </Sheet>
    );
  return (
    <>
      <Sheet
        title="Late correction request"
        badge={
          <StatusPill small tone="held">
            {c.state === "awaiting_review"
              ? "Awaiting admin decision"
              : "Awaiting validation"}
          </StatusPill>
        }
      >
        {pending.length > 1 && (
          <SelectField
            label="Correction request"
            value={c.id}
            onChange={setSelected}
          >
            {pending.map((p) => (
              <option key={p.id} value={p.id}>
                {adminTime(p.serverReceivedAt)} · {p.id}
              </option>
            ))}
          </SelectField>
        )}
        <p className="wr-secondary">
          {c.authorship === "unverified_recovery"
            ? "Recovered proposal with unverified authorship. Independent administrative review is required regardless of receipt time."
            : "Recorded values remain effective until approved."}
        </p>
        <div className="wr-sales-pair">
          <div className="wr-card wr-quiet">
            <span className="wr-caption">Currently recorded</span>
            <b className="wr-amount-md">{valuePair(sale.displayedValues)}</b>
            <p className="wr-help">
              Rate {saleRate(sale.original)} · entered as {sale.original.basis}
            </p>
          </div>
          <div className="wr-card wr-quiet">
            <span className="wr-caption">Requested correction</span>
            <b className="wr-amount-md">{valuePair(c.proposed)}</b>
            <p className="wr-help">
              Retained rate · entered as {c.proposed.basis}
            </p>
          </div>
        </div>
        <KeyValueList
          items={[
            { label: "Originating attendant", value: c.originatingSeller.name },
            {
              label: "Requested by",
              value:
                c.authorship === "unverified_recovery"
                  ? "Unverified authorship"
                  : (c.requestedBy?.name ?? c.originatingSeller.name),
            },
            { label: "Submitted by", value: c.submittedBy.name },
            { label: "Server receipt", value: adminTime(c.serverReceivedAt) },
            {
              label: "Cutoff at receipt",
              value: c.cutoffAtReceipt
                ? adminTime(c.cutoffAtReceipt)
                : "Unresolved",
            },
            { label: "Reason given", value: c.reason },
          ]}
        />
      </Sheet>
      <CorrectionDecision
        key={c.id + ":" + sale.version}
        sale={sale}
        correction={c}
        session={session}
        reload={reload}
      />
    </>
  );
}
function CorrectionDecision({
  sale,
  correction: c,
  session,
  reload,
}: {
  sale: AdminSaleDetail;
  correction: Correction;
  session: AdminSession;
  reload: () => void;
}) {
  const api = useSalesApi(),
    { store } = useAdminSession(),
    capture = useViewGuard();
  const memoryKey = "sales:decision:" + c.id;
  const [frozen, setFrozen] = useState<FrozenDecision | null>(
      () => (store.lists.get(memoryKey) as FrozenDecision | undefined) ?? null,
    ),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(() => store.lists.has(memoryKey)),
    [blocked, setBlocked] = useState(false),
    [receipt, setReceipt] = useState<Decision | null>(null);
  const inFlight = useRef(false);
  const allowed =
    session.permissions?.includes("sales") &&
    session.permissions.includes("corrections");
  const executor = isRecoveryExecutor(c, session.account);
  const confirm = async () => {
    if (!frozen || inFlight.current) return;
    const current = capture();
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await api.decide(frozen);
      if (!current()) return;
      setReceipt(value);
      store.lists.delete(memoryKey);
      setFrozen(null);
      setUncertain(false);
      for (const key of store.lists.keys())
        if (key.includes("sales:page")) store.lists.delete(key);
    } catch (e) {
      if (!current()) return;
      setError(salesMessage(e));
      const retry =
        e instanceof AdminError &&
        (e.status === 0 ||
          e.status >= 500 ||
          e.status === 429 ||
          e.code === "invalid_response");
      setUncertain(retry);
      setBlocked(!retry);
      if (!retry) store.lists.delete(memoryKey);
    } finally {
      inFlight.current = false;
      if (current()) setBusy(false);
    }
  };
  const prepare = (outcome: "approve" | "reject") => {
    try {
      const request = api.freeze(sale, c.id, outcome, reason.trim());
      setFrozen(request);
      store.lists.set(memoryKey, request);
      setError("");
    } catch (e) {
      setError(salesMessage(e));
    }
  };
  if (receipt)
    return (
      <Sheet title="Decision recorded">
        <Notice tone="success">
          {receipt.outcome === "approve"
            ? "Correction approved."
            : "Correction rejected."}{" "}
          {receipt.creditedAfter
            ? "Recorded spend included."
            : "Not credited; remaining checks still apply."}
        </Notice>
        <p>
          {receipt.actor.name} · {adminTime(receipt.decidedAt)}
        </p>
        <p>{receipt.reason}</p>
        <p className="wr-mono">{receipt.auditEventId}</p>
        <Button variant="secondary" onClick={reload}>
          View updated record
        </Button>
      </Sheet>
    );
  if (!allowed || executor)
    return (
      <Notice tone="warning">
        {executor
          ? "You submitted this recovered correction and cannot approve or reject it. An admin independent of both the executor and grant authorizer must review it."
          : "Sales and corrections permissions are both required to decide this request."}
      </Notice>
    );
  if (c.state !== "awaiting_review")
    return (
      <Notice>
        This correction is still being validated. Recorded values remain
        unchanged.
      </Notice>
    );
  return (
    <Sheet
      title="Decide on this correction"
      badge={
        <StatusPill small tone="held">
          Admin decision required
        </StatusPill>
      }
    >
      <p className="wr-secondary">
        Approval accepts the requested values and rechecks credit eligibility.
        Rejection keeps the recorded values and closes the request. Both
        outcomes retain the original entry and decision history.
      </p>
      {c.authorship === "unverified_recovery" && (
        <Notice tone="warning">
          Authorship remains unverified after a decision. The reviewer must
          differ from both the recovery executor and grant authorizer.
        </Notice>
      )}
      <div className="wr-card wr-quiet">
        <b>Impact if confirmed</b>
        <KeyValueList
          items={[
            {
              label: "Recorded values",
              value: `${valuePair(sale.displayedValues)} to ${valuePair(c.proposed)}`,
            },
            {
              label: "Transactions",
              value: "One purchase retained; other credit checks still apply",
            },
          ]}
        />
      </div>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {blocked ? (
        <Button variant="secondary" onClick={reload}>
          Reload and review current record
        </Button>
      ) : frozen ? (
        <>
          <Notice tone="warning">
            <b>
              {frozen.body.outcome === "approve"
                ? "Approve correction"
                : "Reject request"}
              ?
            </b>
            <p>{frozen.body.reason}</p>
            <p>
              {uncertain
                ? "The result is uncertain. Retry this same confirmation to retrieve its original result."
                : "Confirm this decision against the values reviewed above."}
            </p>
          </Notice>
          <div className="wr-row">
            <Button loading={busy} onClick={() => void confirm()}>
              {uncertain ? "Retry same confirmation" : "Confirm decision"}
            </Button>
            {!uncertain && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setFrozen(null);
                  store.lists.delete(memoryKey);
                }}
              >
                Keep reviewing
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <Reason label="Decision reason" value={reason} onChange={setReason} />
          <div className="wr-row">
            <Button
              disabled={!reason.trim()}
              onClick={() => prepare("approve")}
            >
              Approve correction
            </Button>
            <Button
              variant="secondary"
              disabled={!reason.trim()}
              onClick={() => prepare("reject")}
            >
              Reject request
            </Button>
            <Button variant="ghost" onClick={() => setReason("")}>
              Keep reviewing
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}

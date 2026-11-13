"use client";
import Link from "next/link";
import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AdminSession } from "@/client/admin-session";
import type { AdminSaleDetail } from "@/client/admin-sales-api";
import { correctionDecisionRequest } from "@/client/admin-sales-api";
import {
  AdminReviewApi,
  reviewMessage,
  meterTranscription,
  reviewReferences,
  reviewUncertain,
  type FrozenReview,
  type ReviewKind,
  type ReviewChoice,
} from "@/client/admin-review-api";
import { formatNaira, parseKobo } from "@/shared/money";
import { formatQuantity } from "@/shared/quantity";
import type { Decision, SaleFilter } from "@/shared/contracts/sales";
import { adminTime, adminAction } from "@/client/admin-display";
import {
  valuePair,
  saleRate,
  saleMoney,
  saleQuantity,
} from "@/client/sales-display";
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
  Reason,
  SelectField,
  useViewGuard,
  productNames,
} from "./station-common";
import { useAdminSession } from "./session";
import {
  useSalesRead,
  AdminSalePhoto,
  AdminSaleHistory,
  ReadState,
  SaleStatus,
} from "./sales-common";
import { useMemory } from "./customers-common";
const RecordedContext = createContext<
  ((receipt: Decision, label: string) => void) | null
>(null);
const titles = {
  duplicate: "Possible duplicate",
  price: "Price review",
  card: "Replaced-card sale review",
  date: "Verify sale date",
  capture: "Capture review",
};
const permissions = {
  duplicate: "duplicates",
  price: "priceReview",
  card: "cardEligibility",
  date: "dateReview",
  capture: "dateReview",
} as const;
const routes = {
  duplicate: "duplicate",
  price: "price-review",
  card: "card-review",
  date: "date-review",
  capture: "capture-review",
};
const filters = {
  duplicate: "duplicate",
  price: "price_review",
  card: "card_review",
  date: "date_review",
  capture: "policy_review",
} as const;
export function reviewKind(route: string): ReviewKind | undefined {
  return (Object.keys(routes) as ReviewKind[]).find((k) => routes[k] === route);
}
function useReviewApi() {
  const { store } = useAdminSession();
  return useMemo(
    () => new AdminReviewApi(store.request, correctionDecisionRequest(store)),
    [store],
  );
}
export function ReviewLinks({
  sale,
  suffix,
}: {
  sale: AdminSaleDetail;
  suffix: string;
}) {
  const kinds: ReviewKind[] = [
    ...(sale.duplicateFlag ? ["duplicate" as const] : []),
    ...sale.holds.filter((h) => h.state === "open").map((h) => h.kind),
    ...(sale.policyBlocks.some(
      (b) =>
        b === "capture_authorization_unresolved" ||
        b === "capture_time_unresolved",
    )
      ? ["capture" as const]
      : []),
  ];
  if (!kinds.length) return null;
  return (
    <Sheet title="Reviews">
      <div className="wr-row">
        {kinds.map((kind) => (
          <Link
            key={kind}
            className="wr-btn wr-btn-secondary"
            href={`/admin/sales/${sale.id}/${routes[kind]}${suffix}`}
          >
            {titles[kind]}
          </Link>
        ))}
      </div>
    </Sheet>
  );
}
export function ReviewQueue({
  customer,
  suffix,
}: {
  customer: string | null;
  suffix: string;
}) {
  const [kind, setKind] = useMemory<ReviewKind>("reviews:kind", "duplicate");
  return (
    <>
      <PageHead
        title="Review queue"
        eyebrow="Sales / Reviews"
        subtitle="Duplicates and held sales"
        back={{ href: "/admin/sales" + suffix, label: "Back to sales" }}
      />
      <SelectField
        label="Review type"
        value={kind}
        onChange={(v) => setKind(v as ReviewKind)}
      >
        {Object.entries(titles).map(([key, title]) => (
          <option key={key} value={key}>
            {title}
          </option>
        ))}
      </SelectField>
      <QueuePage
        key={kind + customer}
        kind={kind}
        customer={customer}
        suffix={suffix}
      />
    </>
  );
}
function QueuePage({
  kind,
  customer,
  suffix,
}: {
  kind: ReviewKind;
  customer: string | null;
  suffix: string;
}) {
  const api = useReviewApi();
  const [cursor, setCursor] = useState<string | undefined>(),
    [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const load = useCallback(
    () =>
      api.search({
        status: filters[kind],
        ...(customer ? { customerId: customer } : {}),
        cursor,
        limit: 25,
      } satisfies SaleFilter),
    [api, kind, customer, cursor],
  );
  const result = useSalesRead(kind + ":" + cursor, load);
  const rows = result.data?.items ?? [];
  return (
    <>
      <ReadState {...result} />
      {customer && <Notice>Customer filter remains applied.</Notice>}
      {!result.busy && !result.error && !rows.length && (
        <Notice>No sales awaiting this review.</Notice>
      )}
      <DataTable
        caption={titles[kind]}
        columns={[
          { key: "sale", label: "Sale / customer" },
          { key: "purchase", label: "Original purchase" },
          { key: "status", label: "Status" },
          { key: "action", label: "" },
        ]}
        rows={rows.map((s) => ({
          id: s.id,
          cells: {
            sale: (
              <>
                <b>{s.customer?.name ?? "Customer pending"}</b>
                <span className="wr-sub wr-mono">{s.saleCode}</span>
              </>
            ),
            purchase: (
              <>
                {valuePair(s.displayedValues)}
                <span className="wr-sub">
                  {s.seller.name} · {s.pump.code}
                </span>
              </>
            ),
            status: <SaleStatus sale={s} />,
            action: (
              <Link
                href={`/admin/sales/${s.id}${kind === "capture" && !s.policyBlocks.some((b) => b === "capture_authorization_unresolved" || b === "capture_time_unresolved") ? "" : "/" + routes[kind]}${suffix}`}
              >
                Review
              </Link>
            ),
          },
        }))}
      />
      {kind === "capture" && (
        <p className="wr-help">
          Capture and other unresolved policy checks. Other policy cases open
          the sale details for investigation.
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
        <Button
          variant="secondary"
          disabled={!result.data?.nextCursor || result.busy}
          onClick={() => {
            setPrevious([...previous, cursor]);
            setCursor(result.data!.nextCursor!);
          }}
        >
          Next
        </Button>
      </div>
      <p className="wr-help">
        Duplicate flags do not remove credit. Held sales are not counted until
        all required checks pass.
      </p>
    </>
  );
}
export function ReviewPage({
  id,
  kind,
  unavailable = false,
  session,
  suffix,
}: {
  id: string;
  kind: ReviewKind;
  unavailable?: boolean;
  session: AdminSession;
  suffix: string;
}) {
  const api = useReviewApi();
  const load = useCallback(() => api.detail(id), [api, id]);
  const result = useSalesRead(id, load);
  return (
    <>
      <PageHead
        title={titles[kind]}
        eyebrow="Sales / Review"
        subtitle={
          result.data
            ? `Sale ${result.data.saleCode} · ${result.data.customer?.name ?? "Customer pending"}`
            : undefined
        }
        back={{
          href: "/admin/sales/reviews" + suffix,
          label: "Back to reviews",
        }}
      />
      <ReadState {...result} />
      {result.data && !result.busy && !result.error && (
        <ReviewRecord
          key={result.data.id + ":" + result.data.version + ":" + unavailable}
          sale={result.data}
          kind={kind}
          unavailable={unavailable}
          session={session}
          suffix={suffix}
          reload={result.reload}
        />
      )}
    </>
  );
}
function Original({ sale }: { sale: AdminSaleDetail }) {
  return (
    <Sheet title="Original purchase">
      <div className="wr-review-status">
        <SaleStatus sale={sale} />
      </div>
      <KeyValueList
        items={[
          {
            label: "Customer name",
            value: sale.customer?.name ?? "Customer pending",
          },
          { label: "Customer card", value: sale.capturedCardCode, mono: true },
          {
            label: "Original captured amount",
            value: saleMoney(sale.original.amountKobo),
          },
          { label: "Original quantity", value: saleQuantity(sale.original) },
          {
            label: "Entry mode",
            value: sale.original.basis === "amount" ? "Amount" : "Quantity",
          },
          { label: "Rate at capture", value: saleRate(sale.original) },
          { label: "Bought into", value: adminAction(sale.original.medium) },
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
            value: adminTime(sale.appCapturedAt) + " (device-reported)",
          },
          { label: "Server receipt", value: adminTime(sale.serverReceivedAt) },
          {
            label: "Currently recorded",
            value: valuePair(sale.displayedValues),
          },
          {
            label: "Loyalty credit",
            value: sale.credited ? "Recorded spend included" : "Not credited",
          },
        ]}
      />
    </Sheet>
  );
}
function ReviewRecord({
  sale,
  kind,
  unavailable,
  session,
  suffix,
  reload,
}: {
  sale: AdminSaleDetail;
  kind: ReviewKind;
  unavailable: boolean;
  session: AdminSession;
  suffix: string;
  reload: () => void;
}) {
  const { store } = useAdminSession();
  const api = useReviewApi(),
    capture = useViewGuard();
  const [outcome, setOutcome] = useState<{
    receipt: Decision;
    label: string;
  } | null>(null);
  const [current, setCurrent] = useState<AdminSaleDetail | null>(sale);
  const [currentError, setCurrentError] = useState("");
  const recorded = (receipt: Decision, label: string) => {
    const live = capture();
    setOutcome({ receipt, label });
    setCurrent(null);
    setCurrentError("");
    void api.detail(sale.id).then(
      (detail) => {
        if (live()) setCurrent(detail);
      },
      (e) => {
        if (live()) setCurrentError(reviewMessage(e));
      },
    );
  };
  const pending = store.lists.get("reviews:pending:" + sale.id) as
    FrozenReview | undefined;
  const meterView =
    unavailable ||
    (pending?.body.decision as { outcome?: string } | undefined)?.outcome ===
      "correct_meter";
  return (
    <RecordedContext.Provider value={recorded}>
      {outcome ? (
        <Notice tone={outcome.receipt.creditedAfter ? "success" : "info"}>
          Decision recorded.{" "}
          {outcome.receipt.kind === "duplicate"
            ? "The duplicate decision is recorded below; current purchase status is shown separately."
            : outcome.receipt.creditedAfter
              ? "Recorded spend included."
              : outcome.receipt.outcome === "cancel"
                ? "The sale is cancelled and has no loyalty credit."
                : "Not credited; remaining checks still apply."}
        </Notice>
      ) : (
        <Notice>
          {kind === "duplicate"
            ? "Similarity alone does not confirm a duplicate. The flag does not change either sale's loyalty credit."
            : "This sale needs admin review. Resolving one review does not clear other holds or guarantee loyalty credit."}
        </Notice>
      )}
      {current ? (
        meterView && !outcome ? (
          pending ||
          (sale.state !== "cancelled" &&
            sale.holds.some(
              (h) => h.kind === "price" && h.state === "open",
            )) ? (
            <DecisionForm
              sale={sale}
              kind="price"
              meter
              session={session}
              reload={reload}
            />
          ) : (
            <Notice>
              This review is closed. Original values and history remain
              available.
            </Notice>
          )
        ) : (
          <div className="wr-two-col">
            <Original sale={current} />
            <AdminSalePhoto sale={current} />
          </div>
        )
      ) : (
        <Notice role="status">
          {currentError
            ? "The decision is recorded, but the current sale could not be refreshed. Use View updated record to retry the read."
            : "Loading current sale after the recorded decision…"}
        </Notice>
      )}
      {outcome ? (
        <RecordedDecision
          receipt={outcome.receipt}
          recordedLabel={outcome.label}
          reload={reload}
        />
      ) : meterView ? null : pending ? (
        <DecisionForm
          sale={sale}
          kind={pending.kind}
          session={session}
          reload={reload}
        />
      ) : kind === "duplicate" ? (
        <DuplicateReview
          sale={sale}
          session={session}
          suffix={suffix}
          reload={reload}
        />
      ) : (
        <HoldReview sale={sale} kind={kind} session={session} reload={reload} />
      )}
      {current && (
        <AdminSaleHistory
          key={current.id + ":" + current.version}
          sale={current}
        />
      )}
    </RecordedContext.Provider>
  );
}

function DuplicateReview({
  sale,
  session,
  suffix,
  reload,
}: {
  sale: AdminSaleDetail;
  session: AdminSession;
  suffix: string;
  reload: () => void;
}) {
  const api = useReviewApi();
  const [extra, setExtra] = useState<AdminSaleDetail["duplicateFlags"]>([]);
  const [next, setNext] = useState(sale.historyCursors.duplicateFlags);
  const [moreError, setMoreError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const flags = [...sale.duplicateFlags, ...extra].filter(
    (f) => f.state === "open",
  );
  const [selected, setSelected] = useState(flags[0]?.id ?? "");
  const loadMore = async () => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    setMoreError("");
    try {
      const page = await api.history(sale.id, "duplicateFlags", next);
      const entries = page.items as AdminSaleDetail["duplicateFlags"];
      setExtra((p) => [...p, ...entries]);
      setNext(page.nextCursor);
      if (!selected)
        setSelected(entries.find((f) => f.state === "open")?.id ?? "");
    } catch (e) {
      setMoreError(reviewMessage(e));
    } finally {
      setLoadingMore(false);
    }
  };
  const pagination = (
    <>
      {moreError && <Notice tone="warning">{moreError}</Notice>}
      {next && (
        <Button
          variant="secondary"
          loading={loadingMore}
          onClick={() => void loadMore()}
        >
          Load more duplicate pairs
        </Button>
      )}
    </>
  );
  const flag = flags.find((f) => f.id === selected);
  const other = flag?.purchaseIds.find((id) => id !== sale.id);
  const load = useCallback(() => {
    const current = [...sale.duplicateFlags, ...extra].find(
      (f) => f.id === selected,
    );
    const comparisonId = current?.purchaseIds.find((id) => id !== sale.id);
    return comparisonId ? api.detail(comparisonId) : Promise.resolve(null);
  }, [api, sale, extra, selected]);
  const result = useSalesRead(other ?? "none", load);
  if (!flag)
    return (
      <>
        <Notice>
          No open duplicate flag appears in this history page. Load more pairs
          or reload the current record.
        </Notice>
        {pagination}
      </>
    );
  return (
    <>
      <Sheet title="Possible duplicate">
        {pagination}
        {flags.length > 1 && (
          <SelectField
            label="Duplicate pair"
            value={selected}
            onChange={setSelected}
          >
            {flags.map((f) => (
              <option key={f.id} value={f.id}>
                {f.purchaseIds.filter((id) => id !== sale.id).join(", ")}
              </option>
            ))}
          </SelectField>
        )}
        <p>{flag.reason}</p>
        <ReadState {...result} />
        {result.data && !result.busy && !result.error && (
          <div className="wr-sales-pair">
            {[sale, result.data].map((s) => (
              <div className="wr-card wr-quiet" key={s.id}>
                <span>
                  Sale <b className="wr-mono">{s.saleCode}</b>
                </span>
                <b className="wr-amount-md">{valuePair(s.displayedValues)}</b>
                <p>
                  {s.customer?.name ?? "Customer pending"} · {s.pump.code} ·{" "}
                  {s.seller.name}
                </p>
                <p className="wr-help">
                  Original: {valuePair(s.original)} ·{" "}
                  {adminTime(s.appCapturedAt)} (device-reported)
                </p>
                <p>{s.credited ? "Recorded spend included" : "Not credited"}</p>
                <Link href={`/admin/sales/${s.id}${suffix}`}>
                  View {s.id === sale.id ? "this" : "comparison"} sale
                </Link>
              </div>
            ))}
          </div>
        )}
      </Sheet>
      {result.data && !result.busy && !result.error && (
        <>
          <AdminSalePhoto sale={result.data} />
          <DecisionForm
            key={flag.id}
            sale={{
              ...sale,
              duplicateFlags: [...sale.duplicateFlags, ...extra],
            }}
            kind="duplicate"
            session={session}
            reload={reload}
            pair={result.data}
            flagId={flag.id}
          />
        </>
      )}
    </>
  );
}
function HoldReview({
  sale,
  kind,
  session,
  reload,
}: {
  sale: AdminSaleDetail;
  kind: Exclude<ReviewKind, "duplicate">;
  session: AdminSession;
  reload: () => void;
}) {
  const open =
    kind === "capture"
      ? sale.policyBlocks.some(
          (b) =>
            b === "capture_authorization_unresolved" ||
            b === "capture_time_unresolved",
        )
      : sale.holds.some((h) => h.kind === kind && h.state === "open");
  return (
    <>
      <Sheet
        title={
          kind === "price"
            ? "Offline price review"
            : kind === "card"
              ? "Timing and evidence"
              : kind === "date"
                ? "Supporting evidence"
                : "Capture checks"
        }
      >
        {kind === "price" && (
          <>
            <div className="wr-sales-pair">
              <div className="wr-card wr-quiet">
                <span>Saved price at capture</span>
                <b className="wr-amount-md">{saleRate(sale.original)}</b>
                <p>{valuePair(sale.original)}</p>
              </div>
              <div className="wr-card wr-quiet">
                <span>Server price reference</span>
                <b>
                  {sale.priceReference
                    ? saleMoney(sale.priceReference.rateKobo) +
                      " / " +
                      (sale.original.unit === "litre" ? "litre" : "kg")
                    : "Unavailable"}
                </b>
                <p className="wr-help">
                  For investigation only; never automatically applied to this
                  sale.
                </p>
              </div>
            </div>
            <p>
              The server must establish the captured rate throughout the
              possible capture interval.
            </p>
            <div className="wr-row">
              <Link
                className="wr-btn wr-btn-secondary"
                href={`/admin/sales/${sale.id}/price-review/correct`}
              >
                Correct from meter evidence
              </Link>
              <Button variant="secondary" disabled>
                Cancel invalid sale · Not available yet
              </Button>
            </div>
            <p className="wr-help">
              Price cancellation is not available under the current review
              policy.
            </p>
          </>
        )}
        {kind === "card" && (
          <>
            <KeyValueList
              items={[
                {
                  label: "Card used at capture",
                  value: sale.capturedCardCode,
                  mono: true,
                },
                {
                  label: "Card replaced · server event",
                  value: sale.replacement
                    ? adminTime(sale.replacement.replacedAt)
                    : "No replacement record available",
                },
                {
                  label: "Replacement card",
                  value: sale.replacement?.replacementCardCode ?? "Unavailable",
                  mono: true,
                },
              ]}
            />
            <p>
              Confirm only when the records establish that the entire possible
              capture interval was before replacement. Cancel only when it was
              entirely at or after replacement. If the records do not settle
              this, leave the sale held. The old card stays disabled either way.
            </p>
          </>
        )}
        {kind === "date" && (
          <p>
            The records must place the entire possible capture interval within
            one Lagos calendar day. Enter that day only; phone time, photo
            metadata and notes do not prove the date. No time of day is recorded
            and the original timestamp is preserved.
          </p>
        )}
        {kind === "capture" && (
          <>
            <p>
              One decision covers every open capture check together. The server
              checks authorization and campaign timing using the original
              records. Outside-campaign timing alone is not a reason to cancel.
            </p>
            <ul>
              {sale.policyBlocks
                .filter(
                  (b) =>
                    b === "capture_authorization_unresolved" ||
                    b === "capture_time_unresolved",
                )
                .map((b) => (
                  <li key={b}>
                    {b === "capture_authorization_unresolved"
                      ? "Capture authorization needs review"
                      : "Capture timing needs review"}
                  </li>
                ))}
            </ul>
          </>
        )}
      </Sheet>
      {open && sale.state !== "cancelled" ? (
        <DecisionForm
          sale={sale}
          kind={kind}
          session={session}
          reload={reload}
        />
      ) : (
        <Notice>
          This review is closed. The original and decision history remain
          available.
        </Notice>
      )}
    </>
  );
}
function DecisionForm({
  sale,
  kind,
  session,
  reload,
  pair,
  flagId,
  meter = false,
}: {
  sale: AdminSaleDetail;
  kind: ReviewKind;
  session: AdminSession;
  reload: () => void;
  pair?: AdminSaleDetail;
  flagId?: string;
  meter?: boolean;
}) {
  const api = useReviewApi(),
    { store } = useAdminSession(),
    capture = useViewGuard();
  const onRecorded = useContext(RecordedContext);
  const memoryKey = "reviews:pending:" + sale.id;
  const [frozen, setFrozen] = useState<FrozenReview | null>(
    () => (store.lists.get(memoryKey) as FrozenReview | undefined) ?? null,
  );
  meter =
    meter ||
    (frozen?.body.decision as { outcome?: string } | undefined)?.outcome ===
      "correct_meter";
  const [reason, setReason] = useState(""),
    [notes, setNotes] = useState(""),
    [date, setDate] = useState(""),
    [references, setReferences] = useState<string[]>([]),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [uncertain, setUncertain] = useState(() => store.lists.has(memoryKey)),
    [blocked, setBlocked] = useState(false),
    [receipt, setReceipt] = useState<Decision | null>(null),
    [recordedLabel, setRecordedLabel] = useState("");
  const initialAmount = formatNaira(parseKobo(sale.displayedValues.amountKobo))
    .replace("₦", "")
    .replaceAll(",", "");
  const [meterAmount, setMeterAmount] = useState(initialAmount);
  const [meterQuantity, setMeterQuantity] = useState(
    sale.displayedValues.quantity,
  );
  let meterValid = true;
  if (meter) {
    try {
      meterTranscription(sale, meterAmount, meterQuantity);
    } catch {
      meterValid = false;
    }
  }
  const flight = useRef(false);
  const effectiveKind = frozen?.kind ?? kind;
  const allowed =
    session.permissions?.includes("sales") &&
    session.permissions.includes(permissions[effectiveKind]);
  const ready =
    meterValid &&
    !!reason.trim() &&
    (kind === "duplicate" ||
      (!!notes.trim() &&
        sale.evidence.state === "validated" &&
        !!sale.evidence.assetId)) &&
    (kind !== "date" || /^\d{4}-\d{2}-\d{2}$/.test(date));
  function prepare(choice: ReviewChoice, cancelId: string | null = null) {
    try {
      const request =
        kind === "duplicate"
          ? api.prepareDuplicate(sale, pair!, flagId!, cancelId, reason)
          : api.prepare(
              sale,
              kind,
              choice,
              reason,
              notes,
              references,
              date,
              meter
                ? { amountNaira: meterAmount, quantity: meterQuantity }
                : undefined,
            );
      setFrozen(request);
      setError("");
    } catch (e) {
      setError(reviewMessage(e));
    }
  }
  async function confirm() {
    if (!frozen || flight.current || !allowed) return;
    const current = capture();
    flight.current = true;
    setBusy(true);
    setError("");
    // Save before delivery so route changes cannot enable a new changed decision.
    store.lists.set(memoryKey, frozen);
    try {
      const result = await api.submit(frozen);
      if (!current()) return;
      store.lists.delete(memoryKey);
      setReceipt(result);
      setRecordedLabel(frozen.label);
      onRecorded?.(result, frozen.label);
      setFrozen(null);
      setUncertain(false);
      for (const key of store.lists.keys())
        if (key.includes("sales:page")) store.lists.delete(key);
    } catch (e) {
      if (!current()) return;
      setError(
        meter &&
          e instanceof Error &&
          "code" in e &&
          e.code === "evidence_insufficient"
          ? "The records don't settle this yet. A single rate must apply throughout the possible capture period, and both readings must fit the meter's allowed rounding difference. The rate may not be uniform or the readings may be outside that allowance. Leave this sale held; do not change readings just to make them fit."
          : reviewMessage(e),
      );
      const retry = reviewUncertain(e);
      setUncertain(retry);
      setBlocked(!retry);
      if (!retry) store.lists.delete(memoryKey);
    } finally {
      flight.current = false;
      if (current()) setBusy(false);
    }
  }
  if (receipt)
    return (
      <RecordedDecision
        receipt={receipt}
        recordedLabel={recordedLabel}
        reload={reload}
      />
    );
  if (!allowed)
    return (
      <Notice tone="warning">
        Your current permissions do not allow this decision. Sales and{" "}
        {permissions[effectiveKind]} access are both required.
      </Notice>
    );
  if (
    !frozen &&
    kind === "duplicate" &&
    (sale.state === "cancelled" || pair?.state === "cancelled")
  )
    return (
      <Notice>
        Sale {sale.state === "cancelled" ? sale.saleCode : pair!.saleCode} is
        already cancelled. This duplicate flag is historical; no new decision
        can be made for this pair. Both records remain available.
      </Notice>
    );
  const frozenMeter = frozen?.body.decision as
    { outcome?: string; amountKobo?: string; quantity?: string } | undefined;
  const shownAmount =
    frozenMeter?.outcome === "correct_meter"
      ? formatNaira(parseKobo(frozenMeter.amountKobo!))
          .replace("₦", "")
          .replaceAll(",", "")
      : meterAmount;
  const shownQuantity =
    frozenMeter?.outcome === "correct_meter"
      ? frozenMeter.quantity!
      : meterQuantity;
  const editor = (
    <>
      <p>
        Enter both readings exactly as shown in the validated photo for this
        sale. Do not use a totalizer or unit-price display. Either or both
        values may change; no value is calculated from the other.
      </p>
      <div className="wr-sales-pair">
        <TextField
          label="Meter amount (₦)"
          inputMode="decimal"
          value={shownAmount}
          disabled={!!frozen || blocked || busy}
          onChange={(e) => setMeterAmount(e.target.value)}
          helper="Two decimals maximum."
        />
        <TextField
          label={`Meter quantity (${sale.original.unit === "litre" ? "litres" : "kilograms"})`}
          inputMode="decimal"
          value={shownQuantity}
          disabled={!!frozen || blocked || busy}
          onChange={(e) => setMeterQuantity(e.target.value)}
          helper={`Up to ${sale.original.quantityPrecision} decimals, as captured.`}
        />
      </div>
      {!meterValid && (
        <Notice tone="warning">
          Enter positive readings within the amount and captured quantity
          precision. Values are never rounded to fit.
        </Notice>
      )}
      <div className="wr-sales-pair">
        <div className="wr-card wr-quiet">
          <span>Originally captured</span>
          <b className="wr-amount-md">{valuePair(sale.original)}</b>
          <p>{saleRate(sale.original)} · original entry retained</p>
        </div>
        <div className="wr-card wr-quiet">
          <span>Corrected values</span>
          {meterValid && (
            <b className="wr-amount-md">
              {formatNaira(
                parseKobo(
                  meterTranscription(sale, shownAmount, shownQuantity)
                    .amountKobo,
                ),
              )}{" "}
              ·{" "}
              {formatQuantity(
                shownQuantity,
                sale.original.unit,
                sale.original.quantityPrecision,
              )}
            </b>
          )}
          <p>From meter evidence</p>
        </div>
      </div>
    </>
  );
  return (
    <>
      {meter && (
        <div className="wr-two-col wr-meter-editor-row">
          <Sheet
            title="Correct from meter evidence"
            badge={
              <StatusPill small tone="held">
                Editor
              </StatusPill>
            }
          >
            {editor}
          </Sheet>
          <AdminSalePhoto sale={sale} />
        </div>
      )}
      <Sheet
        title={
          frozen
            ? meter
              ? "Review correction"
              : "Review decision"
            : kind === "date"
              ? "Record a verified date"
              : meter
                ? "Review correction"
                : "Resolve this review"
        }
        badge={
          <StatusPill small tone="held">
            Admin decision required
          </StatusPill>
        }
      >
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
              <b>{frozen.label}</b>
              <p>{frozen.body.reason}</p>
              <p>
                {uncertain
                  ? "The result is uncertain. Retry this same decision with its original details to retrieve the recorded outcome."
                  : "Confirm the decision reviewed here. Originals and history are retained."}
              </p>
            </Notice>
            <div className="wr-card wr-quiet">
              {!!frozen.body.decision &&
                (frozen.body.decision as { outcome: string }).outcome ===
                  "correct_meter" && (
                  <p className="wr-amount-md">
                    {formatNaira(
                      parseKobo(
                        (frozen.body.decision as { amountKobo: string })
                          .amountKobo,
                      ),
                    )}{" "}
                    ·{" "}
                    {formatQuantity(
                      (frozen.body.decision as { quantity: string }).quantity,
                      sale.original.unit,
                      sale.original.quantityPrecision,
                    )}
                  </p>
                )}
              <b>Impact if confirmed</b>
              <p>
                {frozen.label.startsWith("Cancel sale")
                  ? "Only the named sale is cancelled and contributes zero. Other purchase records remain unchanged."
                  : effectiveKind === "duplicate"
                    ? "Clear this duplicate flag and keep both sales. Their credit status stays unchanged."
                    : "Resolve this review only. Loyalty credit depends on every remaining check; no current price is substituted."}
              </p>
            </div>
            <div className="wr-row">
              <Button loading={busy} onClick={() => void confirm()}>
                {uncertain ? "Retry same decision" : "Confirm decision"}
              </Button>
              {!uncertain && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setFrozen(null)}
                >
                  Keep reviewing
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            {kind !== "duplicate" && (
              <>
                <div className="wr-field">
                  <label className="wr-label" htmlFor="review-notes">
                    Evidence notes · explanation, not proof
                  </label>
                  <textarea
                    id="review-notes"
                    className="wr-input"
                    rows={3}
                    maxLength={1000}
                    required
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    aria-describedby="review-notes-help"
                  />
                  <p id="review-notes-help" className="wr-help">
                    Explain your decision. Notes are not proof and cannot
                    replace missing records. Do not include phone numbers or
                    secrets.
                  </p>
                </div>
                <fieldset className="wr-review-references">
                  <legend className="wr-label">
                    Server records offered with this sale
                  </legend>
                  <p className="wr-help">
                    Optional supporting references from the latest sale read.
                    The server checks the complete history even when none are
                    selected.
                  </p>
                  {reviewReferences(sale).map((r) => (
                    <label key={r.id} className="wr-review-reference">
                      <input
                        type="checkbox"
                        checked={references.includes(r.id)}
                        onChange={(e) =>
                          setReferences(
                            e.target.checked
                              ? [...references, r.id]
                              : references.filter((id) => id !== r.id),
                          )
                        }
                      />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </fieldset>
                {sale.evidence.state !== "validated" && (
                  <Notice tone="warning">
                    The validated meter photo is unavailable. A decision cannot
                    be prepared.
                  </Notice>
                )}
              </>
            )}
            {kind === "date" && (
              <TextField
                label="Verified sale date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                helper="Calendar date · Africa/Lagos. The records must establish one day; the date cannot be after server receipt."
              />
            )}
            <Reason
              label="Decision reason"
              value={reason}
              onChange={setReason}
            />
            {meter && (
              <Button
                variant="secondary"
                onClick={() => {
                  setMeterAmount(initialAmount);
                  setMeterQuantity(sale.displayedValues.quantity);
                  setReason("");
                  setNotes("");
                  setReferences([]);
                }}
              >
                Discard changes
              </Button>
            )}
            <div className="wr-row">
              {kind === "duplicate" ? (
                <>
                  <Button
                    variant="secondary"
                    disabled={!ready || !pair}
                    onClick={() => prepare("keep_both")}
                  >
                    Clear the flag · keep both
                  </Button>
                  {[sale, pair]
                    .filter((s): s is AdminSaleDetail => !!s)
                    .map((s) => (
                      <Button
                        key={s.id}
                        variant="danger"
                        disabled={!ready || !pair || s.state === "cancelled"}
                        onClick={() => prepare("cancel", s.id)}
                      >
                        Cancel sale {s.saleCode}
                      </Button>
                    ))}
                </>
              ) : (
                <>
                  <Button
                    disabled={!ready}
                    onClick={() =>
                      prepare(
                        kind === "price"
                          ? meter
                            ? "correct_meter"
                            : "accept_captured"
                          : kind === "card"
                            ? "confirm_earlier"
                            : kind === "date"
                              ? "verify_date"
                              : "confirm",
                      )
                    }
                  >
                    {kind === "price"
                      ? meter
                        ? "Review correction"
                        : "Confirm captured values"
                      : kind === "card"
                        ? "Confirm valid earlier purchase"
                        : kind === "date"
                          ? "Review verified date"
                          : "Confirm capture"}
                  </Button>
                  {(kind === "card" || kind === "capture") && (
                    <Button
                      variant="danger"
                      disabled={!ready}
                      onClick={() => prepare("cancel")}
                    >
                      Cancel invalid sale
                    </Button>
                  )}
                </>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setReason("");
                  setError("");
                }}
              >
                Keep reviewing
              </Button>
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}

function RecordedDecision({
  receipt,
  recordedLabel,
  reload,
}: {
  receipt: Decision;
  recordedLabel: string;
  reload: () => void;
}) {
  return (
    <Sheet title="Decision recorded">
      <Notice tone={receipt.creditedAfter ? "success" : "info"}>
        {receipt.kind === "duplicate"
          ? receipt.outcome === "cancel"
            ? `${recordedLabel.replace(/^Cancel sale /, "Sale ")} was cancelled and has no loyalty credit. The other sale is unchanged.`
            : "The flag is cleared and both sales are kept. Neither sale’s loyalty credit was changed."
          : receipt.creditedAfter
            ? "Recorded spend included."
            : receipt.outcome === "cancel"
              ? "Cancelled. This sale has no loyalty credit."
              : "Not credited; remaining checks still apply."}{" "}
        The decision is recorded and the original is retained.
      </Notice>
      <KeyValueList
        items={[
          { label: "Decision", value: recordedLabel },
          { label: "Outcome", value: adminAction(receipt.outcome) },
          { label: "Recorded values", value: valuePair(receipt.after) },
          { label: "Decision reason", value: receipt.reason },
          { label: "Decided by", value: receipt.actor.name },
          {
            label: "Decision time · server",
            value: adminTime(receipt.decidedAt),
          },
          {
            label: "Remaining holds",
            value:
              receipt.remainingHolds
                .filter((h) => h.state === "open")
                .map((h) => titles[h.kind])
                .join(" · ") || "None",
          },
          {
            label: "Other checks",
            value: receipt.policyBlocks.length
              ? "Further checks remain"
              : "None",
          },
        ]}
      />
      <p className="wr-help">
        This is the recorded outcome of this operation. Reload to see the
        current record.
      </p>
      <Button variant="secondary" onClick={reload}>
        View updated record
      </Button>
    </Sheet>
  );
}

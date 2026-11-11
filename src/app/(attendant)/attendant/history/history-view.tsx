"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  Button,
  KeyValueList,
  ListRow,
  Notice,
  StatusPill,
  ResultBlock,
} from "@/ui";
import type {
  AttendantSaleRow,
  AttendantSaleDetail,
  AttendantHistoryItem,
} from "@/client/sales-api";
import type { OutboxRow } from "@/client/types";
import type { SaleValues } from "@/shared/contracts/sales";
import { localValues } from "@/client/offline/correction-values";
import { pendingCorrection } from "@/client/offline/correction-types";
import {
  saleMoney,
  saleQuantity,
  saleRate,
  valuePair,
  inputFromValues,
  correctionPreview,
  saleStatusLabel,
  saleTone,
} from "@/client/sales-display";
import { correctionErrorMessage } from "@/client/sales-api";
import {
  Frame,
  useAttendant,
  useOwnSales,
  formatTime,
  productName,
  mediumName,
  pumpName,
  go,
  message,
} from "../_components/runtime";
import {
  mergeOwnHistory,
  correctionLabel,
  correctionReceiptKey,
} from "./history-model";
import { useCorrections, useSale, salesApi } from "./history-hooks";
import { HistoryPhoto } from "./history-photo";
function Context() {
  const { state } = useAttendant();
  const s = state!.session!;
  return (
    <>
      {s.station.name} · {pumpName(s.pump.code)} · {productName[s.product.code]}
    </>
  );
}
function Back() {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      icon={<ArrowLeft aria-hidden />}
      onClick={() => go(router, "/attendant/history")}
    >
      Back to sales
    </Button>
  );
}
export function HistoryList() {
  const { client, state, online } = useAttendant();
  const { rows, error: localError } = useOwnSales();
  const { rows: corrections, error: correctionLoadError } = useCorrections();
  const account = state!.session!.account.id,
    context = state!.session!.captureContextId;
  const [result, setResult] = useState<{
    account: string;
    items: AttendantSaleRow[];
    nextCursor: string | null;
    loading: boolean;
    error: string;
  }>({ account: "", items: [], nextCursor: null, loading: true, error: "" });
  const [refresh, setRefresh] = useState(0);
  const [more, setMore] = useState(false);
  const flight = useRef(false);
  const receipts = correctionReceiptKey(
    corrections.filter((c) => c.state === "accepted" || c.state === "rejected"),
  );
  useEffect(() => {
    if (!client) return;
    let live = true;
    const controller = new AbortController();
    if (!online) {
      setResult((previous) => ({
        account,
        items: previous.account === account ? previous.items : [],
        nextCursor: null,
        loading: false,
        error:
          "Offline · server history is unavailable. Saved phone records are shown separately.",
      }));
      return;
    }
    setResult((previous) => ({
      account,
      items: previous.account === account ? previous.items : [],
      nextCursor: null,
      loading: true,
      error: "",
    }));
    void salesApi.list({}, controller.signal).then(
      (page) => {
        if (
          live &&
          client.getState().session?.account.id === account &&
          client.getState().session?.captureContextId === context
        )
          setResult({
            account,
            items: page.items,
            nextCursor: page.nextCursor,
            loading: false,
            error: "",
          });
      },
      async (e) => {
        if (!live) return;
        await client.observeAuthorityError(e, state!.session!);
        if (live)
          setResult({
            account,
            items: [],
            nextCursor: null,
            loading: false,
            error: message(e),
          });
      },
    );
    return () => {
      live = false;
      controller.abort();
    };
    // Account and capturing context fence this API request; session object clones do not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, account, context, online, refresh, receipts]);
  const visible = result.account === account;
  const merged = mergeOwnHistory(
    account,
    visible ? result.items : [],
    rows ?? [],
  );
  async function loadMore() {
    if (!result.nextCursor || !client || flight.current) return;
    flight.current = true;
    setMore(true);
    try {
      const page = await salesApi.list({ cursor: result.nextCursor });
      if (
        client.getState().session?.account.id === account &&
        client.getState().session?.captureContextId === context
      )
        setResult((p) => ({
          ...p,
          items: [...p.items, ...page.items],
          nextCursor: page.nextCursor,
          error: "",
        }));
    } catch (e) {
      await client.observeAuthorityError(e, state!.session!);
      if (client.getState().session?.account.id === account)
        setResult((p) => ({ ...p, error: message(e) }));
    } finally {
      flight.current = false;
      setMore(false);
    }
  }
  const correctionFor = (operationId: string) =>
    corrections
      .filter((c) => c.originalOperationId === operationId)
      .sort((a, b) => b.localSavedAt.localeCompare(a.localSavedAt))[0];
  return (
    <Frame title="Sales history" active="History" context={<Context />}>
      <h2 className="wr-section-title">
        Recorded by {state!.session!.account.name}
      </h2>
      {(result.loading || rows === null) && (
        <Notice role="status">Loading sales history…</Notice>
      )}
      {(result.error || localError || correctionLoadError) && (
        <Notice tone="warning" role="status">
          {result.error || localError || correctionLoadError}
        </Notice>
      )}
      {!result.loading &&
        rows !== null &&
        !merged.remote.length &&
        !merged.pending.length && <Notice>No sales to show yet.</Notice>}
      {!!merged.remote.length && (
        <div className="wr-list">
          {merged.remote.map((row) => {
            const correction = correctionFor(row.operationId);
            return (
              <ListRow
                key={row.id}
                name={row.customer?.name ?? row.capturedCardCode}
                amount={saleMoney(row.displayedValues.amountKobo)}
                metadata={`${saleQuantity(row.displayedValues)} · ${mediumName[row.displayedValues.medium]} · ${formatTime(row.appCapturedAt)}`}
                status={saleStatusLabel(row, true)}
                tone={saleTone(row)}
                action={
                  row.correctionPending
                    ? "Correction awaiting review"
                    : "View details"
                }
                description={
                  correction ? correctionLabel(correction) : undefined
                }
                href={`/attendant/history/${row.id}`}
              />
            );
          })}
        </div>
      )}
      {visible && result.nextCursor && online && (
        <Button
          variant="secondary"
          loading={more}
          onClick={() => void loadMore()}
        >
          Load more sales
        </Button>
      )}
      {!!merged.pending.length && (
        <section className="wr-section">
          <h2 className="wr-section-title">Saved on this phone</h2>
          <Notice>
            These are this account’s local records. The server may not have
            received them yet.
          </Notice>
          <div className="wr-list">
            {merged.pending.map((row) => {
              const correction = correctionFor(row.operationId);
              return (
                <ListRow
                  key={row.operationId}
                  name={
                    row.customerCache?.customer.name ?? row.original.cardCode
                  }
                  amount={saleMoney(row.original.entry.amountKobo)}
                  metadata={`${saleQuantity(localValues(row))} · ${mediumName[row.original.medium]} · ${formatTime(row.original.appCapturedAt)}`}
                  status={
                    row.serverStatus?.credited
                      ? "Synced"
                      : row.state === "cancelled"
                        ? "Cancelled"
                        : "Saved on phone"
                  }
                  tone={
                    row.serverStatus?.credited
                      ? "synced"
                      : row.state === "cancelled"
                        ? "failed"
                        : "pending"
                  }
                  description={
                    correction
                      ? correctionLabel(correction)
                      : "Original entry saved on this phone; open for current server values."
                  }
                  href={`/attendant/history/${row.operationId}`}
                />
              );
            })}
          </div>
        </section>
      )}
      {corrections.filter(
        (c) =>
          !merged.remote.some((r) => r.operationId === c.originalOperationId) &&
          !merged.pending.some((r) => r.operationId === c.originalOperationId),
      ).length > 0 && (
        <section className="wr-section">
          <h2 className="wr-section-title">Saved corrections</h2>
          <div className="wr-list">
            {corrections
              .filter(
                (c) =>
                  !merged.remote.some(
                    (r) => r.operationId === c.originalOperationId,
                  ) &&
                  !merged.pending.some(
                    (r) => r.operationId === c.originalOperationId,
                  ),
              )
              .map((c) => (
                <ListRow
                  key={c.operationId}
                  name="Sale correction"
                  amount={saleMoney(c.baseValues.amountKobo)}
                  metadata={c.reason}
                  status={correctionLabel(c)}
                  tone={c.state === "accepted" ? "synced" : "pending"}
                  action="View correction"
                  href={`/attendant/history/${c.purchaseId ?? c.originalOperationId}`}
                />
              ))}
          </div>
        </section>
      )}
      <p className="wr-help">
        Tap a sale to view details or make a permitted correction. Corrections
        apply automatically only if the server receives them before midnight on
        the sale date.
      </p>
      <Button
        variant="secondary"
        disabled={!online}
        onClick={() => setRefresh((n) => n + 1)}
      >
        Refresh sales
      </Button>
    </Frame>
  );
}
function Record({
  detail,
  local,
  values,
  editing,
}: {
  detail: AttendantSaleDetail | null;
  local?: OutboxRow;
  values: SaleValues;
  editing: boolean;
}) {
  const seller = detail?.seller;
  const d = local?.captureDisplay;
  return (
    <div className="wr-card">
      <KeyValueList
        items={[
          { label: "Recorded by", value: seller?.name ?? d?.sellerName ?? "" },
          {
            label: "Username / ID",
            value: `${seller?.username ?? d?.sellerUsername ?? ""} · ${seller?.staffCode ?? d?.staffCode ?? ""}`,
            mono: true,
          },
          {
            label: "Card number",
            value: detail?.capturedCardCode ?? local?.original.cardCode,
            mono: true,
          },
          {
            label: "Product and pump",
            value: `${productName[detail?.product ?? d?.product ?? ""] ?? ""} · ${pumpName(detail?.pump.code ?? d?.pumpCode ?? "")}`,
          },
          { label: "Bought into", value: mediumName[values.medium] },
          { label: "Price used", value: saleRate(values) },
          ...(!editing
            ? [
                {
                  label: "Entered as",
                  value: values.basis === "amount" ? "Amount" : "Quantity",
                },
              ]
            : []),
        ]}
      />
      {!editing && (
        <>
          <dl className="wr-total">
            <dt>Amount</dt>
            <dd>{saleMoney(values.amountKobo)}</dd>
          </dl>
          <div className="wr-help wr-history-right">
            About {saleQuantity(values)}
          </div>
        </>
      )}
    </div>
  );
}
function HistoryEntries({ detail }: { detail: AttendantSaleDetail }) {
  const { client, state } = useAttendant();
  const [extra, setExtra] = useState<Record<string, AttendantHistoryItem[]>>(
    {},
  );
  const [cursors, setCursors] = useState(detail.historyCursors);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function more(kind: keyof typeof cursors) {
    if (!cursors[kind] || busy) return;
    setBusy(kind);
    setError("");
    const identity = state!.session!;
    try {
      const page = await salesApi.history(detail.id, {
        kind,
        cursor: cursors[kind]!,
      });
      if (
        live.current &&
        client?.getState().session?.account.id === identity.account.id &&
        client.getState().session?.captureContextId ===
          identity.captureContextId
      ) {
        setExtra((p) => ({
          ...p,
          [kind]: [...(p[kind] ?? []), ...page.items],
        }));
        setCursors((p) => ({ ...p, [kind]: page.nextCursor }));
      }
    } catch (e) {
      await client?.observeAuthorityError(e, identity);
      if (live.current) setError(message(e));
    } finally {
      if (live.current) setBusy("");
    }
  }
  return (
    <section className="wr-section">
      <h2 className="wr-section-title">Sale history</h2>
      <div className="wr-card">
        <p>
          <b>Original entry</b>
          <br />
          {valuePair(detail.original)}
        </p>
        <p className="wr-help">
          App capture time: {formatTime(detail.appCapturedAt)}
          <br />
          Server receipt: {formatTime(detail.serverReceivedAt)}
        </p>
      </div>
      {(["revisions", "corrections", "decisions"] as const).map((kind) => {
        const entries: AttendantHistoryItem[] = [
          ...detail[kind],
          ...(extra[kind] ?? []),
        ];
        return (
          <section className="wr-section" key={kind}>
            <h3 className="wr-person-title">
              {kind.charAt(0).toUpperCase() + kind.slice(1)}
            </h3>
            {!entries.length ? (
              <p className="wr-help">No {kind} recorded.</p>
            ) : (
              <div className="wr-list">
                {entries.map((item) => (
                  <div className="wr-list-row" key={item.id}>
                    {"values" in item ? (
                      <>
                        <b>
                          Revision {item.number} · {item.state}
                        </b>
                        <p>{valuePair(item.values)}</p>
                        <p className="wr-help">{formatTime(item.receivedAt)}</p>
                      </>
                    ) : "proposed" in item ? (
                      <>
                        <b>{item.state.replaceAll("_", " ")}</b>
                        <p>{valuePair(item.proposed)}</p>
                        <p>{item.reason}</p>
                        <p className="wr-help">
                          Received {formatTime(item.serverReceivedAt)}
                          {item.decidedAt
                            ? ` · Decided ${formatTime(item.decidedAt)}`
                            : ""}
                        </p>
                      </>
                    ) : (
                      <>
                        <b>
                          {item.kind} · {item.outcome.replaceAll("_", " ")}
                        </b>
                        <p>
                          {valuePair(item.before)} to {valuePair(item.after)}
                        </p>
                        <p className="wr-help">
                          {formatTime(item.decidedAt)} ·{" "}
                          {item.creditedAfter
                            ? "Loyalty credit included"
                            : "Loyalty credit not included"}
                        </p>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            {cursors[kind] && (
              <Button
                variant="secondary"
                loading={busy === kind}
                disabled={!!busy}
                onClick={() => void more(kind)}
              >
                Load more {kind}
              </Button>
            )}
          </section>
        );
      })}
      {error && (
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
      )}
    </section>
  );
}
export function SaleView({
  saleId,
  editing = false,
}: {
  saleId: string;
  editing?: boolean;
}) {
  const { client, state, online } = useAttendant();
  const router = useRouter();
  const [refresh, setRefresh] = useState(0);
  const { detail, local, corrections, error, loading, identity } = useSale(
    saleId,
    refresh,
  );
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const flight = useRef(false);
  const [photoAvailable, setPhotoAvailable] = useState(false);
  const values = detail?.displayedValues ?? (local ? localValues(local) : null);
  const baseKey = detail?.currentRevisionId ?? local?.operationId ?? "";
  const [prepared, setPrepared] = useState<{
    identity: string;
    base: string;
  } | null>(null);
  if (values && !loading && !prepared) {
    setPrepared({ identity, base: baseKey });
    setValue(inputFromValues(values));
  }
  const baseChanged = !!prepared && prepared.base !== baseKey;
  const pending = corrections.find(pendingCorrection);
  let preview: ReturnType<typeof correctionPreview> | null = null,
    validation = "";
  if (values && value) {
    try {
      preview = correctionPreview(values, value);
    } catch {
      validation =
        "Enter a positive value within the sale's recorded precision.";
    }
  }
  const blocked =
    !!pending ||
    !!detail?.correctionPending ||
    values?.calculation !== "captured_rate" ||
    detail?.state === "cancelled" ||
    local?.state === "cancelled" ||
    (!!detail && !detail.currentRevisionId && !local);
  const sourceValid = detail?.currentRevisionId
    ? detail.evidence.state === "validated" && !!detail.evidence.assetId
    : !!local;
  async function save() {
    if (
      !client ||
      !values ||
      !preview?.changed ||
      !reason.trim() ||
      flight.current ||
      blocked ||
      baseChanged
    )
      return;
    flight.current = true;
    setBusy(true);
    setSaveError("");
    const account = state!.session!.account.id,
      context = state!.session!.captureContextId;
    try {
      await client.saveCorrection({
        source: detail?.currentRevisionId
          ? { kind: "server", detail }
          : { kind: "local", operationId: local!.operationId },
        value,
        reason,
      });
      if (
        client.getState().session?.account.id === account &&
        client.getState().session?.captureContextId === context
      ) {
        setSaved(true);
        void client.retryUploads();
      }
    } catch (e) {
      if (client.getState().session?.account.id === account)
        setSaveError(message(e));
    } finally {
      flight.current = false;
      if (client.getState().session?.account.id === account) setBusy(false);
    }
  }
  const currentCorrection = corrections
    .slice()
    .sort((a, b) => b.localSavedAt.localeCompare(a.localSavedAt))[0];
  const title = editing ? "Correct sale" : "Sale details";
  return (
    <Frame
      title={title}
      active="History"
      context={
        detail ? (
          <>
            {detail.station.code} · {pumpName(detail.pump.code)} ·{" "}
            {productName[detail.product]}
          </>
        ) : local ? (
          <>
            {local.captureDisplay.stationCode} ·{" "}
            {pumpName(local.captureDisplay.pumpCode)} ·{" "}
            {productName[local.captureDisplay.product]}
          </>
        ) : (
          <Context />
        )
      }
      headerAction={<Back />}
      action={
        values ? (
          editing ? (
            <>
              <Button
                cta
                loading={busy}
                disabled={
                  !preview?.changed ||
                  !reason.trim() ||
                  reason.trim().length > 1000 ||
                  blocked ||
                  !sourceValid ||
                  !photoAvailable ||
                  baseChanged ||
                  saved ||
                  state?.access !== "active"
                }
                onClick={() => void save()}
              >
                Save correction
              </Button>
              <Button
                variant="ghost"
                onClick={() => go(router, `/attendant/history/${saleId}`)}
              >
                Cancel edit
              </Button>
              <p className="wr-help">
                Change a value to enable saving. Your original entry stays in
                the audit history.
              </p>
            </>
          ) : !blocked && sourceValid ? (
            <Button
              cta
              onClick={() => go(router, `/attendant/history/${saleId}/correct`)}
            >
              Correct sale
            </Button>
          ) : undefined
        ) : undefined
      }
    >
      {loading && !values && (
        <Notice role="status">Loading sale details…</Notice>
      )}
      {error && (
        <Notice tone="warning" role="status">
          {error}
        </Notice>
      )}
      {!values && !loading && <Notice>This sale is unavailable.</Notice>}
      {!values && currentCorrection && (
        <Notice role="status">
          <b>{correctionLabel(currentCorrection)}</b>
          <p>{currentCorrection.reason}</p>
          <p>Recorded base: {valuePair(currentCorrection.baseValues)}</p>
          <p>
            Your saved correction stays on this phone. Reconnect to inspect the
            current sale.
          </p>
          {currentCorrection.lastErrorCode && (
            <p>{correctionErrorMessage(currentCorrection.lastErrorCode)}</p>
          )}
          <Button
            variant="secondary"
            disabled={!online || state?.access !== "active"}
            onClick={() => void client?.retryUploads()}
          >
            Retry correction
          </Button>
        </Notice>
      )}
      {!editing && detail?.state === "held" && (
        <>
          <ResultBlock
            title={
              detail.holds.some((h) => h.kind === "price" && h.state === "open")
                ? "Awaiting price review"
                : "Held"
            }
            tone="held"
          >
            {detail.evidence.state === "validated"
              ? "Uploaded: details and photo received. "
              : "Sale details received. "}
            Not counted toward loyalty until an admin reviews it.
          </ResultBlock>
          <Notice>
            <b>An admin needs to review this sale.</b> Your original entry is
            preserved.{" "}
            {detail.holds.some(
              (h) => h.kind === "price" && h.state === "open",
            ) && "The saved price needs review against the price at capture."}
          </Notice>
          <p className="wr-help">
            No need to record this sale again. Re-uploading will not clear the
            review.
          </p>
        </>
      )}
      {values && (
        <>
          <div>
            <h2 className="wr-person-title">
              {detail?.customer?.name ??
                local?.customerCache?.customer.name ??
                local?.original.cardCode}
            </h2>
            <p className="wr-secondary">
              {formatTime(
                detail?.appCapturedAt ?? local!.original.appCapturedAt,
              )}{" "}
              {detail ? (
                <StatusPill small tone={saleTone(detail)}>
                  {saleStatusLabel(detail, true)}
                </StatusPill>
              ) : (
                <StatusPill small tone="pending">
                  Saved on phone
                </StatusPill>
              )}
            </p>
          </div>
          <Notice>
            {detail?.correctionWindow.cutoff ? (
              <>
                Corrections must reach the server{" "}
                <b>
                  before {formatTime(detail.correctionWindow.cutoff)}{" "}
                  (Africa/Lagos)
                </b>{" "}
                to apply automatically. Later changes need an admin.
              </>
            ) : (
              <>
                The server decides correction timing. Saving on this phone does
                not establish server receipt or loyalty credit.
              </>
            )}
          </Notice>
          {!detail && local && (
            <Notice>
              Original entry saved on this phone. Current server values are
              unavailable; any correction waits for a matching accepted
              original.
            </Notice>
          )}
          <Record
            detail={local && !detail?.currentRevisionId ? null : detail}
            local={local}
            values={values}
            editing={editing}
          />
          {editing && (
            <section className="wr-section">
              <h2 className="wr-section-title">Recorded entry</h2>
              <p className="wr-label">
                Entered as {values.basis === "amount" ? "Amount" : "Quantity"} ·
                recorded basis
              </p>
              <div className="wr-field">
                <label className="wr-label" htmlFor="correction-value">
                  {values.basis === "amount" ? "Amount (₦)" : "Quantity"}
                </label>
                <input
                  id="correction-value"
                  className="wr-input wr-input-lg"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  aria-invalid={!!validation}
                  aria-describedby="correction-value-help"
                  disabled={!!pending || saved}
                />
                <p id="correction-value-help" className="wr-help">
                  {validation ||
                    "Only the entered value can change. The recorded rate and entry basis stay the same."}
                </p>
              </div>
              {preview && (
                <div
                  className="wr-card wr-quiet"
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span className="wr-label">Calculated</span>
                  <strong className="wr-amount-md">
                    {values.basis === "amount"
                      ? `About ${saleQuantity({ ...values, quantity: preview.quantity })}`
                      : saleMoney(preview.amountKobo)}
                  </strong>
                </div>
              )}
              <p className="wr-help">
                Rate: <b>{saleRate(values)}</b> · Check both values against the
                meter.
              </p>
              <p className="wr-help">
                Currently recorded: <b>{valuePair(values)}</b>
              </p>
              <div className="wr-field">
                <label className="wr-label" htmlFor="correction-reason">
                  Reason
                </label>
                <textarea
                  id="correction-reason"
                  className="wr-input"
                  rows={3}
                  required
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={!!pending || saved}
                />
                <p className="wr-help">
                  Required. Explain the numeric mistake without phone numbers or
                  secrets.
                </p>
              </div>
            </section>
          )}
          <HistoryPhoto
            detail={local && !detail?.currentRevisionId ? null : detail}
            local={local}
            onAvailable={setPhotoAvailable}
          />
          {blocked && !pending && (
            <Notice>
              {detail?.correctionPending
                ? "A correction is already waiting for this sale."
                : "This sale cannot be corrected here. Ask an authorized admin to review it."}
            </Notice>
          )}
          {baseChanged && editing && (
            <Notice tone="warning">
              The accepted sale changed. Reload and review the current values
              before preparing a new correction.
              <Button
                variant="secondary"
                onClick={() => {
                  setPrepared(null);
                  setSaved(false);
                  setRefresh((n) => n + 1);
                }}
              >
                Reload sale
              </Button>
            </Notice>
          )}
          {currentCorrection && (
            <Notice
              tone={
                currentCorrection.state === "accepted" ? "success" : "warning"
              }
              role="status"
            >
              <b>{correctionLabel(currentCorrection)}</b>
              <p>
                {valuePair(currentCorrection.baseValues)} · Proposed{" "}
                {currentCorrection.edit.basis === "amount"
                  ? saleMoney(currentCorrection.edit.enteredAmountKobo)
                  : currentCorrection.edit.enteredQuantity}
              </p>
              {currentCorrection.lastErrorCode && (
                <p>{correctionErrorMessage(currentCorrection.lastErrorCode)}</p>
              )}
              <p>
                {currentCorrection.state === "accepted"
                  ? "The server confirmed this correction. Current values are refreshed above."
                  : currentCorrection.state === "awaiting_review"
                    ? "The prior accepted values remain effective until an admin decides."
                    : "Your correction is separate from the original. Local saving does not imply server receipt or credit."}
              </p>
            </Notice>
          )}
          {saved && !currentCorrection && (
            <Notice role="status">
              Correction saved on phone. Waiting for the server outcome.
            </Notice>
          )}
          {saveError && (
            <Notice tone="danger" role="alert">
              {saveError}
            </Notice>
          )}
          {currentCorrection &&
            !["accepted", "rejected"].includes(currentCorrection.state) && (
              <Button
                variant="secondary"
                disabled={!online || state?.access !== "active"}
                onClick={() => void client?.retryUploads()}
              >
                Retry correction
              </Button>
            )}
          {!editing && detail && (
            <HistoryEntries
              key={`${detail.id}:${detail.version}`}
              detail={detail}
            />
          )}
          {!editing && online && (
            <Button
              variant="secondary"
              onClick={() => setRefresh((n) => n + 1)}
            >
              Refresh sale
            </Button>
          )}
        </>
      )}
    </Frame>
  );
}

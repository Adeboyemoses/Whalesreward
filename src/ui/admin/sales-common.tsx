"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminSession } from "./session";
import {
  AdminSalesApi,
  correctionDecisionRequest,
  type AdminSaleDetail,
  type AdminHistoryKind,
} from "@/client/admin-sales-api";
import {
  saleStatusLabel,
  saleTone,
  salesMessage,
  valuePair,
} from "@/client/sales-display";
import { adminTime, adminAction } from "@/client/admin-display";
import { StatusPill, Notice, Button } from "@/ui";
import { Sheet } from "./station-common";
export function useSalesApi() {
  const { store } = useAdminSession();
  return useMemo(
    () => new AdminSalesApi(store.request, correctionDecisionRequest(store)),
    [store],
  );
}
export function useSalesRead<T>(key: string, load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [serial, setSerial] = useState(0);
  useEffect(() => {
    let live = true;
    void (async () => {
      setBusy(true);
      setError("");
      try {
        const value = await load();
        if (live) setData(value);
      } catch (e) {
        if (live) setError(salesMessage(e));
      } finally {
        if (live) setBusy(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [key, load, serial]);
  return { data, error, busy, reload: () => setSerial((s) => s + 1) };
}
export function SaleStatus({
  sale,
  attendant = false,
}: {
  sale: {
    credited: boolean;
    state: string;
    correctionPending?: boolean;
    duplicateFlag?: boolean;
    holds?: { kind: string; state: string }[];
    policyBlocks?: string[];
  };
  attendant?: boolean;
}) {
  return (
    <>
      <StatusPill small tone={saleTone(sale)}>
        {saleStatusLabel(sale, attendant)}
      </StatusPill>
      {sale.correctionPending && (
        <span className="wr-sub">Correction pending</span>
      )}
      {sale.duplicateFlag && <span className="wr-sub">Possible duplicate</span>}
      {sale.holds
        ?.filter((h) => h.state === "open")
        .map((h) => (
          <span className="wr-sub" key={h.kind}>
            {h.kind === "price"
              ? "Awaiting price review"
              : `${adminAction(h.kind)} review`}
          </span>
        ))}
      {sale.policyBlocks?.map((b) => (
        <span className="wr-sub" key={b}>
          {adminAction(b)}
        </span>
      ))}
    </>
  );
}
export function ReadState({
  error,
  busy,
  reload,
}: {
  error: string;
  busy: boolean;
  reload: () => void;
}) {
  return (
    <>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {busy && <p role="status">Loading…</p>}
      {error && !busy && (
        <Button variant="secondary" onClick={reload}>
          Retry loading
        </Button>
      )}
    </>
  );
}
export function AdminSalePhoto({ sale }: { sale: AdminSaleDetail }) {
  const api = useSalesApi();
  const { store } = useAdminSession();
  const [photo, setPhoto] = useState<{ url: string; expiresAt: string } | null>(
      null,
    ),
    [error, setError] = useState(""),
    [serial, setSerial] = useState(0),
    [full, setFull] = useState(false);
  useEffect(() => {
    let live = true;
    const reset = async () => {
      setPhoto(null);
      setError("");
      setFull(false);
    };
    void reset();
    if (sale.evidence.state !== "validated" || !sale.evidence.assetId) return;
    const epoch = store.getSnapshot().epoch;
    void api.photoAccess(sale.id, sale.evidence.assetId).then(
      (v) => {
        if (live && store.getSnapshot().epoch === epoch) setPhoto(v);
      },
      (e) => {
        if (live) setError(salesMessage(e));
      },
    );
    return () => {
      live = false;
    };
  }, [api, sale.id, sale.evidence.assetId, sale.evidence.state, store, serial]);
  const unavailable =
    sale.evidence.state === "deleted"
      ? "The meter photo has been deleted under the retention policy."
      : sale.evidence.state === "pending"
        ? "The meter photo is still awaiting validation."
        : sale.evidence.state === "missing"
          ? "The meter photo is unavailable."
          : null;
  return (
    <Sheet title="Meter evidence">
      <div className="wr-photo wr-sales-photo">
        {photo && !error ? (
          <>
            <img
              src={photo.url}
              alt="Validated meter photo"
              referrerPolicy="no-referrer"
              onError={() =>
                setError(
                  "The meter photo is unavailable or its access expired. Request access again.",
                )
              }
            />
            <div className="wr-photo-bar">
              <span>Validated meter evidence</span>
              <Button
                variant="link"
                onClick={() => {
                  if (Date.now() >= Date.parse(photo.expiresAt)) {
                    setSerial((s) => s + 1);
                    setError(
                      "Photo access expired. Fresh access is being requested.",
                    );
                  } else setFull(true);
                }}
              >
                Open full size
              </Button>
            </div>
          </>
        ) : (
          <p role="status">{unavailable ?? error ?? "Loading meter photo…"}</p>
        )}
      </div>
      {error && (
        <>
          <Notice tone="warning" role="alert">
            {error}
          </Notice>
          <Button variant="secondary" onClick={() => setSerial((s) => s + 1)}>
            Request photo again
          </Button>
        </>
      )}
      <p className="wr-help">
        Inspect amount and quantity against the recorded values. Device
        timestamps are supporting evidence, not proof.
      </p>
      {full && photo && !error && (
        <div
          className="wr-sales-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Full size meter photo"
        >
          <Button autoFocus variant="secondary" onClick={() => setFull(false)}>
            Close photo
          </Button>
          <img
            src={photo.url}
            alt="Full size validated meter photo"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </Sheet>
  );
}
export function AdminSaleHistory({
  sale,
  onCorrections,
}: {
  sale: AdminSaleDetail;
  onCorrections?: (sale: AdminSaleDetail) => void;
}) {
  const api = useSalesApi();
  const [current, setCurrent] = useState(sale),
    [error, setError] = useState(""),
    [busy, setBusy] = useState<AdminHistoryKind | null>(null);
  const load = async (kind: AdminHistoryKind) => {
    const cursor = current.historyCursors[kind];
    if (!cursor || busy) return;
    setBusy(kind);
    setError("");
    try {
      const page = await api.history(sale.id, kind, cursor);
      const next = {
        ...current,
        [kind]: [...current[kind], ...page.items],
        historyCursors: { ...current.historyCursors, [kind]: page.nextCursor },
      } as AdminSaleDetail;
      setCurrent(next);
      if (kind === "corrections") onCorrections?.(next);
    } catch (e) {
      setError(salesMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const render = (kind: AdminHistoryKind) => {
    const records = current[kind];
    return (
      <section className="wr-section" key={kind}>
        <h3>
          {adminAction(kind === "duplicateFlags" ? "duplicate flags" : kind)}
        </h3>
        {records.length === 0 && (
          <p className="wr-help">
            No {adminAction(kind).toLowerCase()} recorded.
          </p>
        )}
        <ul className="wr-sales-history">
          {records.map((item) => (
            <li key={item.id}>
              {"values" in item ? (
                <>
                  <b>
                    Revision {item.number} · {adminAction(item.state)}
                  </b>
                  <p>{valuePair(item.values)}</p>
                  <p>
                    {adminAction(item.kind)} · {adminTime(item.receivedAt)} ·{" "}
                    {item.actor.name}
                  </p>
                  {item.reason && <p>{item.reason}</p>}
                </>
              ) : "proposed" in item ? (
                <>
                  <b>{adminAction(item.state)} correction</b>
                  <p>{valuePair(item.proposed)}</p>
                  <p>{item.reason}</p>
                  <p>
                    {adminTime(item.serverReceivedAt)} ·{" "}
                    {item.authorship === "unverified_recovery"
                      ? "Unverified authorship · recovered proposal"
                      : `Requested by ${item.requestedBy?.name ?? item.originatingSeller.name}`}
                  </p>
                  {item.decisionReason && (
                    <p>Decision: {item.decisionReason}</p>
                  )}
                </>
              ) : "outcome" in item ? (
                <>
                  <b>
                    {adminAction(item.kind)} · {adminAction(item.outcome)}
                  </b>
                  <p>
                    {valuePair(item.before)} to {valuePair(item.after)}
                  </p>
                  <p>
                    {item.actor.name} · {adminTime(item.decidedAt)}
                  </p>
                  <p>{item.reason}</p>
                  <p>
                    {item.creditedAfter
                      ? "Recorded spend included"
                      : "Not credited"}{" "}
                    · <span className="wr-mono">{item.auditEventId}</span>
                  </p>
                </>
              ) : (
                <>
                  <b>Duplicate flag · {adminAction(item.state)}</b>
                  <p>{item.reason}</p>
                  <p>Original records retained.</p>
                </>
              )}
            </li>
          ))}
        </ul>
        {current.historyCursors[kind] && (
          <Button
            variant="secondary"
            disabled={busy !== null}
            onClick={() => void load(kind)}
          >
            Load more{" "}
            {adminAction(
              kind === "duplicateFlags" ? "duplicate flags" : kind,
            ).toLowerCase()}
          </Button>
        )}
      </section>
    );
  };
  return (
    <Sheet title="Activity and audit trail">
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {(
        ["revisions", "corrections", "decisions", "duplicateFlags"] as const
      ).map(render)}
    </Sheet>
  );
}
export function useSaleDetail(id: string) {
  const api = useSalesApi();
  const load = useCallback(() => api.detail(id), [api, id]);
  return useSalesRead(id, load);
}

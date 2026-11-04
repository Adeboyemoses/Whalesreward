"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button, ListRow, Notice, ResultBlock } from "@/ui";
import { formatNaira, parseKobo } from "@/shared/money";
import { formatQuantity } from "@/shared/quantity";
import { authoritativeStatus } from "@/client/offline/sync-status";
import {
  AccessGate,
  Frame,
  go,
  useAttendant,
  useOwnSales,
  message,
  mediumName,
  pumpName,
  productName,
  formatTime,
} from "../_components/runtime";
import {
  salePresentation,
  uploadSummary,
} from "../_components/sale-presentation";
function Uploads() {
  const { client, state, online } = useAttendant();
  const { rows, error: loadError } = useOwnSales();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const router = useRouter();
  const session = state!.session!;
  const summary = rows ? uploadSummary(rows) : null;
  const nextRetry = summary?.waiting
    .map((row) => row.nextAttemptAt)
    .filter((at): at is string => !!at && Date.parse(at) > now)
    .sort()[0];
  async function retry() {
    if (!client || flight.current) return;
    flight.current = true;
    const accountId = session.account.id;
    setBusy(true);
    setError(null);
    try {
      await client.retryUploads();
    } catch (e) {
      if (client.getState().session?.account.id === accountId)
        setError(message(e));
    } finally {
      flight.current = false;
      if (client.getState().session?.account.id === accountId) setBusy(false);
    }
  }
  return (
    <Frame
      title="Pending uploads"
      active="Uploads"
      context={
        <>
          {session.station.name} · {pumpName(session.pump.code)} ·{" "}
          {productName[session.product.code]}
        </>
      }
      action={
        summary?.waiting.length ? (
          <>
            <Button
              cta
              loading={busy}
              disabled={!online || state?.access !== "active"}
              icon={<RefreshCw aria-hidden />}
              onClick={() => void retry()}
            >
              {busy ? "Uploading…" : "Retry uploads"}
            </Button>
            <p className="wr-help">
              Retries reuse the same sale records, so nothing is counted twice.
            </p>
          </>
        ) : summary ? (
          <Button cta onClick={() => go(router, "/attendant/sale")}>
            Record a sale
          </Button>
        ) : undefined
      }
    >
      {!summary && (
        <Notice role={loadError ? "alert" : "status"}>
          {loadError ?? "Loading pending uploads…"}
        </Notice>
      )}
      {summary && (
        <>
          {!summary.waiting.length && (
            <ResultBlock
              title={
                summary.completePhotos
                  ? "All uploads complete"
                  : "No uploads waiting"
              }
            >
              {summary.completePhotos
                ? "Every sale and photo from this account has reached the server. Nothing is waiting to upload."
                : "Nothing is waiting to upload. Cancelled sales are not credited; their original photos remain on this phone."}
            </ResultBlock>
          )}
          <div className="wr-card wr-quiet">
            <h2 className="wr-person-title">
              {summary.waiting.length}{" "}
              {summary.waiting.length === 1 ? "sale" : "sales"} waiting
            </h2>
            <p className="wr-secondary">
              {online
                ? busy
                  ? "Online · uploading"
                  : nextRetry
                    ? `Online · next retry after ${formatTime(nextRetry)}`
                    : "Online"
                : "Offline · uploads paused"}
            </p>
          </div>
          {summary.waiting.length > 0 ? (
            <Notice tone="warning">
              These sales have <b>not</b> been added to loyalty yet.
            </Notice>
          ) : (
            <Notice>
              Only server-confirmed credit shows as <b>Synced</b>. Sales held
              for review remain uncredited.
            </Notice>
          )}
          {summary.waiting.length > 0 && (
            <div className="wr-list">
              {summary.waiting.map((row) => {
                const presentation = salePresentation(row);
                const status = authoritativeStatus(row);
                return (
                  <ListRow
                    key={row.operationId}
                    name={
                      status?.customer?.name ??
                      row.customerCache?.customer.name ??
                      row.original.cardCode
                    }
                    amount={formatNaira(
                      parseKobo(row.original.entry.amountKobo),
                    )}
                    metadata={`${formatQuantity(row.original.entry.quantity, row.original.unit, row.original.quantityPrecision)} · ${mediumName[row.original.medium]} · ${formatTime(row.original.appCapturedAt)}`}
                    status={presentation.label}
                    tone={presentation.tone}
                    description={presentation.description}
                    href={`/attendant/uploads/${encodeURIComponent(row.operationId)}`}
                  />
                );
              })}
            </div>
          )}
          {summary.settled.length > 0 && (
            <section
              className="wr-section"
              aria-label="Sales awaiting review or cancelled"
            >
              <h2 className="wr-person-title">Sale status</h2>
              <div className="wr-list">
                {summary.settled.map((row) => {
                  const presentation = salePresentation(row);
                  const status = authoritativeStatus(row);
                  return (
                    <ListRow
                      key={row.operationId}
                      name={
                        status?.customer?.name ??
                        row.customerCache?.customer.name ??
                        row.original.cardCode
                      }
                      amount={formatNaira(
                        parseKobo(row.original.entry.amountKobo),
                      )}
                      metadata={formatQuantity(
                        row.original.entry.quantity,
                        row.original.unit,
                        row.original.quantityPrecision,
                      )}
                      status={presentation.label}
                      tone={presentation.tone}
                      href={`/attendant/uploads/${encodeURIComponent(row.operationId)}`}
                    />
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
    </Frame>
  );
}
export default function UploadsPage() {
  return (
    <AccessGate>
      <Uploads />
    </AccessGate>
  );
}

"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice, KeyValueList, ResultBlock, ListRow } from "@/ui";
import { formatNaira, parseKobo } from "@/shared/money";
import { formatQuantity } from "@/shared/quantity";
import { authoritativeStatus, isCredited } from "@/client/offline/sync-status";
import { salePresentation } from "./sale-presentation";
import {
  Frame,
  go,
  useAttendant,
  productName,
  pumpName,
  mediumName,
  message,
  useOwnSales,
  formatTime,
} from "./runtime";
export function Receipt({
  operationId,
  uploadDetail = false,
}: {
  operationId: string;
  uploadDetail?: boolean;
}) {
  const { client, state, online } = useAttendant();
  const router = useRouter();
  const { rows, error: loadError } = useOwnSales();
  const [error, setError] = useState<string | null>(null);
  const accountId = state?.session?.account.id;
  const row = rows?.find((item) => item.operationId === operationId);
  useEffect(() => {
    let live = true;
    if (client && accountId && online)
      void client.refreshSale(operationId).catch((error) => {
        if (live && client.getState().session?.account.id === accountId)
          setError(message(error));
      });
    return () => {
      live = false;
    };
  }, [client, accountId, operationId, online]);
  if (!row || row.originatingAccountId !== accountId)
    return (
      <Frame title="Sale recorded">
        <Notice role={error ? "alert" : "status"}>
          {loadError ??
            (rows
              ? "This saved sale is not available for this account."
              : "Loading saved sale…")}
        </Notice>
        <Button
          variant="secondary"
          onClick={() => go(router, "/attendant/sale")}
        >
          Back to sale
        </Button>
      </Frame>
    );
  const sale = row.original;
  const capture = row.captureDisplay;
  const status = authoritativeStatus(row);
  const presentation = salePresentation(row);
  const credited = isCredited(row);
  const held = status?.state === "held";
  const customerName =
    status?.customer?.name ??
    row.customerCache?.customer.name ??
    "Pending lookup";
  const summary = (
    <KeyValueList
      items={[
        {
          label: "Sale reference",
          value: status?.saleCode ?? "Reference after upload",
          mono: !!status,
        },
        { label: "Customer", value: customerName },
        { label: "Card", value: sale.cardCode, mono: true },
        { label: "Recorded by", value: capture.sellerName },
        { label: "Attendant ID", value: capture.staffCode, mono: true },
        {
          label: "Product",
          value: `${productName[capture.product]} · ${pumpName(capture.pumpCode)}`,
        },
        { label: "Bought into", value: mediumName[sale.medium] },
        {
          label: "Entered as",
          value:
            sale.entry.basis === "amount"
              ? "Amount"
              : sale.unit === "litre"
                ? "Litres"
                : "Kilograms",
        },
        {
          label: "Quantity",
          value: `${sale.entry.basis === "amount" ? "About " : ""}${formatQuantity(sale.entry.quantity, sale.unit, sale.quantityPrecision)}`,
        },
        {
          label: "Rate used",
          value: `${formatNaira(parseKobo(sale.rateKobo))} / ${sale.unit === "litre" ? "litre" : "kg"}`,
        },
      ]}
      total={formatNaira(parseKobo(sale.entry.amountKobo))}
    />
  );
  return (
    <Frame
      title={held ? "Sale status" : "Sale recorded"}
      active={uploadDetail ? "Uploads" : "Sale"}
      context={
        <>
          {capture.stationCode} · {pumpName(capture.pumpCode)} ·{" "}
          {productName[capture.product]} · <b>{capture.sellerName}</b> ·{" "}
          <span className="wr-mono wr-username">{capture.sellerUsername}</span>
        </>
      }
      action={
        <Button cta onClick={() => go(router, "/attendant/sale")}>
          Record next sale
        </Button>
      }
    >
      {!online && (
        <Notice tone="inverse">
          <b>Offline.</b> Sales and photos stay on this phone until they upload.
        </Notice>
      )}
      <ResultBlock
        title={presentation.title}
        tone={
          presentation.tone === "synced"
            ? "synced"
            : presentation.tone === "failed"
              ? "failed"
              : held
                ? "held"
                : "pending"
        }
      >
        {presentation.description}
      </ResultBlock>
      {held && uploadDetail ? (
        <div className="wr-list">
          <ListRow
            name={customerName}
            amount={formatNaira(parseKobo(sale.entry.amountKobo))}
            metadata={`${formatQuantity(sale.entry.quantity, sale.unit, sale.quantityPrecision)} · ${mediumName[sale.medium]}`}
            description={
              <>
                Sale reference:{" "}
                <span className="wr-mono">{status.saleCode}</span>
              </>
            }
            status={presentation.label}
            tone="held"
            href={`/attendant/sale/${encodeURIComponent(operationId)}/recorded`}
          />
        </div>
      ) : (
        <div className="wr-card">{summary}</div>
      )}
      {held && (
        <>
          <Notice>
            {status.holds.some((hold) => hold.kind === "price") && (
              <>
                The saved price ({formatNaira(parseKobo(sale.rateKobo))} /{" "}
                {sale.unit === "litre" ? "litre" : "kg"}) needs review against
                the price at capture.{" "}
              </>
            )}
            <b>An admin needs to review this sale.</b> Your original entry is
            preserved.
            <ul>
              {presentation.holds.map((hold) => (
                <li key={hold}>{hold}</li>
              ))}
            </ul>
          </Notice>
          <p className="wr-help">
            No need to record this sale again. Re-uploading will not clear the
            review.
          </p>
        </>
      )}
      {!held && (
        <Notice
          tone={
            credited ? "success" : status?.photoValidated ? "info" : "warning"
          }
        >
          {credited ? (
            <b>Meter photo synced.</b>
          ) : status?.photoValidated ? (
            <b>Meter photo received.</b>
          ) : (
            <b>Meter photo saved on this phone.</b>
          )}
          {!status?.photoValidated &&
            status?.state !== "cancelled" &&
            " Upload pending. Keep this phone’s browser data until your sales upload."}
          {status?.state === "cancelled" &&
            " Original evidence retained. This sale has not been added to loyalty."}
        </Notice>
      )}
      {status && (
        <p className="wr-help">
          Sale details received {formatTime(status.serverReceivedAt)}.
        </p>
      )}
      {error && (
        <Notice tone="warning" role="status">
          {error} Showing the last saved status.
        </Notice>
      )}
    </Frame>
  );
}

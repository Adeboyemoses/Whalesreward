"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice, KeyValueList, ResultBlock } from "@/ui";
import { formatNaira, parseKobo } from "@/shared/money";
import { formatQuantity } from "@/shared/quantity";
import type { OutboxRow } from "@/client/offline/client";
import {
  Frame,
  go,
  useAttendant,
  productName,
  pumpName,
  mediumName,
  message,
} from "./runtime";
export function Receipt({ operationId }: { operationId: string }) {
  const { client, state, online } = useAttendant();
  const router = useRouter();
  const [row, setRow] = useState<OutboxRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const accountId = state?.session?.account.id;
  useEffect(() => {
    let live = true;
    if (client && accountId)
      void client.ownSale(operationId).then(
        (value) => {
          if (live) {
            if (value) setRow(value);
            else setError("This saved sale is not available for this account.");
          }
        },
        (e) => {
          if (live) setError(message(e));
        },
      );
    return () => {
      live = false;
    };
  }, [client, accountId, operationId]);
  if (!row || row.originatingAccountId !== accountId)
    return (
      <Frame title="Sale recorded">
        <Notice role={error ? "alert" : "status"}>
          {error ?? "Loading saved sale…"}
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
  return (
    <Frame
      title="Sale recorded"
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
      <ResultBlock title="Saved on phone" tone="pending">
        Upload pending. Not counted toward loyalty until the details and photo
        reach the server.
      </ResultBlock>
      <div className="wr-card">
        <KeyValueList
          items={[
            {
              label: "Customer",
              value: row.customerCache?.customer.name ?? "Pending lookup",
            },
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
      </div>
      <Notice tone="warning">
        <b>Meter photo saved on this phone.</b> Upload pending. Keep this
        phone&apos;s browser data until your sales upload.
      </Notice>
    </Frame>
  );
}

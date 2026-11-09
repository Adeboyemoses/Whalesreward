"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, DataTable, Notice, TextField } from "@/ui";
import { useAdminSession } from "./session";
import {
  pricesSchema,
  priceEventSchema,
  type PriceEvent,
  type StationPrice,
} from "@/client/station-types";
import {
  freezeChange,
  priceInput,
  priceEditorValue,
  type FrozenChange,
} from "@/client/station-api";
import { adminTime } from "@/client/admin-display";
import {
  ErrorNotice,
  PageHead,
  Sheet,
  SelectField,
  Reason,
  KeyValueList,
  PriceHistory,
  Loading,
  MutationState,
  useAll,
  useRead,
  useMutation,
  useReceipt,
  productNames,
  rate,
} from "./station-common";
export function Prices() {
  const { session } = useAdminSession();
  const list = useRead("prices", pricesSchema);
  const receipt = useReceipt().get<PriceEvent>("/admin/prices");
  const history = useAll(
    `prices/${receipt?.product.code ?? "pms"}/history`,
    priceEventSchema,
    undefined,
    !!receipt,
  );
  return (
    <>
      <PageHead
        title="Product prices"
        eyebrow={session?.station?.name ?? "Station"}
        subtitle="One shared selling price per product"
      />
      <Loading {...list} label="Refreshing product prices…" />
      {receipt && (
        <Notice tone="success" role="status">
          <b>Price activated.</b> Applied confirmation:{" "}
          {productNames[receipt.product.code]},{" "}
          {rate(receipt.previous, receipt.product.unit)} to{" "}
          {rate(receipt.current, receipt.product.unit)}, version{" "}
          {receipt.version}, {adminTime(receipt.current.effectiveFrom)} by{" "}
          {receipt.actor.name} · {receipt.actor.code}. Reason: {receipt.reason}.
          Earlier and already-started sales keep their captured settings. This
          receipt records the applied change; current settings appear below.
        </Notice>
      )}
      {list.data && (
        <>
          <PriceTable items={list.data.items} />
          <p className="wr-help">
            A product price change applies to every pump selling that product.
            Earlier purchases retain the price recorded at capture.
          </p>
        </>
      )}
      {receipt && <PriceHistory {...history} items={history.data} />}
    </>
  );
}
export function PriceTable({ items }: { items: StationPrice[] }) {
  return (
    <>
      <DataTable
        caption="Station selling prices"
        summary="Applies to all pumps of each product"
        columns={[
          { key: "product", label: "Product" },
          { key: "price", label: "Price per unit", amount: true },
          { key: "precision", label: "Quantity decimals", align: "right" },
          { key: "pumps", label: "Applies to" },
          { key: "action", label: "" },
        ]}
        rows={items.map((x) => ({
          id: x.product.id,
          cells: {
            product: (
              <>
                <b>{productNames[x.product.code]}</b>
                <span className="wr-sub">
                  {x.price ? `Version ${x.price.version}` : "Not configured"}
                </span>
              </>
            ),
            price: rate(x.price, x.product.unit),
            precision: x.price?.quantityPrecision ?? "Not configured",
            pumps: x.pumps.map((p) => p.name).join(", ") || "No pumps",
            action: (
              <Link href={`/admin/prices/${x.product.code}/edit`}>
                Manage price
              </Link>
            ),
          },
        }))}
      />
      {items.length === 0 && <p>No products configured.</p>}
    </>
  );
}
type PriceBody = {
  expectedVersion: number | null;
  rateKobo: string;
  currency: string;
  quantityPrecision: number;
  reason: string;
};
export function PriceEditor({
  code,
  confirm,
}: {
  code: string;
  confirm: boolean;
}) {
  const router = useRouter(),
    { session } = useAdminSession(),
    receipt = useReceipt();
  const source = useRead("prices", pricesSchema);
  const history = useAll(
    `prices/${encodeURIComponent(code)}/history`,
    priceEventSchema,
  );
  const current = source.data?.items.find((x) => x.product.code === code);
  const [value, setValue] = useState<string | null>(null),
    [precision, setPrecision] = useState<string | null>(null),
    [reason, setReason] = useState(""),
    [error, setError] = useState("");
  const [frozen, setFrozen] = useState<FrozenChange<PriceBody> | null>(null);
  const [snapshot, setSnapshot] = useState<StationPrice | null>(null);
  const mutation = useMutation(priceEventSchema, (event) => {
    receipt.save("/admin/prices", event);
    setFrozen(null);
    router.push("/admin/prices");
  });
  function review() {
    if (!current || mutation.busy || mutation.uncertain || mutation.blocked)
      return;
    try {
      const body = {
        expectedVersion: current.price?.version ?? null,
        rateKobo: priceInput(
          value ??
            (current.price ? priceEditorValue(current.price.rateKobo) : ""),
        ),
        currency: current.price?.currency ?? "NGN",
        quantityPrecision:
          (precision ??
            (current.price ? String(current.price.quantityPrecision) : "")) ===
          ""
            ? -1
            : Number(precision ?? current.price?.quantityPrecision),
        reason: reason.trim(),
      };
      if (
        !Number.isInteger(body.quantityPrecision) ||
        body.quantityPrecision < 0 ||
        body.quantityPrecision > 6 ||
        !body.reason
      )
        throw new Error();
      if (
        current.price &&
        body.rateKobo === current.price.rateKobo &&
        body.quantityPrecision === current.price.quantityPrecision
      ) {
        setError(
          "Nothing changed. Change the price or quantity precision before reviewing.",
        );
        return;
      }
      setSnapshot(structuredClone(current));
      setFrozen(freezeChange(`prices/${code}/activate`, body));
      setError("");
      mutation.reset();
      router.push(`/admin/prices/${code}/confirm`);
    } catch {
      setError(
        "Enter a positive price with at most two decimals, choose quantity decimal places and give a reason.",
      );
    }
  }
  function reload() {
    setFrozen(null);
    setSnapshot(null);
    setValue(null);
    setPrecision(null);
    source.reload(true);
    history.reload();
    mutation.reset();
    router.replace(`/admin/prices/${code}/edit`);
  }
  const reviewing = confirm || mutation.uncertain || mutation.blocked;
  const shown = reviewing ? (snapshot ?? current) : current;
  return (
    <>
      <PageHead
        title={`${current ? productNames[current.product.code] : code.toUpperCase()} price`}
        eyebrow="Product prices / Update price"
        subtitle={`${session?.station?.name ?? "Station"} · price per product`}
        back={{
          href: confirm ? `/admin/prices/${code}/edit` : "/admin/prices",
          label: confirm ? "Back to editor" : "Back to product prices",
        }}
      />
      <Loading {...source} label="Loading product settings…" />
      {!source.loading && source.data && !current && (
        <Notice tone="danger" role="alert">
          This product is unavailable.
        </Notice>
      )}
      {shown && (
        <>
          <div className="wr-two-col">
            <Sheet
              title={
                reviewing
                  ? "Confirm price change"
                  : "Update price and quantity precision"
              }
            >
              {reviewing ? (
                frozen ? (
                  <>
                    <span className="wr-pill wr-sm wr-held">
                      Not yet applied
                    </span>
                    <KeyValueList
                      items={[
                        {
                          label: "Product",
                          value: productNames[shown.product.code],
                        },
                        {
                          label: "Current price",
                          value: rate(shown.price, shown.product.unit),
                        },
                        {
                          label: "New price",
                          value: rate(
                            { rateKobo: frozen.body.rateKobo },
                            shown.product.unit,
                          ),
                        },
                        {
                          label: "Current quantity decimals",
                          value:
                            shown.price?.quantityPrecision ?? "Not configured",
                        },
                        {
                          label: "New quantity decimals",
                          value: frozen.body.quantityPrecision,
                        },
                        {
                          label: "Activation",
                          value:
                            "Immediately on successful server confirmation",
                        },
                        { label: "Scheduling", value: "Not in this release" },
                        {
                          label: "Applies to",
                          value:
                            shown.pumps.map((p) => p.name).join(", ") ||
                            "No pumps",
                        },
                        { label: "Reason", value: frozen.body.reason },
                      ]}
                    />
                    <Notice tone="warning">
                      Activation is immediate when the server accepts this
                      confirmation. New captures use the new settings; existing
                      purchases and sales already being entered keep their
                      captured rate. Offline mismatches follow price review.
                    </Notice>
                    <MutationState
                      state={mutation}
                      retry={() => void mutation.submit(frozen)}
                      reload={reload}
                    />
                    <div className="wr-station-actions">
                      <Button
                        loading={mutation.busy}
                        disabled={mutation.uncertain || mutation.blocked}
                        onClick={() => void mutation.submit(frozen)}
                      >
                        {mutation.busy ? "Activating…" : "Confirm new price"}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={
                          mutation.busy ||
                          mutation.uncertain ||
                          mutation.blocked
                        }
                        onClick={() => {
                          setFrozen(null);
                          mutation.reset();
                          router.push(`/admin/prices/${code}/edit`);
                        }}
                      >
                        Keep editing
                      </Button>
                      <Link href="/admin/prices">Cancel</Link>
                    </div>
                  </>
                ) : (
                  <>
                    <Notice role="alert">
                      Review this change again before confirming. No price has
                      been submitted by this view.
                    </Notice>
                    <Link href={`/admin/prices/${code}/edit`}>
                      Back to editor
                    </Link>
                  </>
                )
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    review();
                  }}
                >
                  <TextField
                    label="Current price"
                    value={rate(current?.price ?? null, shown.product.unit)}
                    readOnly
                  />
                  <TextField
                    label={`New price (₦ per ${shown.product.unit})`}
                    prefix="₦"
                    inputMode="decimal"
                    value={
                      value ??
                      (current?.price
                        ? priceEditorValue(current.price.rateKobo)
                        : "")
                    }
                    onChange={(e) => setValue(e.target.value)}
                    helper="Enter a positive naira amount with up to two decimal places."
                    required
                  />
                  <SelectField
                    label="Quantity decimal places"
                    value={
                      precision ??
                      (current?.price
                        ? String(current.price.quantityPrecision)
                        : "")
                    }
                    onChange={setPrecision}
                  >
                    <option value="">Select decimal places</option>
                    {[0, 1, 2, 3, 4, 5, 6].map((x) => (
                      <option key={x} value={String(x)}>
                        {x}
                      </option>
                    ))}
                  </SelectField>
                  <p className="wr-help">
                    Match the physical product meter. New captures use this
                    precision; existing sales keep their captured settings.
                  </p>
                  <Reason value={reason} onChange={setReason} />
                  <ErrorNotice error={error} />
                  <div className="wr-station-actions">
                    <Button type="submit">Review price change</Button>
                    <Link href="/admin/prices">Back</Link>
                  </div>
                </form>
              )}
            </Sheet>
            <Sheet title="Price scope" quiet>
              <KeyValueList
                items={[
                  { label: "Product", value: productNames[shown.product.code] },
                  {
                    label: "Station",
                    value: session?.station?.name ?? "Station",
                  },
                  { label: "Quantity unit", value: shown.product.unit },
                  {
                    label: "Quantity decimals",
                    value: shown.price?.quantityPrecision ?? "Not configured",
                  },
                  {
                    label: "Applies to",
                    value:
                      shown.pumps.map((p) => p.name).join(", ") || "No pumps",
                  },
                  {
                    label: "Activation",
                    value: "Immediately on server confirmation",
                  },
                  { label: "Scheduling", value: "Not in this release" },
                ]}
              />
              <p className="wr-help">
                Match the selling rate on the physical pump before recording new
                purchases. Activation uses trusted server time. Offline phones
                keep their captured settings until they reconnect.
              </p>
            </Sheet>
          </div>
          <PriceHistory {...history} items={history.data} />
        </>
      )}
    </>
  );
}

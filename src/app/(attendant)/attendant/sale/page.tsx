"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ScanLine, UserRoundPlus } from "lucide-react";
import {
  Button,
  TextField,
  SegmentedControl,
  Notice,
  PhotoCapture,
} from "@/ui";
import {
  markCaptureEnded,
  markCaptureStarted,
} from "@/client/sw/update-safety";
import { ClientError } from "@/client/types";
import { parseNaira, parseKobo, formatNaira } from "@/shared/money";
import {
  amountToQuantity,
  quantityToAmount,
  formatQuantity,
} from "@/shared/quantity";
import type {
  CaptureDraft,
  CapturedPhoto,
  Lookup,
  Medium,
} from "@/client/offline/client";
import {
  AccessGate,
  Frame,
  go,
  Assignment,
  useAttendant,
  message,
  categoryName,
  formatTime,
  useSaleHandoff,
} from "../_components/runtime";
import { Camera } from "../_components/camera";
import { Receipt } from "../_components/receipt";
import { formatAmountInput } from "../_components/amount-input";
import { DraftComposition } from "./draft-composition";
import { adoptedPriceNotices, retainedPriceWarnings } from "./price-notices";
function Sale() {
  const { client, state, online } = useAttendant();
  const router = useRouter();
  const handoff = useSaleHandoff();
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  const [card, setCard] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [resolvedCode, setResolvedCode] = useState("");
  const [notFound, setNotFound] = useState<{
    cardCode: string;
    source: "code" | "qr";
  } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const [basis, setBasis] = useState<"amount" | "quantity">("amount");
  const [value, setValue] = useState("");
  const [valueFocused, setValueFocused] = useState(false);
  const [medium, setMedium] = useState<Medium | "">(
    state!.session!.product.code === "cooking_gas" ? "cylinder" : "",
  );
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>();
  const [photoTime, setPhotoTime] = useState("");
  const [camera, setCamera] = useState<"photo" | "qr" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const composition = useRef(new DraftComposition());
  const selection = useRef<{ code: string; lookup: Lookup | null } | null>(
    null,
  );
  const [discarding, setDiscarding] = useState(false);
  const [hasComposition, setHasComposition] = useState(false);
  const request = useRef(0);
  const mounted = useRef(true);
  const saving = useRef(false);
  const accountId = state!.session!.account.id;
  const contextId = state!.session!.captureContextId;
  const ensureDraft = useCallback(async () => {
    if (!client) return null;
    setHasComposition(true);
    const selectedAtStart = selection.current;
    const next = await composition.current.start(
      async () => {
        const created = await client.beginCapture();
        return selectedAtStart
          ? client.selectLookup(
              created,
              selectedAtStart.code,
              selectedAtStart.lookup,
              { receiptAtComposition: true },
            )
          : created;
      },
      markCaptureStarted,
    );
    if (
      !next ||
      !mounted.current ||
      client.getState().access !== "active" ||
      client.getState().session?.account.id !== accountId ||
      client.getState().session?.captureContextId !== contextId
    )
      return null;
    const selected = selection.current
      ? client.selectLookup(
          next,
          selection.current.code,
          selection.current.lookup,
        )
      : next;
    composition.current.select(selected);
    setDraft(selected);
    return selected;
  }, [client, accountId, contextId]);
  useEffect(() => {
    let live = true;
    mounted.current = true;
    if (client) {
      void client.storageStatus().then((status) => {
        if (live) setStorageWarning(status.nearFull);
      });
      void (async () => {
        // Strict-mode setup/cleanup must not consume a handoff in a dead view.
        await Promise.resolve();
        if (!live) return;
        const current = client.getState().session;
        if (!current) return;
        const pending = handoff.take(current);
        if (!pending) return;
        markCaptureStarted();
        const generation = ++request.current;
        setCard(pending.cardCode);
        setFinding(true);
        try {
          const found = await client.lookupCurrent(pending.cardCode);
          if (
            !live ||
            generation !== request.current ||
            client.getState().access !== "active" ||
            client.getState().session?.captureContextId !== contextId
          )
            return;
          if (!found || found.customer.id !== pending.customerId) {
            setLookupError(
              "This customer has no usable matching card. Ask a station manager for help.",
            );
            return;
          }
          selection.current = { code: found.cardCode, lookup: found };
          const next = await ensureDraft();
          if (!next || !live || generation !== request.current) return;
          setLookup(found);
          setResolvedCode(found.cardCode);
        } catch (error) {
          await client.observeAuthorityError(error, current);
          if (live && generation === request.current)
            setLookupError(message(error));
        } finally {
          if (live && generation === request.current) setFinding(false);
        }
      })();
    }
    const activeComposition = composition.current;
    return () => {
      live = false;
      mounted.current = false;
      activeComposition.discard();
      markCaptureEnded();
    };
  }, [client, accountId, contextId, handoff, ensureDraft]);
  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);
  const currentPrice = state!.session!.price;
  const lastPrice = useRef(currentPrice);
  const [adoptionNotice, setAdoptionNotice] = useState<string[]>([]);
  useEffect(() => {
    const previous = lastPrice.current;
    if (currentPrice.version <= previous.version) return;
    lastPrice.current = currentPrice;
    setAdoptionNotice(
      adoptedPriceNotices(previous, currentPrice, state!.session!.product.unit),
    );
  }, [currentPrice, state]);
  const warnings = draft
    ? retainedPriceWarnings(
        draft.session.price,
        currentPrice,
        draft.session.product.unit,
      )
    : [];
  const notices = warnings.length ? warnings : adoptionNotice;
  const session = draft?.session ?? state!.session!;
  const gas = session.product.code === "cooking_gas";
  const unitLabel = gas ? "Kilograms" : "Litres";
  let calculation =
    basis === "amount" ? `About 0 ${gas ? "kg" : "litres"}` : formatNaira(0n);
  let validValue = false;
  let valueError: string | undefined;
  if (value) {
    try {
      const rate = parseKobo(session.price.rateKobo);
      calculation =
        basis === "amount"
          ? `About ${formatQuantity(amountToQuantity(parseNaira(value), rate, session.price.quantityPrecision), session.product.unit, session.price.quantityPrecision)}`
          : formatNaira(
              quantityToAmount(value, rate, session.price.quantityPrecision),
            );
      validValue = true;
    } catch {
      valueError =
        basis === "amount"
          ? "Enter a positive amount with no more than two decimal places."
          : `Enter a positive quantity with no more than ${session.price.quantityPrecision} decimal places.`;
    }
  }
  const customerReady = !!resolvedCode && !lookupError && (!online || !!lookup);
  const ready =
    !!draft &&
    customerReady &&
    validValue &&
    !!medium &&
    !!photo &&
    !finding &&
    !busy;
  async function find(code = card, source: "code" | "qr" = "code") {
    if (!client || saving.current) return;
    const generation = ++request.current;
    setFinding(true);
    setLookup(null);
    setResolvedCode("");
    setLookupError(null);
    setNotFound(null);
    try {
      const found = await client.lookup(code, source);
      if (
        !mounted.current ||
        generation !== request.current ||
        client.getState().session?.captureContextId !== contextId
      )
        return;
      const normalized = code.trim().toUpperCase();
      setCard(normalized);
      selection.current = { code: normalized, lookup: found };
      // A resolved customer starts composition only after lookup price adoption.
      // An uncached offline code alone does not freeze a draft.
      if (found || draft) {
        const next = await ensureDraft();
        if (!next || !mounted.current || generation !== request.current) return;
      }
      setResolvedCode(normalized);
      setLookup(found);
    } catch (e) {
      if (mounted.current && generation === request.current) {
        setLookupError(message(e));
        setNotFound(
          e instanceof ClientError && e.code === "customer_not_found"
            ? { cardCode: code.trim().toUpperCase(), source }
            : null,
        );
      }
    } finally {
      if (mounted.current && generation === request.current) setFinding(false);
    }
  }
  function changeCard() {
    // Initial typing is not a customer change: a photo may already be composed.
    // Changing an identified customer explicitly requires a fresh meter photo.
    if (selection.current || resolvedCode) {
      setPhoto(null);
      setPhotoUrl(undefined);
      setPhotoTime("");
    }
    selection.current = null;
    setNotFound(null);
    request.current++;
    setFinding(false);
    setLookup(null);
    setResolvedCode("");
    setLookupError(null);
  }
  async function startCamera(mode: "photo" | "qr") {
    if (!client) return;
    const generation = request.current;
    if (mode === "photo") markCaptureStarted();
    try {
      // Reserve the price at photo intent before any other asynchronous read.
      // beginCapture validates authority inside that same transaction.
      if (mode === "photo" && !(await ensureDraft())) return;
      // Existing drafts also need a fresh authority check before camera access.
      await client.checkAccess();
      if (
        client.getState().access !== "active" ||
        !mounted.current ||
        generation !== request.current ||
        client.getState().session?.captureContextId !== contextId
      )
        return;
      setCamera(mode);
    } catch (e) {
      setError(message(e));
    }
  }
  function composeInput() {
    void ensureDraft().catch((e) => {
      if (mounted.current) setError(message(e));
    });
  }
  function discardDraft() {
    if (saving.current) return;
    request.current++;
    composition.current.discard();
    selection.current = null;
    setDraft(null);
    setHasComposition(false);
    setCard("");
    setLookup(null);
    setResolvedCode("");
    setNotFound(null);
    setLookupError(null);
    setFinding(false);
    setBasis("amount");
    setValue("");
    setValueFocused(false);
    setMedium(state!.session!.product.code === "cooking_gas" ? "cylinder" : "");
    setPhoto(null);
    setPhotoUrl(undefined);
    setPhotoTime("");
    setCamera(null);
    setError(null);
    setDiscarding(false);
    setAdoptionNotice([]);
    markCaptureEnded();
  }
  async function save() {
    if (!client || !draft || !photo || !medium || !ready || saving.current)
      return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await client.saveCapture(draft, {
        cardCode: resolvedCode,
        customerCache: lookup,
        medium,
        basis,
        value,
        photo,
      });
      go(router, `/attendant/sale/${saved.operationId}/recorded`);
    } catch (e) {
      setError(message(e));
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Frame
      title="New sale"
      context={<Assignment session={session} />}
      action={
        <>
          {!customerReady && (
            <p className="wr-help">
              {lookupError
                ? "Resolve the customer to continue."
                : "Scan or enter a card to begin."}
            </p>
          )}
          <Button
            cta
            loading={busy}
            disabled={!ready}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : online ? "Save sale" : "Save sale on phone"}
          </Button>
          <p className="wr-help">
            Counts toward loyalty after the details and photo sync.
          </p>
        </>
      }
    >
      {!online && (
        <Notice tone="inverse">
          <b>Offline.</b> You can keep recording sales until{" "}
          <b>{formatTime(session.offlineExpiresAt)}</b> (24 hours after your
          last online sign-in). Sales and photos stay on this phone until they
          upload.
        </Notice>
      )}
      {storageWarning && (
        <Notice tone="warning">
          Phone storage is nearly full. Keep pending sales on this phone and ask
          your station admin for help.
        </Notice>
      )}
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      <section className="wr-section">
        <h2 className="wr-section-title">Customer</h2>
        {resolvedCode ? (
          <div className="wr-card wr-customer-card">
            <span className="wr-avatar" aria-hidden>
              {lookup
                ? lookup.customer.name
                    .split(/\s+/)
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join("")
                : "?"}
            </span>
            <div className="wr-customer-copy">
              <b>{lookup?.customer.name ?? "Pending lookup"}</b>
              <div className="wr-caption">
                {lookup && `${categoryName[lookup.customer.category]} · `}
                <span className="wr-mono">{resolvedCode}</span>
                {!online && lookup && " · from this phone's saved customers"}
              </div>
              {!lookup && (
                <p className="wr-help">
                  Customer lookup will finish when this sale uploads.
                </p>
              )}
            </div>
            <Button variant="link" disabled={busy} onClick={changeCard}>
              Change
            </Button>
          </div>
        ) : (
          <>
            <Button
              cta
              icon={<ScanLine aria-hidden />}
              disabled={busy}
              onClick={() => void startCamera("qr")}
            >
              Scan QR card
            </Button>
            <TextField
              label="Or enter the card number"
              mono
              autoCapitalize="characters"
              autoComplete="off"
              placeholder="e.g. A7K3M9Q"
              maxLength={32}
              value={card}
              disabled={busy}
              onChange={(event) => {
                changeCard();
                setCard(event.target.value);
              }}
              error={lookupError ?? undefined}
              action={
                <Button
                  variant="secondary"
                  loading={finding}
                  disabled={!card.trim() || busy}
                  onClick={() => void find()}
                >
                  {finding ? "Finding…" : "Find"}
                </Button>
              }
            />
            {notFound && (
              <>
                <Notice>
                  A card that is not yet linked must first be registered. If the
                  customer lost a card, an admin issues a replacement; the sale
                  cannot be recorded against the old card.
                </Notice>
                <div className="wr-row">
                  <Button
                    variant="secondary"
                    icon={<UserRoundPlus aria-hidden />}
                    onClick={() => {
                      handoff.offerRegistration({
                        accountId,
                        contextId,
                        ...notFound,
                      });
                      go(router, "/attendant/register");
                    }}
                  >
                    Register this customer
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </section>
      <section className="wr-section">
        <h2 className="wr-section-title">Purchase</h2>
        <div className="wr-field">
          <span className="wr-label">Enter sale by</span>
          <SegmentedControl
            label="Enter sale by"
            value={basis}
            disabled={busy}
            options={[
              { value: "amount", label: "Amount (₦)" },
              { value: "quantity", label: unitLabel },
            ]}
            onChange={(next) => {
              if (next !== basis) {
                setBasis(next as "amount" | "quantity");
                setValue("");
                setValueFocused(false);
              }
            }}
          />
          <p className="wr-help">Switching clears the typed value.</p>
        </div>
        {gas ? (
          <TextField
            label="Bought into"
            readOnly
            value="Cylinder"
            helper={`Cooking gas is always sold into a cylinder.${lookup ? ` The customer's category stays ${categoryName[lookup.customer.category]}.` : ""}`}
          />
        ) : (
          <div className="wr-field">
            <span className="wr-label">Bought into</span>
            <SegmentedControl
              label="Bought into"
              value={medium}
              disabled={busy}
              options={[
                { value: "vehicle", label: "Vehicle" },
                { value: "keg", label: "Keg" },
                { value: "three_wheeler", label: "3-wheeler" },
                { value: "bike", label: "Bike" },
              ]}
              onChange={(next) => {
                composeInput();
                setMedium(next as Medium);
              }}
            />
          </div>
        )}
        <TextField
          label={basis === "amount" ? "Amount (₦)" : unitLabel}
          aria-label={basis === "amount" ? "Amount in naira" : unitLabel}
          inputMode="decimal"
          value={
            basis === "amount" && !valueFocused
              ? formatAmountInput(value)
              : value
          }
          onFocus={() => setValueFocused(true)}
          onBlur={() => setValueFocused(false)}
          onChange={(event) => {
            if (event.target.value) composeInput();
            setValue(event.target.value);
          }}
          placeholder={basis === "amount" ? "0.00" : "0"}
          prefix={basis === "amount" ? "₦" : undefined}
          large
          maxLength={24}
          disabled={busy}
          error={valueError}
        />
        <div className="wr-card wr-quiet wr-calculated">
          <span className="wr-label">Calculated</span>
          <output className="wr-amount-md" aria-live="polite">
            {hasComposition && !draft ? "Preparing sale…" : calculation}
          </output>
        </div>
        <p className="wr-help">
          Rate:{" "}
          <b>
            {formatNaira(parseKobo(session.price.rateKobo))} /{" "}
            {gas ? "kg" : "litre"}
            {!online && ` · saved ${formatTime(session.price.fetchedAt)}`}
          </b>{" "}
          · Check both values against the meter.
        </p>
        {notices.map((notice) => (
          <Notice
            key={notice}
            tone={warnings.length ? "warning" : "info"}
            role="status"
          >
            {notice}
          </Notice>
        ))}
        {hasComposition && !discarding && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => setDiscarding(true)}
          >
            Discard and start a new sale
          </Button>
        )}
        {discarding && (
          <Notice tone="warning">
            <b>Discard this unsaved sale?</b>
            <p>
              This clears its values, customer selection and meter photo. Look
              up the card again and take a fresh photo for the new sale.
            </p>
            <Button variant="danger" disabled={busy} onClick={discardDraft}>
              Discard sale
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setDiscarding(false)}
            >
              Keep this sale
            </Button>
          </Notice>
        )}
      </section>
      <section className="wr-section">
        <h2 className="wr-section-title">
          Meter photo<span className="wr-caption">Required</span>
        </h2>
        <PhotoCapture
          src={photoUrl}
          takenAt={photoTime}
          onCapture={() => void startCamera("photo")}
          disabled={busy}
        />
      </section>
      {camera && (
        <Camera
          mode={camera}
          onClose={() => setCamera(null)}
          onPhoto={(captured) => {
            setPhoto(captured);
            setPhotoUrl(URL.createObjectURL(captured.blob));
            setPhotoTime(
              new Intl.DateTimeFormat("en-GB", {
                timeZone: "Africa/Lagos",
                hour: "2-digit",
                minute: "2-digit",
                hour12: true,
              })
                .format(new Date())
                .toUpperCase(),
            );
          }}
          onCode={(code) => void find(code, "qr")}
        />
      )}
    </Frame>
  );
}
export default function SalePage() {
  const pathname = usePathname();
  const recordedOperationId =
    pathname.match(/^\/attendant\/sale\/([^/]+)\/recorded\/?$/)?.[1] ?? null;
  return (
    <AccessGate>
      {recordedOperationId ? (
        <Receipt operationId={recordedOperationId} />
      ) : (
        <Sale />
      )}
    </AccessGate>
  );
}

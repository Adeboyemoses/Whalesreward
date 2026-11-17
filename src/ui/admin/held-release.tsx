"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import { Button, Notice, KeyValueList, TextField } from "@/ui";
import { Sheet, productNames, useViewGuard } from "./station-common";
import { useAdminSession } from "./session";
import { SaleStatus } from "./sales-common";
import { AdminError } from "@/client/admin-api";
import {
  AdminReleaseApi,
  releaseMessage,
  releaseMessages,
  releaseUncertain,
  type ReleaseKind,
  type ReleasePreparation,
  type ReleaseProposal,
  type FrozenRelease,
} from "@/client/admin-release-api";
import {
  emptyReleaseDraft,
  validateReleaseDraft,
  releaseCanPropose,
  releaseImpact,
  releaseConfirmLabels,
  type ReleaseDraft,
  type ReleaseErrors,
} from "@/client/admin-release-form";
import type { AdminSaleDetail } from "@/client/admin-sales-api";
import type { AdminSession } from "@/client/admin-session";
import { adminTime, adminAction } from "@/client/admin-display";
import {
  saleMoney,
  saleQuantity,
  saleRate,
  valuePair,
} from "@/client/sales-display";
import { formatNaira, parseKobo } from "@/shared/money";
import "./held-release.css";
const grants = {
  price: "priceReview",
  card: "cardEligibility",
  date: "dateReview",
  capture: "dateReview",
} as const;
const uncertainCopy =
  "We couldn't confirm whether this was recorded. Retry the same request to check its result.";
const ownCopy = "You can't approve your own proposal.";
export function HeldRelease(props: {
  sale: AdminSaleDetail;
  kind: ReleaseKind;
  session: AdminSession;
  onCurrentSale: (detail: AdminSaleDetail | null, failed?: boolean) => void;
  onProposingChange?: (proposing: boolean) => void;
}) {
  const state = useAdminSession();
  const proposalId = useSearchParams().get("proposal");
  const permitted =
    state.session?.account.id === props.session.account.id &&
    state.session?.permissions?.includes("sales") &&
    state.session.permissions.includes(grants[props.kind]);
  if (!permitted)
    return (
      <Notice tone="danger" role="alert">
        {state.session
          ? "You no longer have permission to review this sale."
          : "Sign in again to continue."}
      </Notice>
    );
  return (
    <ReleaseView
      key={`${props.sale.id}:${props.kind}:${proposalId ?? ""}:${state.epoch}`}
      {...props}
    />
  );
}
function ReleaseView({
  sale,
  kind,
  session,
  onCurrentSale,
  onProposingChange,
}: {
  sale: AdminSaleDetail;
  kind: ReleaseKind;
  session: AdminSession;
  onCurrentSale: (detail: AdminSaleDetail | null, failed?: boolean) => void;
  onProposingChange?: (proposing: boolean) => void;
}) {
  const { store } = useAdminSession(),
    capture = useViewGuard(),
    params = useSearchParams();
  const api = useMemo(() => new AdminReleaseApi(store.request), [store]);
  const actorId = session.account.id,
    requested = params.get("proposal");
  const [preparation, setPreparation] = useState<ReleasePreparation | null>(
      null,
    ),
    [proposals, setProposals] = useState<ReleaseProposal[]>([]),
    [selected, setSelected] = useState<ReleaseProposal | null>(null);
  const [cursor, setCursor] = useState<string | null>(null),
    [cursors, setCursors] = useState<(string | undefined)[]>([undefined]),
    [pageIndex, setPageIndex] = useState(0),
    [serial, setSerial] = useState(0);
  const [loading, setLoading] = useState(true),
    [readError, setReadError] = useState(""),
    [policyOff, setPolicyOff] = useState(false),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false);
  const [form, setForm] = useState(false),
    [draft, setDraft] = useState<ReleaseDraft>(emptyReleaseDraft),
    [errors, setErrors] = useState<ReleaseErrors>({}),
    [review, setReview] = useState(false);
  const [sheet, setSheet] = useState<{
      assetId: string;
      url: string;
      expiresAt?: string;
      retainedProposal?: ReleaseProposal;
    } | null>(null),
    [file, setFile] = useState<File | null>(null),
    [localUrl, setLocalUrl] = useState(""),
    [photoState, setPhotoState] = useState(""),
    [draftSheetReady, setDraftSheetReady] = useState(false),
    [busy, setBusy] = useState("");
  useEffect(() => {
    onProposingChange?.(form);
    return () => onProposingChange?.(false);
  }, [form, onProposingChange]);
  const cameraInput = useRef<HTMLInputElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const [decisionReason, setDecisionReason] = useState(""),
    [independentInspected, setIndependentInspected] = useState(false),
    [meterSeen, setMeterSeen] = useState(false),
    [sheetSeen, setSheetSeen] = useState(false);
  const [decisionReview, setDecisionReview] = useState<
      "approve" | "reject" | null
    >(null),
    [frozen, setFrozen] = useState<FrozenRelease | null>(null),
    [uncertain, setUncertain] = useState(false),
    [replayed, setReplayed] = useState(false),
    [current, setCurrent] = useState<AdminSaleDetail | null>(null),
    [currentFailed, setCurrentFailed] = useState(false);
  const uploadRef = useRef<{
    reserve: FrozenRelease;
    reservation?: { uploadId: string; assetId: string };
    finalize?: FrozenRelease;
    putDone?: boolean;
  } | null>(null);
  const lock = useRef(false),
    heading = useRef<HTMLHeadingElement>(null),
    summary = useRef<HTMLDivElement>(null),
    reviewButton = useRef<HTMLButtonElement>(null);
  const clearPhoto = () => {
    setSheet(null);
    setFile(null);
    setLocalUrl("");
    setPhotoState("");
    setDraftSheetReady(false);
    uploadRef.current = null;
    setDraft((d) => ({ ...d, inspected: false }));
  };
  useEffect(
    () => () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    },
    [localUrl],
  );
  useEffect(() => {
    const live = capture();
    void Promise.resolve().then(() => {
      if (!live()) return;
      setLoading(true);
      setReadError("");
      setPreparation(null);
      setPolicyOff(false);
      return Promise.allSettled([
        api.preparation(sale.id, kind),
        api.proposals(sale.id, cursors[pageIndex]),
        requested ? api.proposal(sale.id, requested) : Promise.resolve(null),
      ]).then(([p, h, chosen]) => {
        if (!live()) return;
        if (p.status === "fulfilled") setPreparation(p.value);
        else if (
          p.reason instanceof AdminError &&
          p.reason.code === "release_policy_unconfigured"
        )
          setPolicyOff(true);
        else if (!(
          p.reason instanceof AdminError && p.reason.code === "review_closed"
        )) {
          setError(releaseMessage(p.reason));
          if (releaseUncertain(p.reason))
            setReadError("Release details couldn't be loaded.");
        }
        if (h.status === "fulfilled") {
          setProposals(h.value.items);
          setCursor(h.value.nextCursor);
        } else {
          setProposals([]);
          setCursor(null);
          setReadError(
            h.reason instanceof AdminError && h.reason.code === "not_found"
              ? "This sale or proposal is unavailable."
              : "Release details couldn't be loaded.",
          );
        }
        if (chosen.status === "fulfilled" && chosen.value)
          setSelected(chosen.value);
        else if (requested && chosen.status === "rejected")
          setReadError(
            chosen.reason instanceof AdminError &&
              chosen.reason.code === "not_found"
              ? "This sale or proposal is unavailable."
              : "Release details couldn't be loaded.",
          );
        else if (h.status === "fulfilled")
          setSelected((previous) =>
            previous
              ? (h.value.items.find((x) => x.id === previous.id) ?? previous)
              : (h.value.items.find((x) => x.state === "pending") ?? null),
          );
        setLoading(false);
      });
    });
    // capture is intentionally sampled once per read, not a reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, sale.id, kind, requested, serial, pageIndex, cursors]);
  const pending =
    !!(current ?? sale).pendingRelease ||
    proposals.some((p) => p.state === "pending") ||
    selected?.state === "pending";
  const canPropose =
    !loading &&
    !readError &&
    releaseCanPropose(preparation, pending) &&
    !policyOff;
  const refresh = () => {
    if (uncertain) return;
    setStale(false);
    setError("");
    setReview(false);
    setDecisionReview(null);
    setFrozen(null);
    setIndependentInspected(false);
    setMeterSeen(false);
    setSheetSeen(false);
    setSerial((s) => s + 1);
    void refreshCurrent();
  };
  async function refreshCurrent() {
    const live = capture();
    setCurrentFailed(false);
    setCurrent(null);
    onCurrentSale(null);
    try {
      const fresh = await api.detail(sale.id);
      if (live()) {
        setCurrent(fresh);
        onCurrentSale(fresh);
      }
    } catch {
      if (live()) {
        setCurrent(null);
        setCurrentFailed(true);
        onCurrentSale(null, true);
      }
    }
  }
  function invalidatePreparation() {
    setPreparation(null);
    setLoading(true);
    setSerial((s) => s + 1);
  }
  function report(e: unknown) {
    setError(releaseMessage(e));
    if (e instanceof AdminError) {
      if (
        e.code === "proposal_stale" ||
        e.code === "version_conflict" ||
        e.code === "release_not_required"
      )
        setStale(true);
      if (e.code === "release_policy_unconfigured") setPolicyOff(true);
    }
  }
  async function choose(file: File | undefined) {
    if (!file || lock.current || uncertain) return;
    const live = capture();
    clearPhoto();
    try {
      if (file.type !== "image/jpeg" || file.size <= 0 || file.size > 8388608)
        throw new AdminError("photo_invalid", 422);
      const bitmap = await createImageBitmap(file);
      const valid =
        bitmap.width > 0 &&
        bitmap.height > 0 &&
        bitmap.width <= 6000 &&
        bitmap.height <= 6000 &&
        bitmap.width * bitmap.height <= 16000000;
      bitmap.close();
      if (!valid) throw new AdminError("photo_invalid", 422);
      if (live()) {
        setFile(file);
        setLocalUrl(URL.createObjectURL(file));
        setPhotoState("chosen");
        setError("");
      }
    } catch (e) {
      if (live()) {
        setPhotoState("invalid");
        report(
          e instanceof AdminError ? e : new AdminError("photo_invalid", 422),
        );
      }
    }
  }
  async function upload() {
    if (lock.current || !file || !preparation) return;
    lock.current = true;
    const live = capture();
    setError("");
    setBusy("Uploading sheet photo…");
    try {
      let flow = uploadRef.current;
      if (!flow) {
        const bytes = await file.arrayBuffer();
        if (!live()) return;
        const hash = await crypto.subtle.digest("SHA-256", bytes);
        if (!live()) return;
        const sha256 = Array.from(new Uint8Array(hash), (v) =>
          v.toString(16).padStart(2, "0"),
        ).join("");
        flow = {
          reserve: api.freezeRelease(actorId, sale.id, "reserve", {
            target: preparation.target,
            sha256,
            bytes: file.size,
            contentType: "image/jpeg",
          }),
        };
        uploadRef.current = flow;
      }
      if (!flow.reservation) {
        flow.reservation = await api.reserve(flow.reserve, actorId);
        if (!live()) return;
      }
      if (!flow.putDone) {
        const permission = await api.uploadUrl(
          sale.id,
          flow.reservation.uploadId,
          flow.reservation.assetId,
        );
        if (!live()) return;
        if (file.size > permission.maxBytes)
          throw new AdminError("photo_invalid", 422);
        let r: Response;
        try {
          r = await fetch(permission.url, {
            method: "PUT",
            body: file,
            headers: { "Content-Type": "image/jpeg" },
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
            referrerPolicy: "no-referrer",
          });
        } catch {
          throw new AdminError("storage_unavailable");
        }
        if (!live()) return;
        if (!r.ok)
          throw new AdminError(
            "storage_unavailable",
            r.status >= 500 ? r.status : 503,
          );
        flow.putDone = true;
      }
      if (!flow.finalize)
        flow.finalize = api.freezeRelease(
          actorId,
          sale.id,
          "finalize",
          {},
          `release-sheet-uploads/${encodeURIComponent(flow.reservation.uploadId)}/finalize`,
        );
      setBusy("Checking uploaded photo…");
      const result = await api.finalize(flow.finalize, actorId);
      if (!live()) return;
      if (result.assetId !== flow.reservation.assetId)
        throw new AdminError("invalid_response", 200);
      setSheet({ assetId: result.assetId, url: localUrl });
      setPhotoState("validated");
      setUncertain(false);
    } catch (e) {
      if (live()) {
        report(e);
        setUncertain(releaseUncertain(e));
        if (e instanceof AdminError && e.code === "upload_expired") {
          uploadRef.current = null;
          setPhotoState("expired");
        } else if (!releaseUncertain(e)) setPhotoState("invalid");
      }
    } finally {
      lock.current = false;
      if (live()) setBusy("");
    }
  }
  async function reuse(p: ReleaseProposal) {
    if (lock.current || uncertain) return;
    lock.current = true;
    const live = capture();
    setBusy("Loading retained sheet photo…");
    setError("");
    try {
      const access = await api.sheetAccess(sale.id, p);
      if (live()) {
        clearPhoto();
        setSheet({ ...access, retainedProposal: p });
        setPhotoState("validated");
      }
    } catch (e) {
      if (live()) report(e);
    } finally {
      lock.current = false;
      if (live()) setBusy("");
    }
  }
  const invalidateSheetInspection = () => {
    setDraft((d) => ({ ...d, inspected: false }));
    setDraftSheetReady(false);
    setReview(false);
  };
  const reloadRetainedSheet = sheet?.retainedProposal
    ? async () => {
        const live = capture();
        const access = await api.sheetAccess(sale.id, sheet.retainedProposal!);
        if (!live()) throw new AdminError("obsolete");
        invalidateSheetInspection();
        setSheet({ ...access, retainedProposal: sheet.retainedProposal });
        return access;
      }
    : undefined;
  const sheetAccessKey = sheet
    ? `${sheet.assetId}:${sheet.url}:${sheet.expiresAt ?? ""}`
    : localUrl;
  function reviewProposal() {
    if (!preparation || !canPropose || busy || uncertain) return;
    const checked = validateReleaseDraft(
      draft,
      preparation,
      sheet?.assetId ?? null,
    );
    if (!draftSheetReady)
      checked.errors.photo =
        "Load and inspect the sheet photo before reviewing.";
    setErrors(checked.errors);
    if (!checked.input || !draftSheetReady) {
      queueMicrotask(() => summary.current?.focus());
      return;
    }
    setReview(true);
    setError("");
    queueMicrotask(() => heading.current?.focus());
  }
  async function propose(retry = false) {
    if (lock.current || !preparation || (!retry && !draftSheetReady)) return;
    let request = frozen;
    if (!retry) {
      if (!canPropose) return;
      const checked = validateReleaseDraft(
        draft,
        preparation,
        sheet?.assetId ?? null,
      );
      if (!checked.input) {
        setErrors(checked.errors);
        return;
      }
      request = api.freezeProposal(actorId, sale.id, checked.input);
      setFrozen(request);
    }
    if (!request || request.kind !== "propose") return;
    lock.current = true;
    const live = capture();
    setBusy("Sending proposal…");
    setError("");
    try {
      const p = await api.propose(request, actorId);
      if (!live()) return;
      setSelected(p);
      setProposals((rows) => [p, ...rows.filter((x) => x.id !== p.id)]);
      setForm(false);
      setReview(false);
      setUncertain(false);
      setFrozen(null);
      setReplayed(retry);
      clearPhoto();
      setDraft(emptyReleaseDraft());
      invalidatePreparation();
      void refreshCurrent();
    } catch (e) {
      if (live()) {
        report(e);
        setUncertain(releaseUncertain(e));
        if (!releaseUncertain(e)) {
          setFrozen(null);
          setReview(false);
        }
      }
    } finally {
      lock.current = false;
      if (live()) setBusy("");
    }
  }
  async function prepareDecision(outcome: "approve" | "reject") {
    if (!selected || lock.current || uncertain) return;
    if (!/^[^\u0000-\u001f\u007f]{1,1000}$/u.test(decisionReason.trim())) {
      setError("Enter a reason of 1 to 1,000 characters.");
      document.getElementById("release-decision-reason")?.focus();
      return;
    }
    if (
      outcome === "approve" &&
      (!independentInspected || !meterSeen || !sheetSeen || policyOff)
    )
      return;
    lock.current = true;
    const live = capture();
    setBusy("Loading current sale guards…");
    setError("");
    try {
      const [fresh, p] = await Promise.all([
        api.detail(sale.id),
        api.proposal(sale.id, selected.id),
      ]);
      if (!live()) return;
      setCurrent(fresh);
      onCurrentSale(fresh);
      setSelected(p);
      if (p.state !== "pending") throw new AdminError("review_closed", 409);
      setFrozen(
        api.freezeDecision(actorId, fresh, p, outcome, decisionReason.trim()),
      );
      setDecisionReview(outcome);
      queueMicrotask(() => heading.current?.focus());
    } catch (e) {
      if (live()) report(e);
    } finally {
      lock.current = false;
      if (live()) setBusy("");
    }
  }
  function invalidateIndependentInspection() {
    setIndependentInspected(false);
    // A request already sent retains its frozen identity for uncertain-result recovery.
    if (
      !uncertain &&
      !lock.current &&
      frozen?.kind === "decide" &&
      frozen.body.outcome === "approve"
    ) {
      setDecisionReview(null);
      setFrozen(null);
    }
  }
  const approvalReady =
    independentInspected && meterSeen && sheetSeen && !policyOff && !stale;
  async function decide(retry = false) {
    if (lock.current || !frozen || frozen.kind !== "decide") return;
    if (!retry && frozen.body.outcome === "approve" && !approvalReady) {
      invalidateIndependentInspection();
      setError(
        "Required evidence is unavailable. This sale cannot be approved from this proposal.",
      );
      return;
    }
    lock.current = true;
    const live = capture();
    setBusy("Recording decision…");
    setError("");
    try {
      const result = await api.decideRelease(frozen, actorId);
      if (!live()) return;
      setSelected(result.proposal);
      setProposals((rows) => [
        result.proposal,
        ...rows.filter((p) => p.id !== result.proposal.id),
      ]);
      setDecisionReview(null);
      setFrozen(null);
      setUncertain(false);
      setStale(false);
      setReplayed(retry);
      setIndependentInspected(false);
      setSheetSeen(false);
      setMeterSeen(false);
      invalidatePreparation();
      void refreshCurrent();
    } catch (e) {
      if (live()) {
        report(e);
        setUncertain(releaseUncertain(e));
        if (!releaseUncertain(e)) {
          setFrozen(null);
          setDecisionReview(null);
        }
      }
    } finally {
      lock.current = false;
      if (live()) setBusy("");
    }
  }
  const originalMeter = useCallback(
    () =>
      sale.evidence.assetId
        ? api.photoAccess(sale.id, sale.evidence.assetId)
        : Promise.reject(new AdminError("evidence_unavailable", 404)),
    [api, sale.id, sale.evidence.assetId],
  );
  const selectedSheet = useCallback(
    () =>
      selected
        ? api.sheetAccess(sale.id, selected)
        : Promise.reject(new AdminError("evidence_unavailable", 404)),
    [api, sale.id, selected],
  );
  const update = (key: keyof ReleaseDraft, value: string | boolean) => {
    setDraft((d) => ({
      ...d,
      [key]: value,
      ...(key === "finding" ? { outcome: "" } : {}),
    }));
  };
  const change =
    <K extends keyof ReleaseDraft>(key: K) =>
    (value: ReleaseDraft[K]) =>
      update(key, value);
  const disabled = !!busy || uncertain;
  const self =
    selected &&
    (selected.proposedBy.id === actorId ||
      selected.proposedBy.id === session.account.adminId);
  const proposalInput = preparation
    ? validateReleaseDraft(draft, preparation, sheet?.assetId ?? null).input
    : null;
  const canDecide = selected?.state === "pending" && !self && !disabled;
  return (
    <div className="wr-release" aria-label="Two-person release">
      {loading && (
        <>
          <Notice role="status">Loading release details…</Notice>
          <Button disabled>Propose a release with a sheet photo</Button>
        </>
      )}
      {readError && (
        <Notice tone="danger" role="alert">
          {readError}
          <Button variant="secondary" onClick={refresh} disabled={disabled}>
            Try again
          </Button>
        </Notice>
      )}
      {policyOff && (
        <Notice>{releaseMessages.release_policy_unconfigured}</Notice>
      )}
      {stale && (
        <Notice tone="warning">
          <b>This proposal needs a fresh review</b>
          <p>
            It remains pending until an authorized independent rejection or
            recorded supersession closes it.
          </p>
          <Button variant="secondary" disabled={disabled} onClick={refresh}>
            Refresh sale
          </Button>
        </Notice>
      )}
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {busy && <p role="status">{busy}</p>}
      {uncertain && (
        <Notice tone="warning" role="alert">
          {uncertainCopy}
          <Button
            disabled={!!busy}
            variant="secondary"
            onClick={() =>
              void (frozen?.kind === "propose"
                ? propose(true)
                : frozen?.kind === "decide"
                  ? decide(true)
                  : upload())
            }
          >
            {frozen?.kind === "propose"
              ? "Retry same proposal"
              : frozen?.kind === "decide"
                ? "Retry same decision"
                : "Retry same photo upload"}
          </Button>
        </Notice>
      )}
      {!loading && !form && !readError && (
        <Sheet title="Records can't settle this">
          <p>
            If a matching shift-sheet or sales-log entry can settle this review,
            propose a release for another person to check. The sale stays held
            until a decision is recorded.
          </p>
          {preparation && !preparation.proposerAccess.allowed && (
            <Notice>
              {releaseMessages[preparation.proposerAccess.reason]}
            </Notice>
          )}
          {preparation &&
            preparation.admission.state === "ordinary_review_required" && (
              <p>The records can settle this through the ordinary review.</p>
            )}
          {preparation && preparation.admission.state === "not_admissible" && (
            <p>
              The records do not admit a two-person release. Continue ordinary
              review or leave the sale held.
            </p>
          )}
          {pending && (
            <p>
              This sale already has a pending proposal. A different authorized
              person must decide it first.
            </p>
          )}
          <Button
            disabled={!canPropose || disabled}
            onClick={() => {
              setForm(true);
              setDraft(emptyReleaseDraft());
              setError("");
              setErrors({});
              clearPhoto();
            }}
          >
            Propose a release with a sheet photo
          </Button>
          <p className="wr-help">
            This sale stays held until a different authorized person can review
            it.
          </p>
        </Sheet>
      )}
      {form && preparation && (
        <Sheet title={review ? "Review proposal" : "Propose a release"}>
          <h3 ref={heading} tabIndex={-1}>
            {review
              ? "Review proposal"
              : "This proposal will not credit or cancel the sale."}
          </h3>
          {review && proposalInput ? (
            <>
              <Comparison
                sale={sale}
                preparation={preparation}
                facts={proposalInput.facts}
                outcome={proposalInput.outcome}
                reason={proposalInput.reason}
                precision={
                  draft.timeMode === "date"
                    ? "Date only"
                    : adminAction(draft.precision)
                }
              />
              <PhotoViewer
                key={sheetAccessKey}
                local={sheet?.url}
                expiresAt={sheet?.expiresAt}
                load={reloadRetainedSheet}
                onInvalidated={invalidateSheetInspection}
                onReady={setDraftSheetReady}
                title="Sheet photo"
                alt={`Sheet entry for sale ${sale.saleCode}`}
              />
              <Impact kind={kind} outcome={proposalInput.outcome} />
              <p>
                I have inspected the sheet photo. The facts and time precision
                above are legible and faithfully copied.
              </p>
              <div className="wr-release-actions">
                <Button
                  disabled={disabled || !draftSheetReady}
                  onClick={() => void propose()}
                >
                  Confirm proposal
                </Button>
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => {
                    setReview(false);
                    queueMicrotask(() => reviewButton.current?.focus());
                  }}
                >
                  Keep reviewing
                </Button>
              </div>
            </>
          ) : (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                reviewProposal();
              }}
            >
              {Object.keys(errors).length > 0 && (
                <div
                  className="wr-release-errors"
                  role="alert"
                  ref={summary}
                  tabIndex={-1}
                >
                  <b>Check the marked fields before reviewing.</b>
                  <ul>
                    {Object.entries(errors).map(([key, msg]) => (
                      <li key={key}>
                        <a href={`#release-${key}`}>{msg}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <fieldset disabled={disabled}>
                <legend>Entry must match this sale</legend>
                <section id="release-photo" aria-label="Sheet photo">
                  <h3>Sheet photo</h3>
                  <p>
                    Frame one entry and the headings needed to read it. Keep
                    other customers and contact details out of the photo.
                  </p>
                  <p className="wr-help">
                    One JPEG, up to 8 MiB, 16 million pixels and 6,000 pixels on
                    either side.
                  </p>
                  {!sheet && !localUrl && <p>No sheet photo chosen.</p>}
                  <div className="wr-release-actions">
                    <Button
                      variant="secondary"
                      aria-controls="release-sheet-camera"
                      onClick={() => cameraInput.current?.click()}
                    >
                      Take sheet photo
                    </Button>
                    <input
                      ref={cameraInput}
                      id="release-sheet-camera"
                      className="wr-visually-hidden"
                      tabIndex={-1}
                      aria-label="Take sheet photo"
                      type="file"
                      accept="image/jpeg"
                      capture="environment"
                      onChange={(e) => void choose(e.target.files?.[0])}
                    />
                    <Button
                      variant="secondary"
                      aria-controls="release-sheet-file"
                      onClick={() => fileInput.current?.click()}
                    >
                      Choose JPEG
                    </Button>
                    <input
                      ref={fileInput}
                      id="release-sheet-file"
                      className="wr-visually-hidden"
                      tabIndex={-1}
                      aria-label="Choose JPEG"
                      type="file"
                      accept="image/jpeg"
                      onChange={(e) => void choose(e.target.files?.[0])}
                    />
                  </div>
                  {(sheet || localUrl) && (
                    <>
                      <PhotoViewer
                        key={sheetAccessKey}
                        local={sheet?.url ?? localUrl}
                        expiresAt={sheet?.expiresAt}
                        load={reloadRetainedSheet}
                        onInvalidated={invalidateSheetInspection}
                        onReady={setDraftSheetReady}
                        title="Sheet photo preview"
                        alt={`Sheet entry for sale ${sale.saleCode}`}
                      />
                      <p>
                        Check that the complete entry is readable before
                        uploading.
                      </p>
                    </>
                  )}
                  {file && photoState !== "validated" && (
                    <Button variant="secondary" onClick={() => void upload()}>
                      Use this photo
                    </Button>
                  )}
                  {photoState === "validated" && (
                    <Notice>
                      <b>Photo received · entry still needs review</b>
                      <p>
                        Receiving a photo does not verify its contents or
                        release the sale.
                      </p>
                    </Notice>
                  )}
                  {photoState === "expired" && (
                    <p>This upload expired. Start a new photo upload.</p>
                  )}
                  {(sheet || file) && (
                    <Button variant="secondary" onClick={clearPhoto}>
                      Choose another photo
                    </Button>
                  )}
                  {errors.photo && (
                    <p className="wr-help wr-error">{errors.photo}</p>
                  )}
                  {proposals.length > 0 && (
                    <div>
                      <h4>Use a retained sheet photo</h4>
                      {proposals
                        .filter(
                          (p, i, a) =>
                            a.findIndex(
                              (x) => x.sheetAssetId === p.sheetAssetId,
                            ) === i,
                        )
                        .map((p) => (
                          <Button
                            key={p.id}
                            variant="secondary"
                            onClick={() => void reuse(p)}
                          >
                            Use sheet photo proposed {adminTime(p.proposedAt)}
                          </Button>
                        ))}
                    </div>
                  )}
                </section>
                <KeyValueList
                  items={[
                    {
                      label: "Station / pump",
                      value: `${sale.station.code} · ${sale.pump.code}`,
                    },
                    { label: "Product", value: productNames[sale.product] },
                    {
                      label: "Original attendant",
                      value: `${sale.seller.name} · ${sale.seller.staffCode}`,
                    },
                    {
                      label: "Customer / captured card",
                      value: `${sale.customer?.name ?? "Customer pending"} · ${sale.capturedCardCode}`,
                    },
                    {
                      label: "Original purchase",
                      value: valuePair(preparation.original),
                    },
                    {
                      label: "Currently recorded",
                      value: valuePair(preparation.currentCandidate.values),
                    },
                  ]}
                />
                <Choice
                  id="source"
                  label="Record type"
                  value={draft.source}
                  onChange={change("source")}
                  error={errors.source}
                  choices={[
                    ["shift_sheet", "Shift sheet"],
                    ["sales_log", "Sales log"],
                  ]}
                />
                <TextField
                  id="release-entryReference"
                  label="Entry reference"
                  value={draft.entryReference}
                  onChange={(e) => update("entryReference", e.target.value)}
                  error={errors.entryReference}
                  helper="Use a page and entry reference. Do not enter a link, phone number or email address."
                  maxLength={120}
                />
                <p>
                  Copy only values visible in the entry. Do not calculate
                  missing values or change this sale&apos;s numbers.
                </p>
                <Numeric
                  label="Amount written in the entry (₦)"
                  field="amount"
                  draft={draft}
                  update={update}
                  error={errors.amount}
                />
                <Numeric
                  label={`Quantity written in the entry (${sale.original.unit === "litre" ? "litres" : "kilograms"})`}
                  field="quantity"
                  draft={draft}
                  update={update}
                  error={errors.quantity}
                  helper={`Up to ${sale.original.quantityPrecision} decimals, as captured.`}
                />
                <Numeric
                  label={`Rate written in the entry (₦ / ${sale.original.unit === "litre" ? "litre" : "kilogram"})`}
                  field="rate"
                  draft={draft}
                  update={update}
                  error={errors.rate}
                  helper={
                    kind === "price"
                      ? "The written rate must match the captured rate."
                      : undefined
                  }
                />
                {errors.numbers && (
                  <p id="release-numbers" className="wr-help wr-error">
                    {errors.numbers}
                  </p>
                )}
                <Choice
                  id="timeMode"
                  label="Time detail shown in the entry"
                  value={draft.timeMode}
                  onChange={change("timeMode")}
                  error={errors.timeMode}
                  choices={[
                    ["date", "Date only"],
                    ["range", "Time range"],
                  ]}
                  helper="Use the full range the entry supports. Do not guess a time."
                />
                <p>Africa/Lagos (UTC+01:00)</p>
                {draft.timeMode === "date" && (
                  <TextField
                    id="release-date"
                    label="Sale date in the entry"
                    type="date"
                    value={draft.date}
                    onChange={(e) => update("date", e.target.value)}
                  />
                )}
                {draft.timeMode === "range" && (
                  <>
                    <Choice
                      id="precision"
                      label="Time precision shown"
                      value={draft.precision}
                      onChange={change("precision")}
                      choices={[
                        ["minute", "Minute"],
                        ["second", "Second"],
                        ["millisecond", "Millisecond"],
                      ]}
                    />
                    <fieldset>
                      <legend>Earliest supported date and time</legend>
                      <TextField
                        label="Earliest supported date"
                        type="date"
                        value={draft.fromDate}
                        onChange={(e) => update("fromDate", e.target.value)}
                      />
                      <TextField
                        label="Earliest supported time"
                        type="time"
                        step={
                          draft.precision === "millisecond"
                            ? "0.001"
                            : draft.precision === "second"
                              ? "1"
                              : "60"
                        }
                        value={draft.fromTime}
                        onChange={(e) => update("fromTime", e.target.value)}
                      />
                    </fieldset>
                    <fieldset>
                      <legend>Latest supported date and time</legend>
                      <TextField
                        label="Latest supported date"
                        type="date"
                        value={draft.throughDate}
                        onChange={(e) => update("throughDate", e.target.value)}
                      />
                      <TextField
                        label="Latest supported time"
                        type="time"
                        step={
                          draft.precision === "millisecond"
                            ? "0.001"
                            : draft.precision === "second"
                              ? "1"
                              : "60"
                        }
                        value={draft.throughTime}
                        onChange={(e) => update("throughTime", e.target.value)}
                      />
                    </fieldset>
                  </>
                )}
                <Choice
                  id="finding"
                  label="What does the entry say?"
                  value={draft.finding}
                  onChange={change("finding")}
                  error={errors.finding}
                  choices={[
                    ["sale_recorded", "Sale recorded"],
                    ["entry_marked_void", "Entry marked void or erroneous"],
                  ]}
                />
                <Choice
                  id="outcome"
                  label="Proposed outcome"
                  value={draft.outcome}
                  onChange={change("outcome")}
                  error={errors.outcome}
                  choices={
                    draft.finding === "sale_recorded"
                      ? [["confirm", releaseConfirmLabels[kind]]]
                      : draft.finding === "entry_marked_void"
                        ? [["cancel", "Cancel this invalid sale"]]
                        : []
                  }
                  helper="Cancellation needs a matching entry explicitly marked void or erroneous. A missing entry or uncertain timing is not enough."
                />
                <ReasonInput
                  id="release-reason"
                  label="Proposal reason"
                  value={draft.reason}
                  onChange={change("reason")}
                  error={errors.reason}
                  helper="Explain how the entry supports this outcome. Do not include phone numbers or secrets."
                />
                <label className="wr-release-check" id="release-inspected">
                  <input
                    type="checkbox"
                    checked={draft.inspected}
                    disabled={!draftSheetReady}
                    onChange={(e) => update("inspected", e.target.checked)}
                  />
                  I have inspected the sheet photo. The facts and time precision
                  above are legible and faithfully copied.
                </label>
                {errors.inspected && (
                  <p className="wr-help wr-error">{errors.inspected}</p>
                )}
              </fieldset>
              <div className="wr-release-actions">
                <button
                  ref={reviewButton}
                  className="wr-btn wr-btn-primary"
                  type="submit"
                  disabled={disabled || !canPropose}
                >
                  Review proposal
                </button>
                <Button
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => {
                    setForm(false);
                    setDraft(emptyReleaseDraft());
                    clearPhoto();
                    setErrors({});
                  }}
                >
                  Discard changes
                </Button>
              </div>
            </form>
          )}
        </Sheet>
      )}
      {!loading && !readError && (
        <Sheet title="Release proposals">
          {proposals.length === 0 && !selected && (
            <p>No release proposals recorded.</p>
          )}
          {proposals.map((p) => (
            <div className="wr-release-timeline" key={p.id}>
              <b>
                {p.state === "pending"
                  ? "Awaiting another reviewer"
                  : p.state === "approved"
                    ? "Release decision recorded"
                    : p.state === "rejected"
                      ? "Proposal rejected"
                      : "Proposal superseded"}
              </b>
              <p>
                Proposed by {p.proposedBy.name} · {p.proposedBy.code}
              </p>
              <p>
                Proposed at {adminTime(p.proposedAt)} ·{" "}
                {adminAction(p.target.kind)} ·{" "}
                {p.outcome === "cancel"
                  ? "Cancel this invalid sale"
                  : releaseConfirmLabels[p.target.kind]}
              </p>
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => {
                  setSelected(p);
                  setIndependentInspected(false);
                  setMeterSeen(false);
                  setSheetSeen(false);
                  setError("");
                }}
              >
                View proposal
              </Button>
            </div>
          ))}
          <div className="wr-release-actions">
            {pageIndex > 0 && (
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => setPageIndex((i) => i - 1)}
              >
                Newer proposals
              </Button>
            )}
            {cursor && (
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => {
                  setCursors((c) => [...c.slice(0, pageIndex + 1), cursor]);
                  setPageIndex((i) => i + 1);
                }}
              >
                Older proposals
              </Button>
            )}
          </div>
          <p className="wr-help">
            This page shows up to 25 proposals. Use older proposals for earlier
            history.
          </p>
        </Sheet>
      )}
      {selected && (
        <Sheet
          title={
            selected.state === "pending"
              ? "Review release proposal"
              : selected.state === "approved"
                ? "Release decision recorded"
                : selected.state === "rejected"
                  ? "Proposal rejected"
                  : "Proposal superseded"
          }
        >
          {selected.state === "pending" && (
            <Notice>
              <b>Awaiting another reviewer</b>
              <p>This proposal has not released the sale.</p>
              <p>Check the entry and facts independently before deciding.</p>
            </Notice>
          )}
          {selected.state === "rejected" && (
            <Notice>
              This proposal changed no sale values or holds. Check the current
              sale status below.
            </Notice>
          )}
          {selected.state === "superseded" && (
            <Notice>
              Another recorded action closed this review. This proposal was not
              approved or rejected.
            </Notice>
          )}
          {selected.state === "approved" && (
            <RecordedRelease proposal={selected} />
          )}
          {replayed && (
            <p>
              This is the original recorded result. The sale may have changed
              since then.
            </p>
          )}
          <Comparison
            sale={sale}
            preparation={preparation}
            facts={selected.facts}
            outcome={selected.outcome}
            reason={selected.reason}
          />
          <div className="wr-release-images">
            <PhotoViewer
              key={`meter-${selected.id}`}
              load={originalMeter}
              title="Original meter photo"
              alt={`Original meter evidence for sale ${sale.saleCode}`}
              onReady={setMeterSeen}
              onInvalidated={invalidateIndependentInspection}
            />
            <PhotoViewer
              key={`sheet-${selected.id}`}
              load={selectedSheet}
              title="Sheet photo"
              alt={`Sheet entry for sale ${sale.saleCode}`}
              onReady={setSheetSeen}
              onInvalidated={invalidateIndependentInspection}
            />
          </div>
          <div className="wr-release-timeline">
            <p>
              Proposed by {selected.proposedBy.name} ·{" "}
              {selected.proposedBy.code}
            </p>
            <p>{adminTime(selected.proposedAt)}</p>
            <p>Proposal reason: {selected.reason}</p>
            {selected.decision && (
              <>
                <p>
                  {selected.decision.outcome === "approve"
                    ? "Approved"
                    : "Rejected"}{" "}
                  by {selected.decision.actor.name} ·{" "}
                  {selected.decision.actor.code}
                </p>
                <p>{adminTime(selected.decision.decidedAt)}</p>
                <p>Decision reason: {selected.decision.reason}</p>
              </>
            )}
            {selected.state === "superseded" && (
              <>
                <p>Superseded by a recorded sale action</p>
                <p>Supersession time unavailable</p>
              </>
            )}
          </div>
          {selected.state === "pending" &&
            (self ? (
              <Notice>
                {ownCopy}
                <p>
                  A different person with this review permission must decide it.
                  Signing in with another account does not make you a different
                  reviewer.
                </p>
              </Notice>
            ) : decisionReview ? (
              <>
                <h3 ref={heading} tabIndex={-1}>
                  {decisionReview === "approve"
                    ? "Review approval"
                    : "Review rejection"}
                </h3>
                <p>
                  {decisionReview === "reject"
                    ? "Reject this proposal. It changes no sale values or holds. The sale may still need review."
                    : releaseImpact(selected.target.kind, selected.outcome)}
                </p>
                <p>
                  Proposed by {selected.proposedBy.name} ·{" "}
                  {selected.proposedBy.code}
                </p>
                <p>
                  {decisionReview === "approve" ? "Approving" : "Rejecting"} as{" "}
                  {session.account.name} · {session.account.username}
                </p>
                <p>Decision reason: {String(frozen?.body.reason ?? "")}</p>
                {decisionReview === "approve" && (
                  <p>
                    I have independently inspected the sheet photo. The facts
                    and time precision are legible and faithfully copied.
                  </p>
                )}
                <div className="wr-release-actions">
                  <Button
                    disabled={
                      disabled ||
                      (decisionReview === "approve" && !approvalReady)
                    }
                    onClick={() => void decide()}
                  >
                    Confirm decision
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => {
                      setDecisionReview(null);
                      setFrozen(null);
                      document
                        .getElementById("release-decision-reason")
                        ?.focus();
                    }}
                  >
                    Keep reviewing
                  </Button>
                </div>
              </>
            ) : (
              <>
                <ReasonInput
                  id="release-decision-reason"
                  label="Decision reason"
                  value={decisionReason}
                  onChange={setDecisionReason}
                  disabled={disabled}
                  helper="Explain your own decision. Do not repeat a reason you cannot verify."
                />
                <label className="wr-release-check">
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={independentInspected}
                    onChange={(e) => setIndependentInspected(e.target.checked)}
                  />
                  I have independently inspected the sheet photo. The facts and
                  time precision are legible and faithfully copied.
                </label>
                {(!sheetSeen || !meterSeen || !independentInspected) && (
                  <p className="wr-help">
                    Approval needs both retained photos and your independent
                    inspection.
                  </p>
                )}
                <div className="wr-release-actions">
                  <Button
                    disabled={
                      !canDecide ||
                      policyOff ||
                      stale ||
                      !independentInspected ||
                      !meterSeen ||
                      !sheetSeen
                    }
                    onClick={() => void prepareDecision("approve")}
                  >
                    Approve proposal
                  </Button>
                  <Button
                    variant="danger"
                    disabled={!canDecide}
                    onClick={() => void prepareDecision("reject")}
                  >
                    Reject proposal
                  </Button>
                </div>
              </>
            ))}
          <Button variant="secondary" disabled={disabled} onClick={refresh}>
            Refresh sale
          </Button>
          {(current || currentFailed) && (
            <section aria-label="Current sale status">
              <h3>Current sale status</h3>
              {current ? (
                <>
                  <SaleStatus sale={current} />
                  <KeyValueList
                    items={[
                      {
                        label: "Currently recorded",
                        value: valuePair(current.displayedValues),
                      },
                      {
                        label: "Loyalty credit",
                        value: current.credited
                          ? "Recorded spend included"
                          : "Not credited",
                      },
                    ]}
                  />
                </>
              ) : (
                <p>
                  Decision recorded. Current sale status couldn&apos;t be
                  refreshed.
                </p>
              )}
            </section>
          )}
        </Sheet>
      )}
    </div>
  );
}
function Choice<T extends string>({
  id,
  label,
  value,
  onChange,
  choices,
  error,
  helper,
}: {
  id: string;
  label: string;
  value: T;
  onChange: (v: T) => void;
  choices: [string, string][];
  error?: string;
  helper?: string;
}) {
  return (
    <fieldset
      id={`release-${id}`}
      aria-describedby={
        error
          ? `release-${id}-error`
          : helper
            ? `release-${id}-help`
            : undefined
      }
      aria-invalid={!!error}
    >
      <legend>{label}</legend>
      {choices.map(([v, text]) => (
        <label className="wr-release-check" key={v}>
          <input
            type="radio"
            name={`release-${id}`}
            value={v}
            checked={value === v}
            onChange={() => onChange(v as T)}
          />
          {text}
        </label>
      ))}
      {helper && (
        <p className="wr-help" id={`release-${id}-help`}>
          {helper}
        </p>
      )}
      {error && (
        <p className="wr-help wr-error" id={`release-${id}-error`}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
function Numeric({
  label,
  field,
  draft,
  update,
  error,
  helper,
}: {
  label: string;
  field: "amount" | "quantity" | "rate";
  draft: ReleaseDraft;
  update: (key: keyof ReleaseDraft, value: string | boolean) => void;
  error?: string;
  helper?: string;
}) {
  const absent = `${field}Absent` as const;
  return (
    <div>
      <TextField
        id={`release-${field}`}
        label={label}
        inputMode="decimal"
        value={draft[field]}
        disabled={draft[absent]}
        onChange={(e) => update(field, e.target.value)}
        error={error}
        helper={helper}
      />
      <label className="wr-release-check">
        <input
          type="checkbox"
          checked={draft[absent]}
          aria-label={`${field === "amount" ? "Amount" : field === "quantity" ? "Quantity" : "Rate"} not written in this entry`}
          onChange={(e) => update(absent, e.target.checked)}
        />
        Not written in this entry
      </label>
    </div>
  );
}
function ReasonInput({
  id,
  label,
  value,
  onChange,
  error,
  helper,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  helper: string;
  disabled?: boolean;
}) {
  return (
    <div className="wr-field">
      <label className="wr-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        maxLength={1000}
        className="wr-input"
        value={value}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-help`} className="wr-help">
        {helper}
      </p>
      {error && (
        <p id={`${id}-error`} className="wr-help wr-error">
          {error}
        </p>
      )}
    </div>
  );
}
function Impact({
  kind,
  outcome,
}: {
  kind: ReleaseKind;
  outcome: "confirm" | "cancel";
}) {
  return (
    <Notice tone={outcome === "cancel" ? "warning" : "info"}>
      <b>Impact if approved</b>
      <p>{releaseImpact(kind, outcome)}</p>
      <p>Submitting a proposal does not change loyalty credit.</p>
    </Notice>
  );
}
function Comparison({
  sale,
  preparation,
  facts,
  outcome,
  reason,
  precision,
}: {
  sale: AdminSaleDetail;
  preparation: ReleasePreparation | null;
  facts: ReleaseProposal["facts"];
  outcome: "confirm" | "cancel";
  reason: string;
  precision?: string;
}) {
  const original = preparation?.original ?? sale.original;
  const money = (v: string | null) =>
    v === null ? "Not written in the entry" : formatNaira(parseKobo(v));
  const rows: [string, ReactNode, ReactNode][] = [
    ["Station", sale.station.code, "Matches the original station"],
    ["Pump", sale.pump.code, "Matches the original pump"],
    ["Product", productNames[sale.product], productNames[facts.product]],
    [
      "Original attendant",
      `${sale.seller.name} · ${sale.seller.staffCode}`,
      "Matches the original attendant",
    ],
    [
      "Customer / captured card",
      `${sale.customer?.name ?? "Customer pending"} · ${sale.capturedCardCode}`,
      "Matches the original customer and card",
    ],
    ["Entry mode", adminAction(original.basis), adminAction(original.basis)],
    ["Amount", saleMoney(original.amountKobo), money(facts.recordedAmountKobo)],
    [
      "Quantity",
      saleQuantity(original),
      facts.recordedQuantity === null
        ? "Not written in the entry"
        : `${facts.recordedQuantity} ${original.unit === "litre" ? "litres" : "kilograms"}`,
    ],
    [
      "Rate",
      saleRate(original),
      facts.recordedRateKobo === null
        ? "Not written in the entry"
        : `${money(facts.recordedRateKobo)} / ${original.unit === "litre" ? "litre" : "kilogram"}`,
    ],
    [
      "Device-reported time",
      adminTime(sale.appCapturedAt),
      "Paper time is external attestation",
    ],
    [
      "First server receipt",
      adminTime(sale.serverReceivedAt),
      "Original trusted receipt is unchanged",
    ],
  ];
  return (
    <>
      <div className="wr-release-comparison">
        <div className="wr-release-comparison-head">
          <h3>Original purchase</h3>
          <h3>Facts copied from the entry</h3>
        </div>
        {rows.map(([label, a, b]) => (
          <div className="wr-release-pair" key={label}>
            <div>
              <b>{label}</b>
              <p>{a}</p>
            </div>
            <div>
              <b>{label}</b>
              <p>{b}</p>
            </div>
          </div>
        ))}
      </div>
      <KeyValueList
        items={[
          {
            label: "Currently recorded",
            value: valuePair(
              preparation?.currentCandidate.values ?? sale.displayedValues,
            ),
          },
          {
            label: "Record type",
            value: facts.source === "shift_sheet" ? "Shift sheet" : "Sales log",
          },
          { label: "Entry reference", value: facts.entryReference },
          {
            label: "Time range from the entry · external attestation",
            value: (
              <>
                {precision && (
                  <span>
                    {precision}
                    <br />
                  </span>
                )}
                <time>{facts.observedCapture.from}</time> through{" "}
                <time>{facts.observedCapture.through}</time>
                <br />
                Africa/Lagos (UTC+01:00) · inclusive full encoded range
              </>
            ),
          },
          {
            label: "Finding",
            value:
              facts.finding === "sale_recorded"
                ? "Sale recorded"
                : "Entry marked void or erroneous",
          },
          {
            label: "Proposed outcome",
            value:
              outcome === "cancel"
                ? "Cancel this invalid sale"
                : "Confirm selected review",
          },
          { label: "Proposal reason", value: reason },
        ]}
      />
    </>
  );
}
function RecordedRelease({ proposal }: { proposal: ReleaseProposal }) {
  const result = proposal.decision?.result;
  if (!result) return <Notice>Decision recorded · not credited</Notice>;
  if (result.outcome === "cancel")
    return (
      <Notice>
        <b>Sale cancelled</b>
        <p>
          This sale does not count toward loyalty. The original entry and
          history are retained.
        </p>
      </Notice>
    );
  if (result.creditedAfter)
    return (
      <Notice tone="success">
        <b>Loyalty credit recorded</b>
        <p>
          This decision passed the remaining checks. Current sale status is
          shown below.
        </p>
      </Notice>
    );
  const remaining = [...result.remainingHolds, ...result.policyBlocks];
  return (
    <Notice>
      <b>
        {remaining.length
          ? "Still held for review"
          : "Decision recorded · not credited"}
      </b>
      <p>
        {remaining.length
          ? "This decision cleared only the selected review. The remaining checks below still prevent credit."
          : "This decision does not confirm loyalty credit. Check the remaining validation and eligibility status below."}
      </p>
      {remaining.length > 0 && (
        <ul>
          {remaining.map((r, i) => (
            <li key={i}>
              {typeof r === "string" ? adminAction(r) : adminAction(r.kind)}
            </li>
          ))}
        </ul>
      )}
    </Notice>
  );
}
function PhotoViewer({
  title,
  alt,
  local,
  expiresAt,
  load,
  onReady,
  onInvalidated,
}: {
  title: string;
  alt: string;
  local?: string;
  expiresAt?: string;
  load?: () => Promise<{ url: string; expiresAt: string }>;
  onReady?: (ready: boolean) => void;
  onInvalidated?: () => void;
}) {
  const [photo, setPhoto] = useState<{
      url: string;
      expiresAt?: string;
    } | null>(local ? { url: local, expiresAt } : null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [full, setFull] = useState(false),
    [zoom, setZoom] = useState(1);
  const { store } = useAdminSession(),
    guard = useViewGuard(),
    dialog = useRef<HTMLDialogElement>(null),
    opener = useRef<HTMLButtonElement>(null),
    pan = useRef<HTMLDivElement>(null);
  const ready = useRef(onReady);
  const invalidate = useRef(onInvalidated);
  useEffect(() => {
    ready.current = onReady;
    invalidate.current = onInvalidated;
  }, [onReady, onInvalidated]);
  useEffect(() => {
    ready.current?.(false);
    return () => ready.current?.(false);
  }, []);
  useEffect(() => {
    if (!photo?.expiresAt) return;
    const delay = Math.max(0, Date.parse(photo.expiresAt) - Date.now());
    const timer = setTimeout(() => {
      setPhoto(null);
      setFull(false);
      setError("Photo access expired. Load the photo again.");
      ready.current?.(false);
      invalidate.current?.();
    }, delay);
    return () => clearTimeout(timer);
  }, [photo]);
  useEffect(() => {
    if (full) {
      dialog.current?.showModal();
    } else if (dialog.current?.open) {
      dialog.current.close();
      opener.current?.focus();
    }
  }, [full]);
  const retrieve = async () => {
    if (!load) return;
    const live = guard(),
      epoch = store.getSnapshot().epoch;
    setBusy(true);
    setError("");
    ready.current?.(false);
    try {
      const data = await load();
      if (live() && epoch === store.getSnapshot().epoch) setPhoto(data);
    } catch (e) {
      if (live()) {
        setPhoto(null);
        setError(
          e instanceof AdminError &&
            ["permission_denied", "unauthenticated"].includes(e.code)
            ? releaseMessage(e)
            : "This photo is unavailable. Approval needs both retained photos.",
        );
      }
    } finally {
      if (live()) setBusy(false);
    }
  };
  const failed = () => {
    setPhoto(null);
    setFull(false);
    ready.current?.(false);
    invalidate.current?.();
    setError("This photo is unavailable. Approval needs both retained photos.");
  };
  return (
    <section className="wr-release-photo" aria-label={title}>
      <h3>{title}</h3>
      {photo ? (
        <>
          <div className="wr-photo wr-taken">
            <img
              src={photo.url}
              alt={alt}
              referrerPolicy="no-referrer"
              onLoad={() => ready.current?.(true)}
              onError={failed}
            />
          </div>
          <button
            ref={opener}
            type="button"
            className="wr-btn wr-btn-secondary"
            onClick={() => {
              if (
                photo.expiresAt &&
                Date.parse(photo.expiresAt) <= Date.now()
              ) {
                setPhoto(null);
                ready.current?.(false);
                setError("Photo access expired. Load the photo again.");
                invalidate.current?.();
              } else {
                setZoom(1);
                setFull(true);
              }
            }}
          >
            Open full size
          </button>
        </>
      ) : load ? (
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void retrieve()}
        >
          {error ? "Load photo again" : `Load ${title.toLowerCase()}`}
        </Button>
      ) : null}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Loading photo…</p>}
      {full && photo && (
        <dialog
          ref={dialog}
          className="wr-sales-lightbox wr-release-lightbox"
          aria-label={`Full size ${title.toLowerCase()}`}
          onCancel={() => setFull(false)}
          onClose={() => {
            setFull(false);
            opener.current?.focus();
          }}
        >
          <div className="wr-release-actions">
            <Button
              autoFocus
              variant="secondary"
              onClick={() => setFull(false)}
            >
              Close photo
            </Button>
            <Button
              variant="secondary"
              disabled={zoom >= 4}
              onClick={() => setZoom((v) => Math.min(4, v + 0.5))}
            >
              Zoom in
            </Button>
            <Button
              variant="secondary"
              disabled={zoom <= 1}
              onClick={() => setZoom((v) => Math.max(1, v - 0.5))}
            >
              Zoom out
            </Button>
          </div>
          <p>Use the arrow keys in the image area to pan.</p>
          <div
            ref={pan}
            className="wr-release-pan"
            tabIndex={0}
            role="region"
            aria-label="Photo pan area"
            onKeyDown={(e) => {
              const movement = {
                ArrowLeft: [-80, 0],
                ArrowRight: [80, 0],
                ArrowUp: [0, -80],
                ArrowDown: [0, 80],
              }[e.key];
              if (movement) {
                e.preventDefault();
                pan.current?.scrollBy(movement[0]!, movement[1]!);
              }
            }}
          >
            <img
              src={photo.url}
              alt={alt}
              referrerPolicy="no-referrer"
              style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
              onError={failed}
            />
          </div>
        </dialog>
      )}
    </section>
  );
}

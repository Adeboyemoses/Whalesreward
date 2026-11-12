"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScanLine } from "lucide-react";
import { CustomerCardScanner } from "./customer-card-scanner";
import { normalizeMobilePhone } from "@/shared/phone";
import { useAdminSession } from "./session";
import { useRead, useViewGuard } from "./station-common";
import {
  PageHead,
  Sheet,
  Loading,
  ErrorNotice,
  useCustomerPage,
  PageControls,
  PageState,
} from "./customers-common";
import {
  Button,
  TextField,
  Notice,
  KeyValueList,
  StatusPill,
  DataTable,
} from "@/ui";
import { customerProfileSchema } from "@/shared/contracts/customers-cards";
import {
  identityChangeSchema,
  managerCaseViewSchema,
  recoveryText,
  replaceCardSchema,
} from "@/shared/contracts/customer-recovery";
import {
  CustomerRecoveryApi,
  recoveryMessage,
  sameRecoveryContext,
  type RecoveryContext,
  type PhoneChallenge,
  type IdentityChange,
  type ManagerCase,
} from "@/client/customer-recovery-api";
import {
  freezeCustomerChange,
  customerChangeIsUncertain,
  type CustomerChange,
} from "@/client/customer-admin-api";
import { AdminError } from "@/client/admin-api";
import { categories } from "@/client/customer-admin-types";
import { formatAggregateNaira } from "@/shared/aggregate-display";
import { adminTime } from "@/client/admin-display";

type Mode = "phone" | "replace-card" | "recovery";
type Review = {
  change: CustomerChange<object>;
  context: RecoveryContext;
  newMasked?: string;
  newCard?: string;
  reason: string;
};
function Narrative({
  label,
  value,
  set,
  disabled,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  disabled: boolean;
}) {
  const id = "recovery-" + label.toLowerCase().replaceAll(" ", "-");
  return (
    <div className="wr-field">
      <label className="wr-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="wr-input wr-station-reason"
        rows={3}
        required
        maxLength={1000}
        value={value}
        disabled={disabled}
        onChange={(e) => set(e.target.value)}
      />
      <p className="wr-help">
        Required. Do not include phone numbers, identity-document numbers,
        passwords or verification codes.
      </p>
    </div>
  );
}
function Presence({
  children,
  checked,
  set,
  disabled,
}: {
  children: ReactNode;
  checked: boolean;
  set: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="wr-recovery-check">
      <input
        type="checkbox"
        required
        checked={checked}
        disabled={disabled}
        onChange={(e) => set(e.target.checked)}
      />
      {children}
    </label>
  );
}
function useOnline() {
  const [online, set] = useState(true);
  useEffect(() => {
    const update = () => set(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
export function CustomerRecovery({ id, mode }: { id: string; mode: Mode }) {
  const { store } = useAdminSession();
  const api = useMemo(() => new CustomerRecoveryApi(store.request), [store]);
  const profile = useRead(
    `customers/${encodeURIComponent(id)}`,
    customerProfileSchema,
  );
  const capture = useViewGuard(),
    router = useRouter(),
    online = useOnline();
  const [context, setContext] = useState<RecoveryContext | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    lock = useRef(false);
  const [phone, setPhone] = useState(""),
    [reason, setReason] = useState(""),
    [notes, setNotes] = useState("");
  const [present, setPresent] = useState(false),
    [card, setCard] = useState("");
  const [review, setReview] = useState<Review | null>(null),
    [uncertain, setUncertain] = useState(false);
  const [challenge, setChallenge] = useState<PhoneChallenge | null>(null),
    [issueContext, setIssueContext] = useState<RecoveryContext | null>(null);
  const [issue, setIssue] = useState<CustomerChange<object> | null>(null);
  const [issueUncertain, setIssueUncertain] = useState(false),
    [verifyUncertain, setVerifyUncertain] = useState(false);
  const [unconfigured, setUnconfigured] = useState(false),
    [recorded, setRecorded] = useState<ManagerCase | null>(null);
  const code = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  async function run(action: (live: () => boolean) => Promise<void>) {
    if (lock.current || !navigator.onLine) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const live = capture();
    try {
      await action(live);
    } catch (e) {
      if (live()) {
        setError(recoveryMessage(e));
        if (
          e instanceof AdminError &&
          e.code === "phone_verification_unconfigured"
        ) {
          setUnconfigured(true);
          setChallenge(null);
        }
      }
    } finally {
      lock.current = false;
      if (live()) setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    void api.context(id).then(
      (v) => {
        if (alive) setContext(v);
      },
      (e) => {
        if (alive) setError(recoveryMessage(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [api, id]);
  const base = `/admin/customers/${encodeURIComponent(id)}`;
  const frozen = busy || !!review || issueUncertain || verifyUncertain;
  const unavailable = !online || frozen;
  async function refresh() {
    await run(async (live) => {
      const value = await api.context(id);
      if (live()) {
        setContext(value);
        setReview(null);
        setChallenge(null);
        setIssueContext(null);
        setIssue(null);
        setPresent(false);
      }
    });
  }
  async function send() {
    await run(async (live) => {
      const fresh =
        issueUncertain && issueContext ? issueContext : await api.context(id);
      if (!fresh.activeCard) throw new AdminError("card_unavailable", 422);
      const operation =
        issueUncertain && issue
          ? issue
          : freezeCustomerChange(`${api.path(id)}/card-verifications`, {
              expectedVersion: fresh.customerVersion,
            });
      if (live()) {
        setIssue(operation);
        setIssueContext(fresh);
        setContext(fresh);
        setChallenge(null);
        if (code.current) code.current.value = "";
      }
      try {
        const value = await api.issue(id, operation);
        if (live()) {
          setChallenge(value);
          setIssueUncertain(false);
          setIssue(null);
        }
      } catch (e) {
        if (live()) setIssueUncertain(customerChangeIsUncertain(e));
        throw e;
      }
    });
  }
  async function inspectChallenge() {
    if (!challenge) return;
    await run(async (live) => {
      const value = await api.challenge(id, challenge.id);
      if (live()) {
        setChallenge(value);
        setVerifyUncertain(false);
      }
    });
  }
  async function verify() {
    if (
      !challenge ||
      !issueContext ||
      !code.current ||
      lock.current ||
      !navigator.onLine
    )
      return;
    let secret = code.current.value;
    code.current.value = "";
    if (!secret) {
      setError("Enter the verification code.");
      return;
    }
    await run(async (live) => {
      try {
        const pending = api.verify(id, issueContext, challenge, secret);
        secret = "";
        const value = await pending;
        if (live()) {
          setChallenge(value);
          setVerifyUncertain(false);
        }
      } catch (e) {
        secret = "";
        if (live()) setVerifyUncertain(true);
        throw e;
      }
    });
    secret = "";
  }
  async function prepare() {
    await run(async (live) => {
      if (
        !context ||
        !recoveryText.safeParse(reason).success ||
        (mode === "recovery" && !recoveryText.safeParse(notes).success)
      )
        throw new AdminError("invalid_request", 422);
      const fresh = await api.context(id);
      if (!live()) return;
      setContext(fresh);
      if (!sameRecoveryContext(context, fresh)) {
        setPresent(false);
        setChallenge(null);
        throw new AdminError("card_changed", 409);
      }
      if (mode !== "recovery" && !fresh.activeCard)
        throw new AdminError("card_unavailable", 422);
      let body: object,
        newMasked: string | undefined,
        newCard: string | undefined;
      if (mode === "phone") {
        if (!present) throw new AdminError("invalid_request", 422);
        const normalized = normalizeMobilePhone(phone);
        if (!normalized) throw new AdminError("phone_invalid", 422);
        newMasked = `•••• ${normalized.slice(-4)}`;
        body = {
          expectedVersion: fresh.customerVersion,
          newPhone: normalized,
          activeCardCode: fresh.activeCard!.code,
          expectedCardVersion: fresh.activeCard!.version,
          cardInspectedInPerson: true,
          reason: reason.trim(),
        };
      } else if (mode === "replace-card") {
        if (
          !challenge ||
          !issueContext ||
          !sameRecoveryContext(issueContext, fresh)
        )
          throw new AdminError("verification_unavailable", 422);
        const current = await api.challenge(id, challenge.id);
        if (!live()) return;
        setChallenge(current);
        if (
          current.state !== "verified" ||
          Date.parse(current.expiresAt) <= Date.now()
        )
          throw new AdminError("verification_unavailable", 422);
        newCard = card.trim().toUpperCase();
        body = {
          expectedVersion: fresh.customerVersion,
          expectedOldCardVersion: fresh.activeCard!.version,
          challengeId: current.id,
          expectedChallengeVersion: current.version,
          newCardCode: newCard,
          reason: reason.trim(),
        };
        const candidate = freezeCustomerChange(
          `${api.path(id)}/card-replacement`,
          body,
        );
        if (!replaceCardSchema.safeParse(candidate.body).success)
          throw new AdminError("card_unavailable", 422);
      } else {
        if (!present) throw new AdminError("invalid_request", 422);
        body = {
          expectedVersion: fresh.customerVersion,
          customerPresent: true,
          reason: reason.trim(),
          verificationNotes: notes.trim(),
        };
      }
      const suffix =
        mode === "phone"
          ? "phone-change"
          : mode === "recovery"
            ? "manager-cases"
            : "card-replacement";
      if (live())
        setReview({
          change: freezeCustomerChange(`${api.path(id)}/${suffix}`, body),
          context: fresh,
          newMasked,
          newCard,
          reason: reason.trim(),
        });
    });
  }
  async function confirm() {
    if (!review) return;
    await run(async (live) => {
      try {
        if (mode === "recovery") {
          const result = await api.intake(id, review.change);
          if (live()) {
            setRecorded(result);
            setReview(null);
            setNotes("");
            setReason("");
            setPresent(false);
            setUncertain(false);
          }
        } else {
          const receipt = await api.apply(
            id,
            review.change,
            mode === "phone" ? "phone_change" : "card_replacement",
          );
          if (live()) {
            for (const key of store.lists.keys())
              if (
                key.startsWith("station:data:") ||
                key.startsWith("customers:page:")
              )
                store.lists.delete(key);
            store.lists.set(`customer-change:${id}`, receipt);
            setPhone("");
            setReason("");
            setChallenge(null);
            setReview(null);
            router.push(base);
          }
        }
      } catch (e) {
        if (live()) {
          const unknown = customerChangeIsUncertain(e);
          setUncertain(unknown);
          if (!unknown) setReview(null);
        }
        throw e;
      }
    });
  }
  const c = profile.data;
  if (!c) return <Loading {...profile} label="Loading customer…" />;
  return (
    <>
      <PageHead
        title={
          mode === "phone"
            ? "Update phone number"
            : mode === "replace-card"
              ? "Replace lost card"
              : "Manager recovery review"
        }
        eyebrow="Customers / Account change"
        subtitle={
          <>
            {c.name} · <span className="wr-mono">{c.customerCode}</span>
          </>
        }
        back={{ href: base, label: "Back to profile" }}
      />
      <Notice>
        <b>Admin action · internet required.</b>{" "}
        {mode === "recovery"
          ? "Record the case for a manager. Nothing changes on the account."
          : "Changes apply to the same account and are recorded in its change history with your name, the verification method and the reason."}
      </Notice>
      {!online && (
        <Notice tone="warning">
          You are offline. Connect to review or confirm an account change.
        </Notice>
      )}
      <ErrorNotice error={unconfigured ? "" : error} />
      {!context && (
        <Button disabled={!online || busy} onClick={refresh}>
          Retry loading account
        </Button>
      )}
      {unconfigured && (
        <Notice tone="warning">
          <b>Lost-card replacement isn&apos;t switched on yet</b>
          <p>
            <Link href={`${base}/recovery`}>Record for manager review</Link>
          </p>
        </Notice>
      )}
      {uncertain && (
        <Notice tone="warning">
          The result is uncertain. Retry the same confirmation to retrieve its
          original result. Do not start another change.
        </Notice>
      )}
      {recorded ? (
        <Sheet title="Recorded for a manager, nothing changed yet">
          <p>
            The phone number and card are unchanged. This case awaits a manager
            decision.
          </p>
          <KeyValueList
            items={[
              { label: "Case", value: recorded.id, mono: true },
              { label: "Recorded", value: adminTime(recorded.createdAt) },
              { label: "By", value: recorded.createdBy.name },
            ]}
          />
          <Link href={base}>Back to profile</Link>
        </Sheet>
      ) : (
        <>
          {mode === "replace-card" && (
            <div className="wr-steps">
              <StatusPill
                small
                tone={challenge?.state === "verified" ? "synced" : "held"}
              >
                1 · Verify the customer
              </StatusPill>
              <StatusPill
                small
                tone={challenge?.state === "verified" ? "held" : undefined}
              >
                2 · Link the replacement card
              </StatusPill>
              <StatusPill small tone={review ? "held" : undefined}>
                3 · Review and confirm
              </StatusPill>
            </div>
          )}
          <div className="wr-cc-two">
            <div className="wr-recovery-stack">
              {mode === "phone" && (
                <Sheet title="New contact number">
                  <p>
                    Keep the same customer account, card and purchase history.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void prepare();
                    }}
                  >
                    <TextField
                      label="Current phone number"
                      value={context?.phoneMasked ?? c.phoneMasked}
                      readOnly
                    />
                    <TextField
                      label="New phone number"
                      type="tel"
                      autoComplete="off"
                      maxLength={32}
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={unavailable}
                      helper="Local (080…) or +234 format. Must differ from the current number and belong to no other customer."
                    />
                    <Presence
                      checked={present}
                      set={setPresent}
                      disabled={unavailable}
                    >
                      I checked the customer&apos;s active loyalty card in
                      person.
                    </Presence>
                    <Narrative
                      label="Reason for change"
                      value={reason}
                      set={setReason}
                      disabled={unavailable}
                    />
                    <div className="wr-cc-actions">
                      <Button
                        type="submit"
                        disabled={unavailable || !context?.activeCard}
                      >
                        Review phone update
                      </Button>
                      <Link className="wr-btn wr-btn-ghost" href={base}>
                        Cancel
                      </Link>
                    </div>
                  </form>
                </Sheet>
              )}
              {mode === "replace-card" && (
                <>
                  <Sheet
                    title="Verify the customer"
                    badge={
                      challenge?.state === "verified" ? (
                        <StatusPill tone="synced" small>
                          Phone verified
                        </StatusPill>
                      ) : undefined
                    }
                  >
                    <p>
                      Use the phone number already registered to this account.
                      Registered number: {context?.phoneMasked ?? c.phoneMasked}
                      .
                    </p>
                    {!challenge && (
                      <Button
                        disabled={
                          busy ||
                          !online ||
                          unconfigured ||
                          !context?.activeCard
                        }
                        onClick={send}
                      >
                        {issueUncertain
                          ? "Retry same code request"
                          : "Send verification code"}
                      </Button>
                    )}
                    {challenge && (
                      <>
                        <p role="status">
                          {challenge.state === "delivery_pending"
                            ? "Code delivery pending"
                            : challenge.state === "sent"
                              ? "Code sent"
                              : challenge.state === "verified"
                                ? "Phone verified"
                                : "Verification is unavailable. Request another code and try again."}
                        </p>
                        <div className="wr-cc-actions">
                          <Button
                            variant="secondary"
                            disabled={
                              unavailable ||
                              now < Date.parse(challenge.resendAfter)
                            }
                            onClick={send}
                          >
                            {now < Date.parse(challenge.resendAfter)
                              ? `Resend code in ${Math.ceil((Date.parse(challenge.resendAfter) - now) / 1000)} seconds`
                              : "Resend code"}
                          </Button>
                          {(challenge.state === "delivery_pending" ||
                            verifyUncertain) && (
                            <Button
                              disabled={busy || !online}
                              variant="secondary"
                              onClick={inspectChallenge}
                            >
                              Check verification status
                            </Button>
                          )}
                        </div>
                        {challenge.state === "sent" && !verifyUncertain && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void verify();
                            }}
                          >
                            <div className="wr-field">
                              <label
                                className="wr-label"
                                htmlFor="verification-code"
                              >
                                Verification code
                              </label>
                              <input
                                ref={code}
                                id="verification-code"
                                type="password"
                                className="wr-input wr-mono"
                                autoComplete="off"
                                maxLength={256}
                                required
                                disabled={unavailable}
                              />
                            </div>
                            <Button
                              type="submit"
                              disabled={
                                unavailable ||
                                now >= Date.parse(challenge.expiresAt)
                              }
                            >
                              Verify code
                            </Button>
                          </form>
                        )}
                      </>
                    )}
                    {verifyUncertain && (
                      <Notice tone="warning">
                        Verification could not be confirmed. Check verification
                        status before trying again.
                      </Notice>
                    )}
                    <p className="wr-help">
                      The code is checked against the registered phone. Codes
                      expire; resend limits apply.
                    </p>
                    <Link href={`${base}/recovery`}>
                      Customer cannot access the registered phone
                    </Link>
                  </Sheet>
                  <Sheet title="Link the replacement card">
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void prepare();
                      }}
                    >
                      <TextField
                        label="Unused card number"
                        action={
                          <Button
                            variant="secondary"
                            disabled={
                              unavailable || challenge?.state !== "verified"
                            }
                            onClick={() => setScanning(true)}
                            icon={<ScanLine aria-hidden="true" size={20} />}
                          >
                            Scan
                          </Button>
                        }
                        mono
                        maxLength={7}
                        required
                        value={card}
                        onChange={(e) => setCard(e.target.value.toUpperCase())}
                        disabled={
                          unavailable || challenge?.state !== "verified"
                        }
                        helper="Must be an unassigned card from an Active batch. Linked, disabled or unknown codes are rejected."
                      />
                      <Narrative
                        label="Reason for replacement"
                        value={reason}
                        set={setReason}
                        disabled={
                          unavailable || challenge?.state !== "verified"
                        }
                      />
                      <div className="wr-cc-actions">
                        <Button
                          type="submit"
                          disabled={
                            unavailable ||
                            challenge?.state !== "verified" ||
                            !context?.activeCard
                          }
                        >
                          Review replacement
                        </Button>
                        <Link className="wr-btn wr-btn-ghost" href={base}>
                          Cancel
                        </Link>
                      </div>
                    </form>
                  </Sheet>
                </>
              )}
              {mode === "recovery" && (
                <Sheet title="In-person manager review">
                  <p>
                    When the card and the registered phone are both unavailable,
                    record the case for a manager decision. Recording the case
                    does not change the phone number or replace the card.
                  </p>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void prepare();
                    }}
                  >
                    <Narrative
                      label="Review notes"
                      value={notes}
                      set={setNotes}
                      disabled={unavailable}
                    />
                    <Narrative
                      label="Why the code cannot be used"
                      value={reason}
                      set={setReason}
                      disabled={unavailable}
                    />
                    <Presence
                      checked={present}
                      set={setPresent}
                      disabled={unavailable}
                    >
                      The customer is present for an in-person review.
                    </Presence>
                    <div className="wr-card wr-quiet">
                      <h3>What happens next</h3>
                      <KeyValueList
                        items={[
                          {
                            label: "Case",
                            value: "Recorded as needing a manager decision",
                          },
                          { label: "Phone and card", value: "Unchanged" },
                        ]}
                      />
                    </div>
                    <div className="wr-cc-actions">
                      <Button type="submit" disabled={unavailable || !context}>
                        Review manager intake
                      </Button>
                      <Link
                        className="wr-btn wr-btn-ghost"
                        href={`${base}/replace-card`}
                      >
                        Back to verification
                      </Link>
                    </div>
                  </form>
                </Sheet>
              )}
            </div>
            <Sheet
              title={
                mode === "recovery"
                  ? "Customer account"
                  : "Account being updated"
              }
              quiet
            >
              <KeyValueList
                items={[
                  { label: "Customer name", value: c.name },
                  { label: "Customer ID", value: c.customerCode, mono: true },
                  {
                    label: "Current phone",
                    value: context?.phoneMasked ?? c.phoneMasked,
                  },
                  {
                    label: "Active card",
                    value: context?.activeCard?.code ?? "No active card",
                    mono: true,
                  },
                  { label: "Fixed category", value: categories[c.category] },
                  {
                    label: "Recorded spend",
                    value: formatAggregateNaira(c.recordedSpendKobo),
                  },
                ]}
              />
              <p className="wr-help">
                The customer ID, fixed category, registration station and
                purchase history stay with the original customer.
              </p>
              {context && !context.activeCard && mode !== "recovery" && (
                <Notice tone="warning">
                  There is no active card.{" "}
                  <Link href={`${base}/recovery`}>
                    Record for manager review
                  </Link>
                </Notice>
              )}
            </Sheet>
          </div>
          {review && (
            <Sheet
              title={
                mode === "recovery"
                  ? "Confirm manager intake"
                  : "Confirm account change"
              }
              badge={
                <StatusPill tone="held" small>
                  Review before confirming
                </StatusPill>
              }
            >
              {mode !== "recovery" && (
                <div className="wr-cc-two">
                  <div className="wr-card wr-quiet">
                    <p className="wr-caption">
                      {mode === "phone" ? "Current phone" : "Current card"}
                    </p>
                    <b className="wr-recovery-value">
                      {mode === "phone"
                        ? review.context.phoneMasked
                        : review.context.activeCard?.code}
                    </b>
                    <p className="wr-help">
                      {mode === "phone"
                        ? "Verified by card check in person"
                        : "Will be disabled immediately · never reassigned"}
                    </p>
                  </div>
                  <div className="wr-card wr-quiet">
                    <p className="wr-caption">
                      {mode === "phone" ? "New phone" : "Replacement card"}
                    </p>
                    <b className="wr-recovery-value">
                      {review.newMasked ?? review.newCard}
                    </b>
                    <p className="wr-help">
                      {mode === "phone"
                        ? "Normalised · uniqueness checked when confirmed"
                        : "Must be unassigned and from an Active batch"}
                    </p>
                  </div>
                </div>
              )}
              <KeyValueList
                items={[
                  { label: "Customer", value: `${c.name} · ${c.customerCode}` },
                  {
                    label: "Verification",
                    value:
                      mode === "phone"
                        ? "Card checked in person"
                        : mode === "replace-card"
                          ? "Code to the registered phone"
                          : "In-person manager intake only",
                  },
                  { label: "Reason", value: review.reason },
                  ...(mode === "replace-card"
                    ? [
                        {
                          label: "Offline sales on the old card",
                          value:
                            "Held for replaced-card review if uploaded after this change",
                        },
                      ]
                    : []),
                ]}
              />
              {mode === "recovery" && (
                <Notice>
                  Recorded for a manager, nothing changed yet. No phone or card
                  change is authorized by this intake.
                </Notice>
              )}
              <div className="wr-cc-actions">
                <Button loading={busy} disabled={!online} onClick={confirm}>
                  {uncertain
                    ? "Retry same confirmation"
                    : mode === "recovery"
                      ? "Record for manager review"
                      : "Confirm change"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || uncertain}
                  onClick={() => {
                    setReview(null);
                    setError("");
                  }}
                >
                  Keep editing
                </Button>
              </div>
            </Sheet>
          )}
          {error &&
            !review &&
            context &&
            !issueUncertain &&
            !verifyUncertain && (
              <Button
                variant="secondary"
                disabled={busy || !online}
                onClick={refresh}
              >
                Reload account details
              </Button>
            )}
        </>
      )}
      {scanning && (
        <CustomerCardScanner
          onCode={setCard}
          onClose={() => setScanning(false)}
        />
      )}
      {mode === "recovery" && (
        <ManagerCases key={recorded?.id ?? "existing"} id={id} />
      )}
    </>
  );
}
export function ChangeReceipt({ id }: { id: string }) {
  const { store } = useAdminSession();
  const receipt = store.lists.get(`customer-change:${id}`) as
    IdentityChange | undefined;
  if (!receipt) return null;
  return (
    <Notice tone="success">
      <b>Change applied.</b>{" "}
      {receipt.kind === "phone_change"
        ? `Phone updated from ${receipt.oldPhoneMasked} to ${receipt.newPhoneMasked}.`
        : `Card ${receipt.oldCardCode} was disabled and ${receipt.newCardCode} was linked to this customer.`}{" "}
      Spend, history and the customer ID are unchanged.
      <p className="wr-help">
        Confirmed {adminTime(receipt.appliedAt)}. The profile below shows the
        current account.
      </p>
    </Notice>
  );
}
export function CustomerCardConsequence({ id }: { id: string }) {
  const { store } = useAdminSession();
  const receipt = store.lists.get(`customer-change:${id}`) as
    IdentityChange | undefined;
  return (
    <p className="wr-help">
      {receipt?.kind === "card_replacement" ? (
        <>
          Previous card <span className="wr-mono">{receipt.oldCardCode}</span>{" "}
          is disabled and will never be reassigned. Offline sales still carrying
          it are held for replaced-card review when uploaded after the change.
        </>
      ) : (
        <>
          The printed number and QR identify the same card. The customer ID
          stays the same when a card is replaced.
        </>
      )}
    </p>
  );
}
export function CustomerChanges({ id }: { id: string }) {
  const page = useCustomerPage(
    `customers/${encodeURIComponent(id)}/changes`,
    identityChangeSchema,
  );
  return (
    <section className="wr-sheet">
      <PageState page={page} empty="No account changes recorded." />
      <DataTable
        caption="Account change history"
        columns={[
          { key: "when", label: "When" },
          { key: "change", label: "Change" },
          { key: "verification", label: "Verification" },
          { key: "actor", label: "By" },
          { key: "reason", label: "Reason" },
        ]}
        rows={(page.data?.items ?? []).map((x) => ({
          id: x.id,
          cells: {
            when: adminTime(x.appliedAt),
            change: (
              <>
                <b>
                  {x.kind === "phone_change"
                    ? "Phone updated"
                    : "Card replaced"}
                </b>
                <span className="wr-sub">
                  {x.kind === "phone_change"
                    ? `${x.oldPhoneMasked} to ${x.newPhoneMasked}`
                    : `${x.oldCardCode} disabled · ${x.newCardCode} linked`}
                </span>
              </>
            ),
            verification:
              x.verification === "card_present"
                ? "Card checked in person"
                : "Code to registered phone",
            actor: (
              <>
                {x.actor.name}
                <span className="wr-sub wr-mono">{x.actor.code}</span>
              </>
            ),
            reason: x.reason,
          },
        }))}
      />
      <PageControls page={page} />
      <p className="wr-help">
        Every change keeps old and new values, the actor, the verification
        method and the reason. A repeated confirmation never applies twice.
      </p>
    </section>
  );
}
export function ManagerCases({ id }: { id: string }) {
  const page = useCustomerPage(
    `customers/${encodeURIComponent(id)}/manager-cases`,
    managerCaseViewSchema,
  );
  return (
    <Sheet title="Manager intake">
      <PageState page={page} empty="No manager intake recorded." />
      {page.data?.items.map((x) => (
        <div className="wr-card wr-quiet" key={x.id}>
          <b>Recorded for a manager, nothing changed yet</b>
          <p>
            {adminTime(x.createdAt)} · {x.createdBy.name}
          </p>
          <p>{x.reason}</p>
          <p className="wr-secondary">Checks made: {x.verificationNotes}</p>
        </div>
      ))}
      <PageControls page={page} />
    </Sheet>
  );
}

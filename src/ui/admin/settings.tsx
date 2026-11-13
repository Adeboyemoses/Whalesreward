"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AdminSession } from "@/client/admin-session";
import { AdminError } from "@/client/admin-api";
import {
  AdminSettingsApi,
  parseRetentionDays,
  settingsMessage,
  settingsUncertain,
  type FrozenRetention,
  type RetentionReview,
  type SettingsHistory,
} from "@/client/admin-settings-api";
import type { Settings, SettingsChange } from "@/shared/contracts/settings";
import { retentionReviewSchema } from "@/shared/contracts/settings";
import { adminTime } from "@/client/admin-display";
import { Button, DataTable, KeyValueList, Notice, TextField } from "@/ui";
import { PageHead, Sheet, productNames } from "./station-common";
import { useAdminSession } from "./session";
const locked =
  "Campaign dates can't be changed until Whales approves the timing rules";
const daysText = (days: number | null) =>
  days === null ? "Not set" : `${days} ${days === 1 ? "day" : "days"}`;
const instantText = (value: string | null | undefined) =>
  value ? adminTime(value) : "Not set";
const copyText = (value: Settings["retention"]["storedCopyPolicy"]) =>
  ({
    unconfigured: "Not configured",
    compressed_only: "Compressed only",
    original_and_compressed: "Original + compressed",
  })[value];
function Timing({
  timing,
  timezone,
}: {
  timing: NonNullable<Settings["campaign"]>["timing"] | undefined;
  timezone: string;
}) {
  return (
    <KeyValueList
      items={[
        { label: "Launch", value: instantText(timing?.launchAt) },
        { label: "Purchase start", value: instantText(timing?.purchaseStart) },
        {
          label: "Purchase cutoff",
          value: instantText(timing?.purchaseCutoff),
        },
        {
          label: "Upload grace period",
          value:
            timing?.graceHours === null || timing?.graceHours === undefined
              ? "Not set"
              : `${timing.graceHours} hours`,
        },
        {
          label: "Upload deadline (derived)",
          value: instantText(timing?.uploadDeadline),
        },
        { label: "Time zone", value: timing?.timezone ?? timezone },
      ]}
    />
  );
}
type Draft = {
  days: string;
  reason: string;
  review: RetentionReview | null;
  pending: FrozenRetention | null;
  error: string;
  stale: boolean;
};
export function SettingsPortal({
  path,
  session,
}: {
  path: string[];
  session: AdminSession;
}) {
  if (!session.permissions?.includes("settings"))
    return (
      <Notice tone="danger" role="alert">
        Your current permissions do not allow settings access.
      </Notice>
    );
  return <SettingsContent path={path} session={session} />;
}
function SettingsContent({
  path,
  session,
}: {
  path: string[];
  session: AdminSession;
}) {
  const { store, epoch } = useAdminSession();
  const router = useRouter();
  const api = useMemo(() => new AdminSettingsApi(store.request), [store]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [history, setHistory] = useState<SettingsHistory | null>(null);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [serial, reload] = useState(0);
  const [success, setSuccess] = useState("");
  const [draft, updateDraft] = useState<Draft | null>(
    () => (store.lists.get("settings:retention") as Draft | undefined) ?? null,
  );
  const current = useRef(draft);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const valid = () => store.getSnapshot().epoch === epoch;
  function save(value: Draft) {
    if (!valid()) return;
    current.current = value;
    store.lists.set("settings:retention", value);
    if (alive.current) updateDraft(value);
  }
  useEffect(() => {
    let live = true;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api.settings();
        if (!live) return;
        setSettings(data);
        if (!current.current) {
          const value = {
            days:
              data.retention.days === null ? "" : String(data.retention.days),
            reason: "",
            review: null,
            pending: null,
            error: "",
            stale: false,
          };
          current.current = value;
          store.lists.set("settings:retention", value);
          updateDraft(value);
        }
      } catch (e) {
        if (live) {
          setSettings(null);
          setError(settingsMessage(e));
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [api, serial, store]);
  useEffect(() => {
    let live = true;
    void api.history().then(
      (data) => {
        if (live) {
          setHistory(data);
          setHistoryError("");
        }
      },
      (e) => {
        if (live) setHistoryError(settingsMessage(e));
      },
    );
    return () => {
      live = false;
    };
  }, [api, serial]);
  async function moreHistory() {
    if (!history?.nextCursor || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const data = await api.history(history.nextCursor);
      if (valid() && alive.current) {
        setHistory({
          items: [...history.items, ...data.items],
          nextCursor: data.nextCursor,
        });
        setHistoryError("");
      }
    } catch (e) {
      if (valid() && alive.current) setHistoryError(settingsMessage(e));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function review() {
    const value = current.current;
    if (!value || !settings || value.pending || inFlight.current) return;
    let proposal;
    try {
      proposal = retentionReviewSchema.parse({
        days: parseRetentionDays(value.days),
        reason: value.reason,
        expectedVersion: settings.version,
      });
    } catch (e) {
      save({
        ...value,
        error:
          e instanceof Error && !("issues" in e)
            ? e.message
            : "Enter a reason from 1 to 1,000 characters without phone numbers or secrets.",
        stale: false,
      });
      return;
    }
    inFlight.current = true;
    setBusy(true);
    save({ ...value, error: "" });
    try {
      const result = await api.review(proposal);
      if (!valid()) return;
      save({
        ...value,
        review: result,
        pending: null,
        error: "",
        stale: false,
      });
      if (alive.current) router.push("/admin/settings/retention/confirm");
    } catch (e) {
      if (valid())
        save({
          ...value,
          review: null,
          error: settingsMessage(e),
          stale:
            e instanceof AdminError &&
            ["version_conflict", "review_stale"].includes(e.code),
        });
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function confirm() {
    const value = current.current;
    if (!value?.review || inFlight.current) return;
    const frozen = value.pending ?? api.freeze(value.review);
    inFlight.current = true;
    setBusy(true);
    save({ ...value, pending: frozen, error: "" });
    try {
      await api.confirm(frozen);
      if (!valid()) return;
      save({
        days: frozen.body.days === null ? "" : String(frozen.body.days),
        reason: "",
        review: null,
        pending: null,
        error: "",
        stale: false,
      });
      if (alive.current) {
        setSuccess(
          "Retention intent saved. Photos are never deleted automatically.",
        );
        reload((x) => x + 1);
        router.push("/admin/settings");
      }
    } catch (e) {
      if (!valid()) return;
      const uncertain = settingsUncertain(e);
      save({
        ...value,
        review: uncertain ? value.review : null,
        pending: uncertain ? frozen : null,
        error: uncertain
          ? "The confirmation result is uncertain. Retry the same confirmation to find out whether it was saved. Do not start another change."
          : settingsMessage(e),
        stale: !uncertain,
      });
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function resetReview() {
    if (draft && !draft.pending) {
      save({ ...draft, review: null, error: "", stale: false });
      router.push("/admin/settings/retention");
    }
  }
  function cancel() {
    if (draft && !draft.pending) {
      store.lists.delete("settings:retention");
      current.current = null;
      updateDraft(null);
      reload((x) => x + 1);
      router.push("/admin/settings");
    }
  }
  let daysError = "";
  try {
    parseRetentionDays(draft?.days ?? "");
  } catch (e) {
    daysError = e instanceof Error ? e.message : "Enter positive whole days.";
  }
  const validReason = retentionReviewSchema.shape.reason.safeParse(
    draft?.reason ?? "",
  ).success;
  const overview = !path[1];
  const giveaway = path[1] === "giveaway";
  const confirming = path[1] === "retention" && path[2] === "confirm";
  const title = overview
    ? "Settings"
    : giveaway
      ? "Giveaway timing"
      : "Photo retention";
  const context = settings
    ? `${settings.station.name} · ${settings.station.timezone}`
    : session.station?.name;
  return (
    <div className="wr-settings">
      <PageHead
        title={title}
        eyebrow={
          overview ? (settings?.station.name ?? "Station") : "Settings / Edit"
        }
        subtitle={overview ? "Campaign timing and evidence retention" : context}
        back={
          overview || draft?.pending
            ? undefined
            : { href: "/admin/settings", label: "Back to settings" }
        }
      />
      {loading && <p role="status">Loading settings…</p>}
      {error && (
        <>
          <Notice role="alert" tone="danger">
            {error}
          </Notice>
          <Button variant="secondary" onClick={() => reload((x) => x + 1)}>
            Retry loading
          </Button>
        </>
      )}
      {success && (
        <Notice role="status" tone="success">
          {success}
        </Notice>
      )}
      {settings && (
        <>
          {draft?.pending && !confirming && (
            <Notice role="alert">
              A retention confirmation is unresolved.{" "}
              <Link href="/admin/settings/retention/confirm">
                Return to confirmation
              </Link>{" "}
              before starting another change.
            </Notice>
          )}
          {overview ? (
            <>
              <Notice tone="warning">
                Campaign timing must be configured before a final giveaway
                result can be produced. Photos are never deleted automatically.
              </Notice>
              <div className="wr-two-col">
                <Sheet
                  title="Giveaway timing"
                  badge={
                    <span className="wr-pill wr-sm">
                      {settings.campaign?.timing.policyVersion
                        ? "Locked"
                        : "Not configured"}
                    </span>
                  }
                >
                  <Timing
                    timing={settings.campaign?.timing}
                    timezone={settings.station.timezone}
                  />
                  <Link
                    className="wr-btn wr-btn-secondary"
                    href="/admin/settings/giveaway"
                  >
                    View giveaway settings
                  </Link>
                  <p className="wr-help">{locked}</p>
                </Sheet>
                <Sheet
                  title="Photo retention"
                  badge={
                    <span className="wr-pill wr-sm">Deletion disabled</span>
                  }
                >
                  <KeyValueList
                    items={[
                      {
                        label: "Retention period",
                        value: daysText(settings.retention.days),
                      },
                      {
                        label: "Automatic deletion",
                        value: "Disabled · policy approval pending",
                      },
                      {
                        label: "Stored copy",
                        value: copyText(settings.retention.storedCopyPolicy),
                      },
                    ]}
                  />
                  <Link
                    className="wr-btn wr-btn-secondary"
                    href={
                      draft?.pending
                        ? "/admin/settings/retention/confirm"
                        : "/admin/settings/retention"
                    }
                  >
                    Edit retention period
                  </Link>
                  <p className="wr-help">
                    Saving a period records intent only. Photos are never
                    deleted automatically.
                  </p>
                </Sheet>
              </div>
              <Sheet title="Station">
                <KeyValueList
                  items={[
                    { label: "Station name", value: settings.station.name },
                    { label: "Time zone", value: settings.station.timezone },
                    {
                      label: "Products",
                      value:
                        settings.station.products
                          .map((p) => productNames[p.product])
                          .join(" · ") || "Not set",
                    },
                    {
                      label: "Money precision",
                      value: `${settings.station.moneyDecimals} decimals`,
                    },
                    {
                      label: "Quantity precision",
                      value:
                        settings.station.products
                          .map(
                            (p) =>
                              `${productNames[p.product]}: ${p.quantityPrecision === null ? "Not set" : `${p.quantityPrecision} decimals`}`,
                          )
                          .join(" · ") || "Not set",
                    },
                  ]}
                />
              </Sheet>
              <h2>Settings history</h2>
              {historyError && (
                <Notice role="alert" tone="danger">
                  {historyError}
                  <Button
                    variant="secondary"
                    onClick={() => reload((x) => x + 1)}
                  >
                    Retry history
                  </Button>
                </Notice>
              )}
              {history && (
                <DataTable
                  caption="Every change keeps the previous value"
                  columns={[
                    { key: "when", label: "When" },
                    { key: "setting", label: "Setting" },
                    { key: "before", label: "Previous" },
                    { key: "after", label: "New" },
                    { key: "by", label: "By" },
                    { key: "reason", label: "Reason" },
                  ]}
                  rows={history.items.map((change) => ({
                    id: change.id,
                    cells: {
                      when: adminTime(change.appliedAt),
                      setting:
                        change.section === "retention"
                          ? "Photo retention"
                          : "Giveaway timing",
                      before: <HistoryValue change={change} side="before" />,
                      after: <HistoryValue change={change} side="after" />,
                      by: (
                        <>
                          {change.actor.name}
                          <span className="wr-sub wr-mono">
                            {change.actor.code}
                          </span>
                        </>
                      ),
                      reason: change.reason,
                    },
                  }))}
                />
              )}
              {history?.items.length === 0 && (
                <p className="wr-notice">
                  No changes recorded yet. The first saved value will appear
                  here with its reason and the admin who confirmed it.
                </p>
              )}
              {history?.nextCursor && (
                <Button
                  variant="secondary"
                  loading={busy}
                  onClick={() => void moreHistory()}
                >
                  More history
                </Button>
              )}
            </>
          ) : giveaway ? (
            <div className="wr-two-col">
              <Sheet title="Campaign dates">
                <Notice role="status">{locked}</Notice>
                <Timing
                  timing={settings.campaign?.timing}
                  timezone={settings.station.timezone}
                />
              </Sheet>
              <Sheet quiet title="Separate purchase and upload deadlines">
                <p>
                  A grace period does not extend the purchase cutoff. Complete
                  evidence, eligibility checks and final reconciliation are
                  required before announcing winners.
                </p>
                <p>Timing settings alone do not finalize a leaderboard.</p>
              </Sheet>
            </div>
          ) : (
            draft && (
              <div className="wr-two-col wr-settings-editor">
                <Sheet
                  title={
                    confirming ? "Confirm settings change" : "Retention period"
                  }
                  badge={
                    <span className="wr-pill wr-sm">
                      {confirming ? "Not saved yet" : "Deletion off"}
                    </span>
                  }
                >
                  {draft.error && (
                    <Notice role="alert" tone="danger">
                      {draft.error}
                    </Notice>
                  )}
                  {draft.stale && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        save({
                          ...draft,
                          review: null,
                          pending: null,
                          error: "",
                          stale: false,
                        });
                        reload((x) => x + 1);
                        router.push("/admin/settings/retention");
                      }}
                    >
                      Reload settings
                    </Button>
                  )}
                  {confirming ? (
                    draft.review ? (
                      <>
                        <DataTable
                          caption="Previous and proposed values"
                          columns={[
                            { key: "setting", label: "Setting" },
                            { key: "before", label: "Previous" },
                            { key: "after", label: "Proposed" },
                          ]}
                          rows={[
                            {
                              id: "days",
                              cells: {
                                setting: "Photo retention period",
                                before: daysText(
                                  draft.review.before.retention.days,
                                ),
                                after: daysText(
                                  draft.review.after.retention.days,
                                ),
                              },
                            },
                            {
                              id: "deletion",
                              cells: {
                                setting: "Automatic deletion",
                                before: "Disabled",
                                after: "Disabled · unchanged",
                              },
                            },
                          ]}
                        />
                        <KeyValueList
                          items={[
                            {
                              label: "Reason",
                              value: draft.review.proposal.reason,
                            },
                            {
                              label: "Recorded by",
                              value: session.account.name,
                            },
                          ]}
                        />
                        <Notice>
                          This records the intended retention period only.
                          Photos are never deleted automatically.
                        </Notice>
                        <div className="wr-row">
                          <Button loading={busy} onClick={() => void confirm()}>
                            {draft.pending
                              ? "Retry confirmation"
                              : "Confirm changes"}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy || !!draft.pending}
                            onClick={resetReview}
                          >
                            Keep editing
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy || !!draft.pending}
                            onClick={cancel}
                          >
                            Cancel
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p>
                          No current settings review is available. Review the
                          current settings before confirming a change.
                        </p>
                        <Link
                          className="wr-btn wr-btn-secondary"
                          href="/admin/settings/retention"
                        >
                          Review retention changes
                        </Link>
                      </>
                    )
                  ) : (
                    <form
                      noValidate
                      onSubmit={(e) => {
                        e.preventDefault();
                        void review();
                      }}
                    >
                      <TextField
                        label="Photo retention period (days)"
                        inputMode="numeric"
                        value={draft.days}
                        disabled={busy || !!draft.pending || draft.stale}
                        onChange={(e) =>
                          save({
                            ...draft,
                            days: e.target.value,
                            error: "",
                            review: null,
                          })
                        }
                        helper="Positive whole days. Leave blank for Not set. A configured period records the intended policy and does not enable automatic deletion."
                        error={daysError || undefined}
                      />
                      <KeyValueList
                        items={[
                          {
                            label: "Automatic deletion",
                            value: "Disabled · policy approval pending",
                          },
                        ]}
                      />
                      <label className="wr-field">
                        <span className="wr-label">Reason for change</span>
                        <textarea
                          className="wr-input"
                          aria-label="Reason for change"
                          value={draft.reason}
                          disabled={busy || !!draft.pending || draft.stale}
                          required
                          maxLength={1000}
                          onChange={(e) =>
                            save({
                              ...draft,
                              reason: e.target.value,
                              error: "",
                              review: null,
                            })
                          }
                          aria-invalid={
                            draft.error.startsWith("Enter a reason") ||
                            undefined
                          }
                          aria-describedby="settings-reason-help"
                        />
                        <span className="wr-help" id="settings-reason-help">
                          Required. Do not include phone numbers or secrets.
                        </span>
                      </label>
                      <div className="wr-row">
                        <Button
                          type="submit"
                          loading={busy}
                          disabled={
                            !!draft.pending ||
                            draft.stale ||
                            loading ||
                            !!daysError ||
                            !validReason
                          }
                        >
                          Review changes
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={busy || !!draft.pending}
                          onClick={cancel}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  )}
                </Sheet>
                <Sheet
                  quiet
                  title={confirming ? "Settings history" : "Protect evidence"}
                >
                  <p>
                    {confirming
                      ? "After confirmation, Settings lists the previous and new values, administrator, reason and server time."
                      : "An unset period never triggers deletion. Removal stays disabled until the evidence-removal rules, retention start point, audit needs, backup treatment and safeguards are agreed."}
                  </p>
                  <p>
                    Pending uploads are never treated as deletable. Photos are
                    never deleted automatically.
                  </p>
                </Sheet>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
function HistoryValue({
  change,
  side,
}: {
  change: SettingsChange;
  side: "before" | "after";
}) {
  if (change.section === "retention") {
    const value = change[side];
    return (
      <>
        {daysText(value.days)}
        <span className="wr-sub">
          Deletion disabled · {copyText(value.storedCopyPolicy)}
        </span>
      </>
    );
  }
  const value = change[side];
  return (
    <span>
      Launch: {instantText(value.launchAt)}
      <br />
      Start: {instantText(value.purchaseStart)}
      <br />
      Cutoff: {instantText(value.purchaseCutoff)}
      <br />
      Grace:{" "}
      {value.graceHours === null ? "Not set" : `${value.graceHours} hours`}
      <br />
      Deadline: {instantText(value.uploadDeadline)}
      <br />
      {value.timezone}
    </span>
  );
}

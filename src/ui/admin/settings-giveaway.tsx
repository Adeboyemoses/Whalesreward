"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Settings } from "@/shared/contracts/settings";
import { timingReviewSchema } from "@/shared/contracts/settings";
import type { AdminSession } from "@/client/admin-session";
import { AdminError } from "@/client/admin-api";
import {
  AdminSettingsApi,
  settingsMessage,
  settingsUncertain,
  type TimingReview,
  type FrozenTiming,
} from "@/client/admin-settings-api";
import { Button, TextField, Notice, DataTable, KeyValueList } from "@/ui";
import { Sheet } from "./station-common";
import { useAdminSession } from "./session";
export function timingReason(s: Settings, session: AdminSession) {
  if (!session.role?.isOwner)
    return "Only an Owner with settings permission can create or change campaign timing. You can view the saved values.";
  if (!s.timingPolicyVersion)
    return "Campaign timing policy is not configured.";
  if (s.timingLocked)
    return s.campaign?.latestSnapshotId
      ? "Campaign timing is locked because a result has been saved."
      : "Campaign timing is locked because purchases have started or a result has been saved.";
  return "Changes are reviewed, confirmed with a reason and audited.";
}
export function campaignTime(
  value: string | null | undefined,
  timezone: string,
) {
  if (!value) return "Not set";
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hour12: true,
      timeZoneName: "longOffset",
    }).format(new Date(value)) + ` · ${timezone} · ${value}`
  );
}
const fields = [
  ["launchAt", "Launch"],
  ["purchaseStart", "Purchase start"],
  ["purchaseCutoff", "Purchase cutoff"],
  ["timezone", "Campaign timezone"],
  ["graceHours", "Upload grace period (hours)"],
] as const;
type Values = Record<(typeof fields)[number][0], string>;
type Draft = Values & {
  reason: string;
  review: TimingReview | null;
  pending: FrozenTiming | null;
  error: string;
  stale: boolean;
};
export function GiveawayEditor({
  settings,
  session,
  api,
  confirming,
  onSaved,
}: {
  settings: Settings;
  session: AdminSession;
  api: AdminSettingsApi;
  confirming: boolean;
  onSaved: (message: string) => void;
}) {
  const { store, epoch } = useAdminSession(),
    router = useRouter();
  const [draft, setDraft] = useState<Draft>(
    () =>
      (store.lists.get("settings:giveaway") as Draft | undefined) ?? {
        launchAt: settings.campaign?.timing.launchAt ?? "",
        purchaseStart: settings.campaign?.timing.purchaseStart ?? "",
        purchaseCutoff: settings.campaign?.timing.purchaseCutoff ?? "",
        timezone: settings.campaign?.timing.timezone ?? "",
        graceHours: settings.campaign?.timing.graceHours?.toString() ?? "",
        reason: "",
        review: null,
        pending: null,
        error: "",
        stale: false,
      },
  );
  const [busy, setBusy] = useState(false),
    flight = useRef(false),
    alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const valid = () => store.getSnapshot().epoch === epoch;
  function save(value: Draft) {
    if (!valid()) return;
    store.lists.set("settings:giveaway", value);
    if (alive.current) setDraft(value);
  }
  const allowed =
    !!session.role?.isOwner &&
    !!settings.timingPolicyVersion &&
    !settings.timingLocked;
  const proposal = timingReviewSchema.safeParse({
    ...Object.fromEntries(
      fields.map(([key]) => [
        key,
        key === "graceHours" ? Number(draft[key]) : draft[key],
      ]),
    ),
    reason: draft.reason,
    expectedVersion: settings.version,
    ...(settings.campaign
      ? {
          kind: "update",
          campaignId: settings.campaign.id,
          expectedCampaignVersion: settings.campaign.version,
        }
      : { kind: "create", campaignId: null, expectedCampaignVersion: null }),
  });
  const inputValid =
    proposal.success &&
    /^[0-9]+$/.test(draft.graceHours) &&
    Number.isSafeInteger(Number(draft.graceHours));
  function cancel(edit = false) {
    if (draft.pending) return;
    if (edit) {
      save({ ...draft, review: null, error: "" });
      router.push("/admin/settings/giveaway");
    } else {
      store.lists.delete("settings:giveaway");
      router.push("/admin/settings");
    }
  }
  async function act(confirm: boolean) {
    if (flight.current || (!allowed && !draft.pending)) return;
    if (!confirm && !proposal.success) return;
    flight.current = true;
    setBusy(true);
    const frozen = confirm
      ? (draft.pending ??
        (draft.review ? api.freezeTiming(draft.review) : null))
      : null;
    save({ ...draft, pending: frozen, error: "" });
    try {
      if (confirm && frozen) {
        const receipt = await api.confirmTiming(frozen);
        if (!valid()) return;
        store.lists.delete("settings:giveaway");
        onSaved(
          `Campaign timing saved · campaign ${receipt.section === "giveaway" ? receipt.campaignId : ""} · settings version ${receipt.version}.`,
        );
        router.push("/admin/settings");
      } else if (proposal.success) {
        const review = await api.reviewTiming(proposal.data);
        if (!valid()) return;
        save({ ...draft, review, error: "", stale: false });
        if (alive.current) router.push("/admin/settings/giveaway/confirm");
      }
    } catch (e) {
      if (!valid()) return;
      const uncertain = confirm && settingsUncertain(e);
      save({
        ...draft,
        review: uncertain ? draft.review : null,
        pending: uncertain ? frozen : null,
        error: uncertain
          ? "The confirmation result is uncertain. Retry the same confirmation before starting another change."
          : settingsMessage(e),
        stale: !uncertain,
      });
      if (e instanceof AdminError && e.code === "owner_required")
        void store.refresh();
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const review = draft.review;
  const timingRows = (
    timing: Settings["campaign"] extends infer C
      ? NonNullable<C> extends { timing: infer T }
        ? T
        : never
      : never,
  ) => [
    ...fields.map(([key, label]) => ({
      label,
      value:
        key === "graceHours"
          ? `${timing.graceHours ?? "Not set"} hours`
          : key === "timezone"
            ? timing.timezone
            : campaignTime(timing[key], timing.timezone),
    })),
    {
      label: "Upload deadline (derived)",
      value: campaignTime(timing.uploadDeadline, timing.timezone),
    },
  ];
  return (
    <div className="wr-two-col wr-settings-editor">
      <Sheet
        title={confirming ? "Confirm settings change" : "Campaign dates"}
        badge={
          <span className="wr-pill wr-sm">
            {confirming
              ? "Not saved yet"
              : settings.campaign
                ? "Edit campaign"
                : "Create campaign"}
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
            onClick={() => {
              store.lists.delete("settings:giveaway");
              onSaved("");
              router.push("/admin/settings");
            }}
          >
            Reload settings
          </Button>
        )}
        {!allowed && !draft.pending ? (
          <>
            <Notice role="status">{timingReason(settings, session)}</Notice>
            <KeyValueList
              items={
                settings.campaign
                  ? timingRows(settings.campaign.timing)
                  : fields.map(([, label]) => ({ label, value: "Not set" }))
              }
            />
          </>
        ) : confirming ? (
          review ? (
            <>
              <div className="wr-settings-comparison">
                <DataTable
                  caption="Previous and proposed values"
                  columns={[
                    { key: "setting", label: "Setting" },
                    { key: "before", label: "Previous" },
                    { key: "after", label: "Proposed" },
                  ]}
                  rows={timingRows(review.after.campaign!.timing).map(
                    (row, index) => ({
                      id: String(index),
                      cells: {
                        setting: row.label,
                        before: review.before.campaign
                          ? timingRows(review.before.campaign.timing)[index]!
                              .value
                          : "Not set",
                        after: row.value,
                      },
                    }),
                  )}
                />
              </div>
              <KeyValueList
                items={[
                  { label: "Reason", value: review.proposal.reason },
                  { label: "Recorded by", value: session.account.name },
                ]}
              />
              <Notice>
                Saving the dates does not finalize the leaderboard. Final
                results still need complete uploads, eligibility checks and
                reconciliation.
              </Notice>
              <div className="wr-row">
                <Button loading={busy} onClick={() => void act(true)}>
                  {draft.pending ? "Retry confirmation" : "Confirm changes"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || !!draft.pending}
                  onClick={() => cancel(true)}
                >
                  Keep editing
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || !!draft.pending}
                  onClick={() => cancel()}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p>
                No current settings review is available. Review the current
                settings before confirming a change.
              </p>
              <Link
                className="wr-btn wr-btn-secondary"
                href="/admin/settings/giveaway"
              >
                Review giveaway changes
              </Link>
            </>
          )
        ) : draft.pending ? (
          <Notice>
            A confirmation is unresolved.{" "}
            <Link href="/admin/settings/giveaway/confirm">
              Return to confirmation
            </Link>
          </Notice>
        ) : (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void act(false);
            }}
          >
            {fields.map(([key, label]) => (
              <TextField
                key={key}
                label={label}
                value={draft[key]}
                disabled={busy || draft.stale}
                inputMode={key === "graceHours" ? "numeric" : undefined}
                helper={
                  key === "timezone"
                    ? "Enter the campaign timezone, for example an IANA zone name. Dates must include their explicit UTC offset."
                    : key === "graceHours"
                      ? "Whole hours. Use 0 for no additional grace."
                      : "Enter an exact ISO date and time with offset, including seconds (YYYY-MM-DDTHH:mm:ss+HH:mm)."
                }
                onChange={(e) =>
                  save({
                    ...draft,
                    [key]: e.target.value,
                    review: null,
                    error: "",
                  })
                }
              />
            ))}
            <p className="wr-notice">
              Upload deadline (derived): shown by the server after Review
              changes.
            </p>
            <label className="wr-field">
              <span className="wr-label">Reason for change</span>
              <textarea
                className="wr-input"
                aria-label="Reason for change"
                required
                maxLength={1000}
                value={draft.reason}
                disabled={busy || draft.stale}
                onChange={(e) =>
                  save({ ...draft, reason: e.target.value, error: "" })
                }
              />
              <span className="wr-help">
                Required. Do not include phone numbers or secrets.
              </span>
            </label>
            <div className="wr-row">
              <Button
                type="submit"
                loading={busy}
                disabled={!inputValid || draft.stale}
              >
                Review changes
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => cancel()}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </Sheet>
      <Sheet quiet title="Separate purchase and upload deadlines">
        <p>
          A grace period does not extend the purchase cutoff. Complete evidence,
          eligibility checks and final reconciliation are required before
          announcing winners.
        </p>
        <p>Timing settings alone do not finalize a leaderboard.</p>
      </Sheet>
    </div>
  );
}

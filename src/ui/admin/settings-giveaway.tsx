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
import {
  Button,
  TextField,
  Notice,
  DataTable,
  KeyValueList,
  TimezoneCombobox,
  wallClockToInstant,
  instantToWallClock,
} from "@/ui";
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
type WallParts = { date: string; time: string };
type WallClockKey = "launchAt" | "purchaseStart" | "purchaseCutoff";
type Draft = Values & {
  // The wall-clock date/time text the user is editing for each instant
  // field, kept independently of the committed ISO instant in `launchAt` /
  // `purchaseStart` / `purchaseCutoff` above. This is the source of truth
  // for what the date/time <TextField>s display: it holds a provisional,
  // not-yet-complete edit (e.g. a date typed in before its time) without
  // waiting on `wallClockToInstant`, which can only resolve once both parts
  // are present. The ISO fields are derived from this and re-derived
  // whenever the timezone changes.
  wall: Record<WallClockKey, WallParts>;
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
  const [draft, setDraft] = useState<Draft>(() => {
    const persisted = store.lists.get("settings:giveaway") as
      | Draft
      | undefined;
    if (persisted) return persisted;
    const timezone = settings.campaign?.timing.timezone ?? "Africa/Lagos";
    const wallFor = (value: string | null | undefined): WallParts =>
      instantToWallClock(value, timezone) ?? { date: "", time: "" };
    return {
      launchAt: settings.campaign?.timing.launchAt ?? "",
      purchaseStart: settings.campaign?.timing.purchaseStart ?? "",
      purchaseCutoff: settings.campaign?.timing.purchaseCutoff ?? "",
      timezone,
      graceHours: settings.campaign?.timing.graceHours?.toString() ?? "",
      wall: {
        launchAt: wallFor(settings.campaign?.timing.launchAt),
        purchaseStart: wallFor(settings.campaign?.timing.purchaseStart),
        purchaseCutoff: wallFor(settings.campaign?.timing.purchaseCutoff),
      },
      reason: "",
      review: null,
      pending: null,
      error: "",
      stale: false,
    };
  });
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
            <TimezoneCombobox
              label="Campaign timezone"
              value={draft.timezone}
              disabled={busy || draft.stale}
              helper="Search by IANA zone name, for example Africa/Lagos. The dates below are wall-clock time in this zone."
              onChange={(zone) => {
                // A field that already resolves to a committed instant keeps
                // that same absolute instant (switching the campaign's zone
                // doesn't move launch/purchase moments); only its displayed
                // wall-clock text is re-expressed in the new zone. A field
                // still mid-edit (no instant yet) keeps its literal,
                // not-yet-resolved text untouched -- there is no instant to
                // re-express it from.
                const wall = { ...draft.wall };
                for (const key of [
                  "launchAt",
                  "purchaseStart",
                  "purchaseCutoff",
                ] as const) {
                  if (draft[key])
                    wall[key] =
                      instantToWallClock(draft[key], zone) ?? wall[key];
                }
                save({ ...draft, wall, timezone: zone, review: null, error: "" });
              }}
            />
            {(
              [
                ["launchAt", "Launch"],
                ["purchaseStart", "Purchase start"],
                ["purchaseCutoff", "Purchase cutoff"],
              ] as const
            ).map(([key, label]) => {
              // The wall-clock text itself is the source of truth for what
              // these two fields display, so a provisional edit to one part
              // of the pair (e.g. a date typed in before its time) survives
              // re-render even though `wallClockToInstant` cannot resolve an
              // ISO instant yet.
              const wall = draft.wall[key];
              function setWallClock(part: "date" | "time", raw: string) {
                const nextWall: WallParts =
                  part === "date"
                    ? { ...wall, date: raw }
                    : { ...wall, time: raw };
                const iso =
                  nextWall.date && nextWall.time
                    ? wallClockToInstant(
                        nextWall.date,
                        nextWall.time,
                        draft.timezone,
                      )
                    : null;
                save({
                  ...draft,
                  [key]: iso ?? "",
                  wall: { ...draft.wall, [key]: nextWall },
                  review: null,
                  error: "",
                });
              }
              return (
                <div key={key} className="wr-row wr-settings-datetime">
                  <TextField
                    type="date"
                    label={`${label} date`}
                    value={wall.date}
                    disabled={busy || draft.stale}
                    onChange={(e) => setWallClock("date", e.target.value)}
                  />
                  <TextField
                    type="time"
                    step={1}
                    label={`${label} time`}
                    value={wall.time}
                    disabled={busy || draft.stale}
                    helper={
                      key === "launchAt"
                        ? "Wall-clock time in the campaign timezone above, with seconds."
                        : undefined
                    }
                    onChange={(e) => setWallClock("time", e.target.value)}
                  />
                </div>
              );
            })}
            <TextField
              label="Upload grace period (hours)"
              value={draft.graceHours}
              disabled={busy || draft.stale}
              inputMode="numeric"
              helper="Whole hours. Use 0 for no additional grace."
              onChange={(e) =>
                save({
                  ...draft,
                  graceHours: e.target.value,
                  review: null,
                  error: "",
                })
              }
            />
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

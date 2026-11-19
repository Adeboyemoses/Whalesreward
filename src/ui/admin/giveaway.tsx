"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { AdminSession } from "@/client/admin-session";
import {
  giveawayMessage,
  giveawayUncertain,
  matchingPreview,
  type FrozenPreparation,
  type FrozenConfirmation,
} from "@/client/admin-giveaway-api";
import type {
  Campaign,
  Preview,
  Readiness,
} from "@/client/admin-giveaway-schemas";
import { categorySchema } from "@/shared/contracts/customers-cards";
import { adminAction, adminTime } from "@/client/admin-display";
import { Button, KeyValueList, Notice, StatusPill } from "@/ui";
import { PageHead, Reason, SelectField, Sheet } from "./station-common";
import {
  CategoryField,
  GiveawayReadState,
  Pager,
  TimingFacts,
  TotalFacts,
  useGiveawayApi,
  useGiveawayRead,
  usePageCursor,
} from "./giveaway-common";
import {
  CustomerChanges,
  EvidenceFacts,
  ExcludedValues,
  FrozenRanking,
  PurchaseChanges,
  SnapshotSources,
  SnapshotSummary,
} from "./giveaway-results";
import { LeaderboardsPage, LiveRanking } from "./leaderboards";
import { useAdminSession } from "./session";
import { ManagerPage } from "./checklist-manager";
import { PhonesPage } from "./checklist-phones";
import { UnavailablePage, ExclusionPage } from "./checklist-exclusions";
import {
  ChecklistPending,
  useChecklistApi,
  useChecklistMutation,
} from "./checklist-common";
import { LiveChecks, StoredChecks } from "./checklist-outcomes";
import type { z } from "zod";
import type { checklistProjectionSchema } from "@/shared/contracts/giveaway-projections";
type Draft = {
  reason: string;
  preview: Preview | null;
  pending:
    | { kind: "prepare"; value: FrozenPreparation }
    | { kind: "confirm"; value: FrozenConfirmation }
    | null;
  error: string;
  message: string;
  stopped: boolean;
  savedId: string | null;
};
const emptyDraft: Draft = {
  reason: "",
  preview: null,
  pending: null,
  error: "",
  message: "",
  stopped: false,
  savedId: null,
};
export function LeaderboardsPortal({
  path,
  session,
}: {
  path: string[];
  session: AdminSession;
}) {
  if (path[1] === "finalize" && path[2] === "manager")
    return <ManagerPage session={session} />;
  if (!session.permissions?.includes("leaderboards"))
    return (
      <Notice tone="danger" role="alert">
        Your current permissions do not allow leaderboard access.
      </Notice>
    );
  if (!path[1]) return <LeaderboardsPage session={session} />;
  if (path[1] === "finalize" && path[2] === "phones") {
    if (!session.permissions?.includes("sales"))
      return (
        <Notice tone="warning">
          Your current permissions do not allow this action.
        </Notice>
      );
    if (path[3] && path[4] === "unavailable")
      return (
        <UnavailablePage key={path[3]} session={session} phoneId={path[3]} />
      );
    return <PhonesPage session={session} />;
  }
  if (path[1] === "finalize" && path[2] === "exclusions" && path[3]) {
    if (!session.permissions?.includes("sales"))
      return (
        <Notice tone="warning">
          Your current permissions do not allow this action.
        </Notice>
      );
    return (
      <ExclusionPage key={path[3]} session={session} exclusionId={path[3]} />
    );
  }
  if (path[1] !== "finalize" || (path[2] && path[2] !== "confirm"))
    return (
      <Notice>
        This record is unavailable.{" "}
        <Link href="/admin/leaderboards/finalize">
          Back to finalization checks
        </Link>
      </Notice>
    );
  return <GiveawayPage session={session} confirming={path[2] === "confirm"} />;
}
const blockerCopy: Record<string, string> = {
  campaign_unconfigured: "Campaign values are not configured.",
  timing_policy_unconfigured: "Campaign timing policy is not configured.",
  before_cutoff: "Purchase cutoff has not passed.",
  grace_open: "Upload grace period is still open.",
  reviews_unresolved:
    "Unresolved holds and pending two-person release proposals block saving giveaway results, revisions and unchanged reconciliation.",
  uploads_unresolved:
    "Server-known sales need upload or complete-photo evidence resolution.",
  eligibility_unresolved: "Campaign eligibility remains unresolved.",
  reconciliation_policy_unconfigured:
    "Finalization checklist policy is not configured. An Owner must arrange configuration; no check can be certified.",
  reconciliation_required:
    "Server reconciliation must be run for the current records. Preparation reruns the checks; a reason alone cannot pass them.",
  phone_check_required:
    "A current complete phone check is required. Missing or stale phone evidence blocks finalization.",
  phone_exclusion_pending:
    "An unavailable-phone proposal is awaiting a decision.",
};
function ReadinessSheet({
  ready,
  session,
  projection,
}: {
  projection: z.infer<typeof checklistProjectionSchema>;
  ready: Readiness;
  session: AdminSession;
}) {
  const sales = !!session.permissions?.includes("sales");
  return (
    <Sheet
      title="Finalization checks"
      badge={
        <StatusPill small tone={ready.canPrepare ? "synced" : "held"}>
          {ready.canPrepare ? "Ready to prepare" : "Blocked"}
        </StatusPill>
      }
    >
      <TimingFacts timing={ready.campaign.timing} asOf={ready.asOf} />
      <h3>Reported readiness groups</h3>
      <KeyValueList
        items={[
          {
            label: "Sales with holds or pending hold releases",
            value: ready.counts.holds,
          },
          { label: "Unresolved corrections", value: ready.counts.corrections },
          {
            label: "Unresolved duplicate flags",
            value: ready.counts.duplicateFlags,
          },
          {
            label: "Incomplete uploads and complete-photo evidence",
            value: ready.counts.uploads,
          },
          {
            label: "Sales with policy checks or pending capture releases",
            value: ready.counts.policyBlocks,
          },
        ]}
      />
      <p className="wr-help">
        These groups overlap. Do not add the counts. Per-check outcomes below
        use the same server snapshot.
      </p>
      {ready.blockers.length > 0 && (
        <ul className="wr-giveaway-blockers">
          {ready.blockers.map((b) => (
            <li key={b}>
              {b === "reviews_unresolved" && (
                <>
                  <b>Reviews still need decisions</b>
                  <br />
                </>
              )}
              {blockerCopy[b]}
              {(b === "campaign_unconfigured" ||
                b === "timing_policy_unconfigured") &&
                session.permissions?.includes("settings") && (
                  <>
                    {" "}
                    <Link href="/admin/settings/giveaway">
                      Set campaign values
                    </Link>
                  </>
                )}
              {[
                "reviews_unresolved",
                "uploads_unresolved",
                "eligibility_unresolved",
              ].includes(b) &&
                sales && (
                  <>
                    {" "}
                    <Link href="/admin/sales">View sales</Link>
                  </>
                )}
            </li>
          ))}
        </ul>
      )}
      {sales && (
        <div className="wr-row wr-giveaway-actions">
          <Link
            className="wr-btn wr-btn-secondary"
            href="/admin/sales/reviews?view=pending_release"
          >
            Open review queue
          </Link>
          <Link className="wr-btn wr-btn-ghost" href="/admin/sales">
            Review uploads and sales
          </Link>
        </div>
      )}

      <LiveChecks projection={projection} />
      <div className="wr-row wr-giveaway-actions">
        {session.role?.isOwner &&
          session.permissions?.includes("settings") &&
          sales && (
            <Link
              className="wr-btn wr-btn-secondary"
              href="/admin/leaderboards/finalize/manager"
            >
              Campaign station manager
            </Link>
          )}
        {sales && (
          <Link
            className="wr-btn wr-btn-secondary"
            href="/admin/leaderboards/finalize/phones"
          >
            Phone census
          </Link>
        )}
      </div>
      <KeyValueList
        items={[
          {
            label: "Phone evidence",
            value: adminAction(ready.phoneCheck.state),
          },
          {
            label: "Designated manager ID",
            value: ready.phoneCheck.managerAdminId ?? "Not designated",
            mono: true,
          },
          {
            label: "Census version",
            value: String(ready.phoneCheck.censusVersion),
          },
          {
            label: "Phone check ID",
            value: ready.phoneCheck.phoneCheckId ?? "None",
            mono: true,
          },
          {
            label: "Pending unavailable-phone proposals",
            value: ready.phoneCheck.pendingExclusions,
          },
        ]}
      />
      <p className="wr-help">
        Unsent sales still only on phones are unknown until inspected. Server
        counts do not prove a phone is empty.
      </p>
    </Sheet>
  );
}
export function GiveawayPage({
  session,
  confirming = false,
}: {
  session: AdminSession;
  confirming?: boolean;
}) {
  const checklistApi = useChecklistApi();
  const checklistMutation = useChecklistMutation();
  const api = useGiveawayApi(),
    { store, epoch } = useAdminSession(),
    router = useRouter(),
    search = useSearchParams();
  const categoryResult = categorySchema.safeParse(search.get("category")),
    category = categoryResult.success ? categoryResult.data : undefined;
  const suffix = category ? `?category=${category}` : "";
  const [draft, setDraft] = useState<Draft>(
    () =>
      (store.lists.get("giveaway:draft") as Draft | undefined) ?? {
        ...emptyDraft,
      },
  );
  const [busy, setBusy] = useState(false),
    flight = useRef(false),
    mounted = useRef(false),
    errorRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (draft.error) errorRef.current?.focus();
  }, [draft.error]);
  const valid = () => store.getSnapshot().epoch === epoch;
  function update(value: Draft) {
    if (!valid()) return;
    store.lists.set("giveaway:draft", value);
    if (mounted.current) setDraft(value);
  }
  const load = useCallback(async () => {
    const { campaign } = await api.campaign();
    const projection = campaign
      ? await checklistApi.checklist(campaign.id)
      : null;
    return { campaign, ready: projection?.readiness ?? null, projection };
  }, [api, checklistApi]);
  const result = useGiveawayRead(
      `giveaway:current:${checklistMutation.serial}`,
      load,
    ),
    ready = result.data?.ready ?? null,
    campaign = ready?.campaign ?? result.data?.campaign ?? null;
  const previewLoad = useCallback(
    async () =>
      draft.preview
        ? api.preview(draft.preview.campaignId, draft.preview.id)
        : null,
    [api, draft.preview],
  );
  const previewRead = useGiveawayRead(
    `preview:${draft.preview?.id ?? "none"}`,
    previewLoad,
  );
  const currentPreview = previewRead.data;
  const canConfirm = !!(
    draft.preview &&
    currentPreview &&
    ready &&
    !previewRead.busy &&
    !previewRead.error &&
    !result.busy &&
    !result.error &&
    matchingPreview(
      currentPreview,
      ready,
      session.account.adminId ?? session.account.id,
    ) &&
    currentPreview.contentDigest === draft.preview.contentDigest
  );
  const action = campaign?.latestSnapshotId
      ? "giveawayRevise"
      : "giveawayFinalize",
    allowed = !!session.permissions?.includes(action);
  const locked = busy || !!draft.pending || checklistMutation.locked;
  const fresh = () => {
    if (draft.pending) return;
    update({ ...emptyDraft });
    result.reload();
    previewRead.reload();
    router.push("/admin/leaderboards/finalize" + suffix);
  };
  async function prepare() {
    if (
      flight.current ||
      !valid() ||
      (!draft.pending && (!campaign || !ready?.canPrepare || !allowed))
    )
      return;
    if (draft.pending?.kind === "confirm") return;
    if (
      draft.pending?.kind === "prepare" &&
      !session.permissions?.includes(
        draft.pending.value.body.kind === "revision"
          ? "giveawayRevise"
          : "giveawayFinalize",
      )
    )
      return;
    flight.current = true;
    setBusy(true);
    let pending =
      draft.pending?.kind === "prepare" ? draft.pending.value : null;
    try {
      pending ??= api.freezePreparation(
        campaign!,
        campaign!.latestSnapshotId ? "revision" : "initial",
        draft.reason,
      );
      update({
        ...draft,
        pending: { kind: "prepare", value: pending },
        error: "",
        message: "",
        stopped: false,
      });
      const receipt = await api.prepare(pending);
      if (!valid()) return;
      if ("state" in receipt) {
        update({
          ...emptyDraft,
          message:
            "Reconciliation recorded. The saved result is unchanged; no new snapshot was created.",
          savedId: receipt.currentSnapshotId,
        });
        if (mounted.current) {
          result.reload();
          router.push("/admin/leaderboards/finalize" + suffix);
        }
      } else {
        update({
          ...draft,
          pending: null,
          preview: receipt,
          error: "",
          message: "Snapshot preview · not saved",
          stopped: false,
        });
        if (mounted.current) {
          result.reload();
          router.push("/admin/leaderboards/finalize/confirm" + suffix);
        }
      }
    } catch (e) {
      if (!valid()) return;
      update({
        ...draft,
        pending:
          pending && giveawayUncertain(e)
            ? { kind: "prepare", value: pending }
            : null,
        error: giveawayUncertain(e)
          ? "The result of this request is uncertain. Retry the same request before starting another change."
          : giveawayMessage(e),
        stopped: !giveawayUncertain(e),
      });
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function confirm() {
    if (
      flight.current ||
      !valid() ||
      !draft.preview ||
      (!draft.pending && !canConfirm)
    )
      return;
    if (draft.pending?.kind === "prepare") return;
    const grant =
      draft.preview.kind === "revision" ? "giveawayRevise" : "giveawayFinalize";
    if (!session.permissions?.includes(grant)) return;
    flight.current = true;
    setBusy(true);
    const pending =
      draft.pending?.kind === "confirm"
        ? draft.pending.value
        : api.freezeConfirmation(draft.preview);
    update({
      ...draft,
      pending: { kind: "confirm", value: pending },
      error: "",
      message: "",
    });
    try {
      const saved = await api.confirm(pending);
      if (!valid()) return;
      update({
        ...emptyDraft,
        savedId: saved.id,
        message: `Snapshot ${saved.number} saved. This is the recorded receipt; current readiness is shown separately.`,
      });
      if (mounted.current) {
        result.reload();
        router.push("/admin/leaderboards/finalize" + suffix);
      }
    } catch (e) {
      if (!valid()) return;
      update({
        ...draft,
        pending: giveawayUncertain(e)
          ? { kind: "confirm", value: pending }
          : null,
        error: giveawayUncertain(e)
          ? "The result of this request is uncertain. Retry the same request before starting another change."
          : giveawayMessage(e),
        stopped: !giveawayUncertain(e),
      });
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const confirmView = confirming && !!draft.preview;
  return (
    <div className="wr-giveaway-page">
      <PageHead
        title="Finalize leaderboard"
        eyebrow="Leaderboards / Giveaway"
        subtitle="Save a dated result for manual prize distribution."
        back={{
          href: "/admin/leaderboards" + suffix,
          label: "Back to leaderboards",
        }}
      />
      <ChecklistPending />
      <GiveawayReadState {...result} />
      {draft.message && <Notice role="status">{draft.message}</Notice>}
      {draft.error && (
        <div ref={errorRef} tabIndex={-1}>
          <Notice tone="danger" role="alert">
            {draft.error}
          </Notice>
        </div>
      )}
      {draft.pending && (
        <Sheet title="Request awaiting a confirmed result">
          <p>
            The request is retained in this signed-in session. Retry it before
            starting another change.
          </p>
          <Button
            loading={busy}
            onClick={() =>
              void (draft.pending?.kind === "prepare" ? prepare() : confirm())
            }
          >
            Retry same request
          </Button>
        </Sheet>
      )}
      {!result.busy && !result.error && !campaign && (
        <Notice tone="warning">
          <b>Not configured.</b> Campaign values are not configured. No final
          snapshot can be prepared.
          {session.permissions?.includes("settings") && (
            <>
              {" "}
              <Link href="/admin/settings/giveaway">Set campaign values</Link>
            </>
          )}
        </Notice>
      )}
      {confirming && !draft.preview && !draft.pending && (
        <Notice>
          There is no reviewed change to confirm.{" "}
          <Link href={"/admin/leaderboards/finalize" + suffix}>
            Back to finalization checks
          </Link>
        </Notice>
      )}
      {!confirmView && ready && (
        <Notice tone={ready.canPrepare ? "info" : "warning"}>
          {ready.canPrepare
            ? "The server allows preparation. Review the current evidence and enter a reason before preparing a frozen preview."
            : "Finalization blocked. Resolve the reported readiness blockers before preparing a result."}
        </Notice>
      )}
      {confirmView && draft.preview && (
        <Notice>
          Snapshot preview · not saved. Preparation recorded reconciliation;
          confirmation saves the frozen result. Preparation outcomes are
          historical and bound to this preview.
        </Notice>
      )}
      <div className="wr-two-col">
        {ready && result.data?.projection && (
          <ReadinessSheet
            ready={ready}
            session={session}
            projection={result.data.projection}
          />
        )}{" "}
        {confirmView && draft.preview ? (
          <Sheet
            title={
              draft.preview.kind === "revision"
                ? "Review audited revision"
                : "Review final snapshot"
            }
          >
            <GiveawayReadState {...previewRead} />
            <p>
              This saves a dated snapshot of the ranking below. Later accepted
              changes require an audited revision; earlier snapshots are never
              overwritten.
            </p>
            <p>
              <b>
                {draft.preview.kind === "revision"
                  ? "Revision reason"
                  : "Reconciliation reason"}
                :
              </b>{" "}
              {draft.preview.reason}
            </p>
            <KeyValueList
              items={[
                {
                  label: "Prepared by",
                  value: `${draft.preview.createdBy.name} / ${draft.preview.createdBy.code}`,
                },
                {
                  label: "Prepared at",
                  value: adminTime(draft.preview.preparedAt),
                },
                { label: "Preview expires", value: draft.preview.expiresAt },
                { label: "Preview ID", value: draft.preview.id, mono: true },
              ]}
            />
            <TotalFacts
              totals={draft.preview.totals}
              customers={draft.preview.customers}
            />
            {!canConfirm &&
              !draft.pending &&
              !result.busy &&
              !previewRead.busy && (
                <Notice tone="warning">
                  This preview cannot currently be confirmed. Refresh the checks
                  and prepare a new preview if the review is stale, expired,
                  consumed or belongs to another admin.
                </Notice>
              )}
            <div className="wr-row wr-giveaway-actions">
              <Button
                loading={busy}
                disabled={locked || !canConfirm || draft.stopped}
                onClick={() => void confirm()}
              >
                {draft.preview.kind === "revision"
                  ? "Confirm and save revision"
                  : "Confirm and save snapshot"}
              </Button>
              <Button
                variant="ghost"
                disabled={locked}
                onClick={() => {
                  update({
                    ...draft,
                    preview: null,
                    error: "",
                    stopped: false,
                  });
                  router.push("/admin/leaderboards/finalize" + suffix);
                }}
              >
                Keep reviewing
              </Button>
            </div>
            <details>
              <summary>Frozen campaign timing and evidence</summary>
              <TimingFacts timing={draft.preview.timing} />
              <EvidenceFacts value={draft.preview} />
            </details>
          </Sheet>
        ) : (
          campaign && (
            <History
              key={campaign.id + ":" + campaign.latestSnapshotId}
              campaign={campaign}
              selectedId={draft.savedId}
              onSelect={(id) => {
                update({ ...draft, savedId: id });
              }}
            />
          )
        )}
      </div>
      {!confirmView && campaign && (
        <>
          {(draft.savedId ?? campaign.latestSnapshotId) && (
            <SavedResult
              key={draft.savedId ?? campaign.latestSnapshotId!}
              campaignId={campaign.id}
              id={(draft.savedId ?? campaign.latestSnapshotId)!}
              session={session}
            />
          )}
          {draft.preview && (
            <Sheet title="Prepared preview">
              <p>A frozen preview is available in this signed-in session.</p>
              <Link
                className="wr-btn wr-btn-secondary"
                href={"/admin/leaderboards/finalize/confirm" + suffix}
              >
                Resume snapshot review
              </Link>
            </Sheet>
          )}
          {draft.stopped && !draft.pending && (
            <Button variant="secondary" onClick={fresh}>
              Refresh checks and review again
            </Button>
          )}
          {!draft.preview && ready && !draft.stopped && (
            <Sheet
              title={
                campaign.latestSnapshotId
                  ? "Prepare audited revision"
                  : "Review final snapshot"
              }
            >
              <p>
                Preparation records reconciliation and a preview. It does not
                save a final result or change any purchase. A reason alone
                cannot certify unresolved work.
              </p>
              {allowed ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void prepare();
                  }}
                >
                  <Reason
                    label={
                      campaign.latestSnapshotId
                        ? "Revision reason"
                        : "Reconciliation reason"
                    }
                    value={draft.reason}
                    onChange={(reason) => update({ ...draft, reason })}
                    disabled={locked}
                  />
                  <Button
                    type="submit"
                    loading={busy}
                    disabled={
                      locked || !ready.canPrepare || !draft.reason.trim()
                    }
                  >
                    {campaign.latestSnapshotId
                      ? "Prepare audited revision"
                      : "Review final snapshot"}
                  </Button>
                </form>
              ) : (
                <p>
                  Your current permissions do not allow{" "}
                  {campaign.latestSnapshotId
                    ? "giveaway revisions"
                    : "giveaway finalization"}
                  . These permissions are granted separately.
                </p>
              )}
            </Sheet>
          )}
          <LiveRanking
            key={campaign.id + ":" + category}
            campaignId={campaign.id}
            category={category}
            caption="Preview ranking · not final"
          />
        </>
      )}
      {confirmView && draft.preview && (
        <>
          {session.permissions?.includes("sales") && (
            <StoredChecks
              campaignId={draft.preview.campaignId}
              id={draft.preview.reconciliationId}
            />
          )}
          <CategoryField
            value={category}
            onChange={(value) =>
              router.push(
                "/admin/leaderboards/finalize/confirm" +
                  (value ? `?category=${value}` : ""),
              )
            }
          />
          <FrozenRanking
            key={draft.preview.id + category}
            campaignId={draft.preview.campaignId}
            collection="previews"
            id={draft.preview.id}
            category={category}
          />
          <ExcludedValues exclusions={draft.preview.exclusions} />
          <CustomerChanges
            key={draft.preview.id}
            campaignId={draft.preview.campaignId}
            collection="previews"
            id={draft.preview.id}
          />
          {session.permissions?.includes("sales") && (
            <PurchaseChanges
              key={draft.preview.id}
              campaignId={draft.preview.campaignId}
              collection="previews"
              id={draft.preview.id}
              audit={!!session.permissions?.includes("audit")}
            />
          )}
        </>
      )}
      <div className="wr-row wr-giveaway-actions">
        <Button
          variant="secondary"
          disabled={locked}
          onClick={() => {
            result.reload();
            previewRead.reload();
          }}
        >
          Refresh current readiness
        </Button>
        {session.permissions?.includes("audit") && (
          <Link className="wr-btn wr-btn-ghost" href="/admin/audit">
            View audit history
          </Link>
        )}
      </div>
    </div>
  );
}
function History({
  campaign,
  selectedId,
  onSelect,
}: {
  campaign: Campaign;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const api = useGiveawayApi(),
    pages = usePageCursor();
  const load = useCallback(
    () => api.snapshots(campaign.id, pages.cursor),
    [api, campaign.id, pages.cursor],
  );
  const result = useGiveawayRead(
    `history:${campaign.id}:${campaign.latestSnapshotId}:${pages.cursor}`,
    load,
  );
  const selected = selectedId ?? campaign.latestSnapshotId;
  return (
    <Sheet title="Snapshot and revision history">
      <GiveawayReadState
        {...result}
        reload={() => {
          pages.reset();
          result.reload();
        }}
      />
      {result.data && (
        <>
          {!result.data.items.length && (
            <p>No final snapshot saved. Current figures are a preview.</p>
          )}
          {result.data.items.length > 0 && (
            <SelectField
              label="Saved snapshot"
              value={selected ?? ""}
              onChange={onSelect}
            >
              <option value="" disabled>
                Select a saved snapshot
              </option>
              {selected &&
                !result.data.items.some((s) => s.id === selected) && (
                  <option value={selected}>
                    Selected snapshot · {selected}
                  </option>
                )}
              {result.data.items.map((s) => (
                <option value={s.id} key={s.id}>
                  Revision {s.number} · {adminTime(s.finalizedAt)}
                </option>
              ))}
            </SelectField>
          )}
          {result.data.items.map((s) => (
            <div className="wr-giveaway-history" key={s.id}>
              <Button variant="link" onClick={() => onSelect(s.id)}>
                Revision {s.number}
              </Button>
              <p>
                {adminTime(s.finalizedAt)} · {s.actor.name} /{" "}
                <span className="wr-mono">{s.actor.code}</span>
              </p>
              <p>
                {s.previousSnapshotId
                  ? "Revises " + s.previousSnapshotId + "; original retained."
                  : "Initial snapshot."}{" "}
                Reason: {s.reason}
              </p>
            </div>
          ))}
          <Pager
            previous={pages.previous}
            next={!!result.data.nextCursor}
            busy={result.busy}
            onPrevious={pages.back}
            onNext={() => pages.next(result.data!.nextCursor)}
          />
        </>
      )}
      <p className="wr-help">
        Each revision keeps the earlier snapshot selectable. Nothing here
        assigns or sends prizes.
      </p>
    </Sheet>
  );
}
function SavedResult({
  campaignId,
  id,
  session,
}: {
  campaignId: string;
  id: string;
  session: AdminSession;
}) {
  const api = useGiveawayApi(),
    search = useSearchParams(),
    router = useRouter();
  const load = useCallback(
    () => api.snapshot(campaignId, id),
    [api, campaignId, id],
  );
  const result = useGiveawayRead(`snapshot:${id}`, load),
    snapshot = result.data;
  const c = categorySchema.safeParse(search.get("category")),
    category = c.success ? c.data : undefined;
  return (
    <div className="wr-giveaway-saved">
      <GiveawayReadState {...result} />
      {snapshot && (
        <>
          <Notice>
            Viewing saved revision {snapshot.number}. Saved snapshots do not
            change when later corrections occur.
          </Notice>
          <h3>Final snapshot · revision {snapshot.number}</h3>
          <SnapshotSummary snapshot={snapshot} />
          {session.permissions?.includes("sales") && (
            <StoredChecks
              campaignId={campaignId}
              id={snapshot.reconciliationId}
            />
          )}
          <details>
            <summary>Saved campaign timing</summary>
            <TimingFacts timing={snapshot.timing} />
          </details>
          <CategoryField
            value={category}
            onChange={(value) =>
              router.push(
                "/admin/leaderboards/finalize" +
                  (value ? `?category=${value}` : ""),
              )
            }
          />
          <FrozenRanking
            key={id + category}
            campaignId={campaignId}
            collection="snapshots"
            id={id}
            category={category}
          />
          <ExcludedValues exclusions={snapshot.exclusions} />
          <CustomerChanges
            campaignId={campaignId}
            collection="snapshots"
            id={id}
          />
          {session.permissions?.includes("sales") && (
            <>
              <SnapshotSources campaignId={campaignId} id={id} />
              <PurchaseChanges
                campaignId={campaignId}
                collection="snapshots"
                id={id}
                audit={!!session.permissions?.includes("audit")}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

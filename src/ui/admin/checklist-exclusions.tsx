"use client";
import { useCallback } from "react";
import Link from "next/link";
import type { AdminSession } from "@/client/admin-session";
import { checklistOperation } from "@/client/admin-checklist-api";
import type { Exclusion } from "@/client/admin-checklist-schemas";
import { adminTime } from "@/client/admin-display";
import { formatAggregateQuantity } from "@/shared/aggregate-display";
import { reportMoney } from "@/client/admin-reports-api";
import { Button, KeyValueList, Notice } from "@/ui";
import { Reason, SelectField, Sheet } from "./station-common";
import {
  ChecklistFrame,
  EvidenceContext,
  Id,
  ReadState,
  BackToPhones,
  basePath,
  campaignGuard,
  useChecklistApi,
  useChecklistDraft,
  useChecklistMutation,
  useChecklistRead,
} from "./checklist-common";
import { PhoneFacts } from "./checklist-phones";
import { EvidencePager, useEvidencePage } from "./checklist-paging";
type Source = Exclusion["partialSources"][number];
export function SourceFacts({ source }: { source: Source }) {
  return (
    <KeyValueList
      items={[
        { label: "Purchase ID", value: <Id>{source.purchaseId}</Id> },
        { label: "Purchase version", value: String(source.purchaseVersion) },
        {
          label: "Originating attendant ID",
          value: <Id>{source.originatingAttendantId}</Id>,
        },
        { label: "Current state", value: source.state },
        {
          label: "Details received",
          value: adminTime(source.detailsReceivedAt),
        },
        {
          label: "Amount",
          value: reportMoney([
            { amountKobo: source.amountKobo, currency: source.currency },
          ]),
        },
        {
          label: "Quantity",
          value: formatAggregateQuantity(source.quantity, source.unit),
        },
        { label: "Phone attribution", value: "attested by the manager" },
      ]}
    />
  );
}
const consequence =
  "If approved, only the unfinished-upload obligation for these exact incomplete sales is suppressed. Holds, corrections, duplicates, eligibility reviews and two-person release proposals still block. Accepted sales cannot be excluded.";
export function UnavailablePage({
  session,
  phoneId,
}: {
  session: AdminSession;
  phoneId: string;
}) {
  const api = useChecklistApi();
  const m = useChecklistMutation();
  const load = useCallback(async () => {
    const campaign = await api.campaign();
    if (!campaign) return null;
    const checklist = await api.checklist(campaign.id);
    const phones = await api.phones(campaign.id, checklist.view.viewToken);
    const phone = phones.items.find((p) => p.id === phoneId);
    if (!phone) throw Error();
    const sources = await api.sources(
      campaign.id,
      phoneId,
      checklist.view.viewToken,
    );
    const accounts = await api.attendants(
      campaign.id,
      checklist.view.viewToken,
    );
    return {
      campaign: checklist.readiness.campaign,
      view: checklist.view,
      phone,
      sources,
      accounts,
      managerAdminId: checklist.readiness.phoneCheck.managerAdminId,
    };
  }, [api, phoneId]);
  const r = useChecklistRead(`unavailable:${phoneId}:${m.serial}`, load);
  return (
    <ChecklistFrame title="Phone unavailable">
      <Notice tone="warning">
        This proposal does not cancel or delete sales. A different authorized
        person must approve it. Other reviews still block finalization.
      </Notice>
      <ReadState {...r} />
      {r.data && (
        <UnavailableForm key={phoneId} data={r.data} session={session} />
      )}
      <BackToPhones />
    </ChecklistFrame>
  );
}
type UnavailableData = {
  campaign: NonNullable<
    Awaited<ReturnType<ReturnType<typeof useChecklistApi>["campaign"]>>
  >;
  view: Awaited<
    ReturnType<ReturnType<typeof useChecklistApi>["checklist"]>
  >["view"];
  phone: Awaited<
    ReturnType<ReturnType<typeof useChecklistApi>["phones"]>
  >["items"][number];
  sources: Awaited<ReturnType<ReturnType<typeof useChecklistApi>["sources"]>>;
  accounts: Awaited<
    ReturnType<ReturnType<typeof useChecklistApi>["attendants"]>
  >;
  managerAdminId: string | null;
};
function UnavailableForm({
  data,
  session,
}: {
  data: UnavailableData;
  session: AdminSession;
}) {
  const api = useChecklistApi();
  const m = useChecklistMutation();
  const defaults = () => ({
    viewToken: data.view.viewToken,
    selected: [] as string[],
    reason: "",
  });
  const [draft, set] = useChecklistDraft(
    `checklist:unavailable:${data.phone.id}`,
    defaults,
  );
  const stale = draft.viewToken !== data.view.viewToken;
  const sourcePages = useEvidencePage(data.sources.items, data.view.viewToken);
  const allowed =
    session.account.adminId === data.managerAdminId &&
    !!session.permissions?.includes(
      data.view.kind === "initial" ? "giveawayFinalize" : "giveawayRevise",
    );
  const locked = stale || m.locked || !allowed;
  const selected = data.sources.items.filter((s) =>
    draft.selected.includes(s.purchaseId),
  );
  const after =
    !!data.campaign.timing.uploadDeadline &&
    Date.parse(data.view.asOf) >
      Date.parse(data.campaign.timing.uploadDeadline);
  return (
    <>
      {stale && (
        <Notice tone="warning">
          Evidence has changed since this review. Refresh and review again.{" "}
          <Button
            variant="secondary"
            disabled={m.locked}
            onClick={() => set(defaults())}
          >
            Discard stale selections and review current evidence
          </Button>
        </Notice>
      )}
      <div className="wr-two-col">
        <Sheet title="Unavailable phone evidence">
          <PhoneFacts phone={data.phone} />
          <h3>Account partitions</h3>
          {data.phone.attendantIds.map((id) => {
            const a = data.accounts.items.find((x) => x.attendantId === id);
            return (
              <p key={id}>
                {a?.name} / {a?.staffCode} · <Id>{id}</Id>
                {a && !a.enabled ? " · Disabled" : ""}
                {a && !a.hasCurrentAssignment ? " · Assignment ended" : ""}
              </p>
            );
          })}
          <h3>Sales still only on the phone</h3>
          <p>
            The number and value are unknown. Approval leaves these unsent
            originals out of the future campaign result; it creates no sale
            records.
          </p>
        </Sheet>
        <EvidenceContext campaign={data.campaign} view={data.view} />
      </div>
      <Sheet title="Exact incomplete sales received by the server">
        <p>
          Choose each exact sale deliberately. Phone attribution is the
          manager&apos;s attestation, checked by the second person; the server
          does not prove physical phone origin.
        </p>
        {!selected.length && (
          <p>No server-known incomplete sales are listed in this proposal.</p>
        )}
        {!data.sources.items.length && (
          <p>
            No candidate matched server records at this server as-of time. Sales
            still only on the phone remain unknown.
          </p>
        )}
        {sourcePages.items.map((s) => (
          <section className="wr-checklist-card" key={s.purchaseId}>
            <label className="wr-checklist-choice">
              <input
                type="checkbox"
                aria-label={s.purchaseId}
                disabled={
                  locked ||
                  (!draft.selected.includes(s.purchaseId) &&
                    draft.selected.length >= 100)
                }
                checked={draft.selected.includes(s.purchaseId)}
                onChange={(e) =>
                  set({
                    ...draft,
                    selected: e.target.checked
                      ? [...draft.selected, s.purchaseId]
                      : draft.selected.filter((id) => id !== s.purchaseId),
                  })
                }
              />
              <span>
                Select exact incomplete sale <Id>{s.purchaseId}</Id>
              </span>
            </label>
            <SourceFacts source={s} />
            <p>No accepted revision; no trusted complete-photo receipt.</p>
          </section>
        ))}
        <EvidencePager
          pages={sourcePages}
          label="Incomplete sales pages"
          disabled={m.locked}
        />
        <Reason
          label="Why is this phone unavailable?"
          value={draft.reason}
          onChange={(reason) => set({ ...draft, reason })}
          disabled={locked}
        />
        <p className="wr-help">
          Explain why the phone cannot be inspected. Do not include phone
          numbers, credentials or private customer information.
        </p>
        {!after && (
          <Notice>
            Phone checks can be recorded after the upload deadline:{" "}
            {data.campaign.timing.uploadDeadline ?? "Not configured"}.
          </Notice>
        )}
        <Button
          disabled={locked || !draft.reason.trim() || !after}
          onClick={() =>
            m.review(() => ({
              request: api.freeze(
                data.campaign.id,
                "proposal",
                {
                  operationId: checklistOperation(),
                  ...campaignGuard(data.view),
                  expectedPhoneVersion: data.phone.version,
                  reason: draft.reason,
                  partialSources: selected.map((s) => ({
                    purchaseId: s.purchaseId,
                    expectedPurchaseVersion: s.purchaseVersion,
                  })),
                },
                data.phone.id,
              ),
              title: "Review unavailable-phone proposal",
              confirm: "Submit for independent approval",
              success:
                "Phone unavailable proposal recorded. A different authorized person must approve or reject it.",
              review: (
                <>
                  <Notice tone="warning">{consequence}</Notice>
                  <PhoneFacts phone={data.phone} />
                  {data.phone.attendantIds.map((id) => {
                    const a = data.accounts.items.find(
                      (x) => x.attendantId === id,
                    );
                    return (
                      <p key={id}>
                        {a?.name} / {a?.staffCode} · <Id>{id}</Id>
                      </p>
                    );
                  })}
                  <h3>Sales still only on the phone</h3>
                  <p>
                    The number and value are unknown. Approval leaves these
                    unsent originals out of the future campaign result; it
                    creates no sale records.
                  </p>
                  <h3>Exact incomplete sales received by the server</h3>
                  {selected.length ? (
                    selected.map((s) => (
                      <section className="wr-checklist-card" key={s.purchaseId}>
                        <SourceFacts source={s} />
                      </section>
                    ))
                  ) : (
                    <p>
                      No server-known incomplete sales are listed in this
                      proposal.
                    </p>
                  )}
                  <p>Why is this phone unavailable? {draft.reason}</p>
                  <EvidenceContext campaign={data.campaign} view={data.view} />
                </>
              ),
            }))
          }
        >
          Review unavailable-phone proposal
        </Button>
      </Sheet>
    </>
  );
}
export function ExclusionFacts({ value: e }: { value: Exclusion }) {
  return (
    <>
      <PhoneFacts
        phone={{
          id: e.phoneId,
          label: e.phoneLabel,
          attendantIds: e.attendants.map((a) => a.id),
        }}
      />
      <h3>Immutable account snapshots</h3>
      {e.attendants.map((a) => (
        <p key={a.id}>
          {a.name} / {a.staffCode} / {a.username} · <Id>{a.id}</Id>
        </p>
      ))}
      <KeyValueList
        items={[
          { label: "Proposal ID", value: <Id>{e.id}</Id> },
          { label: "Proposal version", value: String(e.version) },
          { label: "Campaign action", value: e.kind },
          {
            label: "Previous snapshot",
            value: <Id>{e.previousSnapshotId ?? "None"}</Id>,
          },
          { label: "Census ID", value: <Id>{e.censusId}</Id> },
          { label: "Census version", value: String(e.censusVersion) },
          { label: "Phone version", value: String(e.phoneVersion) },
          { label: "Manager designation", value: <Id>{e.designationId}</Id> },
          {
            label: "Settings version",
            value: <Id>{e.settingsVersionId ?? "Not configured"}</Id>,
          },
          {
            label: "Policy version",
            value: e.policyVersion ?? "Not configured",
          },
          {
            label: "Proposed by",
            value: `${e.proposedBy.name} / ${e.proposedBy.code}`,
          },
          { label: "Proposed at", value: adminTime(e.proposedAt) },
          { label: "Proposal reason", value: e.reason },
          { label: "Outcome", value: e.state },
          {
            label: "Decided by",
            value: e.decidedBy
              ? `${e.decidedBy.name} / ${e.decidedBy.code}`
              : "Not decided",
          },
          {
            label: "Decided at",
            value: e.decidedAt ? adminTime(e.decidedAt) : "Not decided",
          },
          {
            label: "Decision reason",
            value: e.decisionReason ?? "Not decided",
          },
        ]}
      />
      <h3>Sales still only on the phone</h3>
      <p>
        The number and value are unknown. Approval leaves these unsent originals
        out of the future campaign result; it creates no sale records.
      </p>
      <h3>Exact incomplete sales received by the server</h3>
      {e.partialSources.length ? (
        e.partialSources.map((s) => (
          <section className="wr-checklist-card" key={s.purchaseId}>
            <SourceFacts source={s} />
          </section>
        ))
      ) : (
        <p>No server-known incomplete sales are listed in this proposal.</p>
      )}
    </>
  );
}
export function ExclusionPage({
  session,
  exclusionId,
}: {
  session: AdminSession;
  exclusionId: string;
}) {
  const api = useChecklistApi();
  const m = useChecklistMutation();
  const load = useCallback(async () => {
    const campaign = await api.campaign();
    return campaign ? api.exclusion(campaign.id, exclusionId) : null;
  }, [api, exclusionId]);
  const r = useChecklistRead(`exclusion:${exclusionId}:${m.serial}`, load);
  const e = r.data;
  const [draft, set] = useChecklistDraft(
    `checklist:decision:${exclusionId}`,
    () => ({ decision: "approve", reason: "" }),
  );
  const allowed =
    !!e &&
    !!session.permissions?.includes(
      e.kind === "initial" ? "giveawayFinalize" : "giveawayRevise",
    ) &&
    e.proposedBy.id !== session.account.adminId;
  return (
    <ChecklistFrame title="Review unavailable-phone proposal">
      <ReadState {...r} />
      {e && (
        <>
          <Sheet title="Recorded unavailable-phone proposal">
            <Notice tone="warning">{consequence}</Notice>
            <ExclusionFacts value={e} />
          </Sheet>
          {e.state === "pending" ? (
            <Sheet title="Independent decision">
              <p>
                Review the phone attribution and every listed incomplete sale. A
                different account belonging to the same person cannot approve or
                reject.
              </p>
              {!allowed && (
                <Notice>
                  A different verified person with the required permissions must
                  decide this proposal.
                </Notice>
              )}
              <SelectField
                label="Decision"
                value={draft.decision}
                disabled={m.locked || !allowed}
                onChange={(decision) => set({ ...draft, decision })}
              >
                <option value="approve">Approve phone unavailability</option>
                <option value="reject">Reject proposal</option>
              </SelectField>
              <Reason
                label="Decision reason"
                value={draft.reason}
                disabled={m.locked || !allowed}
                onChange={(reason) => set({ ...draft, reason })}
              />
              <Button
                disabled={m.locked || !allowed || !draft.reason.trim()}
                onClick={() =>
                  m.review(() => ({
                    request: api.freeze(
                      e.campaignId,
                      "decision",
                      {
                        operationId: checklistOperation(),
                        expectedVersion: e.version,
                        decision: draft.decision,
                        reason: draft.reason,
                      },
                      e.id,
                    ),
                    title: "Review decision",
                    confirm:
                      draft.decision === "approve"
                        ? "Confirm approval"
                        : "Confirm rejection",
                    success:
                      draft.decision === "approve"
                        ? "Phone unavailability approved. Record a current complete phone check before preparing the result."
                        : "Proposal rejected. This phone still needs inspection or a new proposal.",
                    review: (
                      <>
                        <ExclusionFacts value={e} />
                        <p>
                          Decision:{" "}
                          {draft.decision === "approve"
                            ? "Approve phone unavailability"
                            : "Reject proposal"}
                        </p>
                        <p>Decision reason: {draft.reason}</p>
                        <Notice tone="warning">{consequence}</Notice>
                      </>
                    ),
                  }))
                }
              >
                Review decision
              </Button>
            </Sheet>
          ) : (
            <Notice role="status">
              {e.state === "approved"
                ? "Phone unavailability approved. Record a current complete phone check before preparing the result."
                : "Proposal rejected. This phone still needs inspection or a new proposal."}{" "}
              This is retained decision history; current applicability is
              checked separately.
            </Notice>
          )}
        </>
      )}
      <BackToPhones />
      <Link className="wr-btn wr-btn-ghost" href={basePath}>
        Back to finalization checks
      </Link>
    </ChecklistFrame>
  );
}

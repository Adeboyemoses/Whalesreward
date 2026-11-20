"use client";
import { useCallback, useState } from "react";
import { EvidencePager, useEvidencePage } from "./checklist-paging";
import Link from "next/link";
import type { AdminSession } from "@/client/admin-session";
import { AdminError } from "@/client/admin-api";
import {
  inventoryAuthority,
  recoveryNeedsCensus,
  checklistPolicyCopy,
} from "@/client/admin-checklist-state";
import { checklistOperation, type View } from "@/client/admin-checklist-api";
import type { Phone, Exclusion } from "@/client/admin-checklist-schemas";
import type { z } from "zod";
import type { attendantChoiceSchema } from "@/shared/contracts/giveaway-projections";
import { Button, KeyValueList, Notice, TextField } from "@/ui";
import { Reason, SelectField, Sheet } from "./station-common";
import { adminTime } from "@/client/admin-display";
import { useAdminSession } from "./session";
import {
  ChecklistFrame,
  EvidenceContext,
  Id,
  ReadState,
  basePath,
  campaignGuard,
  useChecklistApi,
  useChecklistDraft,
  useChecklistMutation,
  useChecklistRead,
} from "./checklist-common";
export function PhoneFacts({
  phone,
}: {
  phone: Pick<Phone, "id" | "label" | "attendantIds">;
}) {
  return (
    <KeyValueList
      items={[
        { label: "Phone label", value: phone.label },
        { label: "Inventory ID", value: <Id>{phone.id}</Id> },
        {
          label: "Attendant accounts",
          value: (
            <ul>
              {phone.attendantIds.map((id) => (
                <li key={id}>
                  <Id>{id}</Id>
                </li>
              ))}
            </ul>
          ),
        },
      ]}
    />
  );
}
export function phoneState(
  p: Phone,
  overall: string,
  entry?: { result: string; exclusionId: string | null },
) {
  if (overall === "stale")
    return "Earlier evidence is stale. Review this phone again.";
  if (overall === "complete" && entry)
    return entry.result === "empty"
      ? "Checked · nothing remains unsent"
      : "Phone unavailable · exclusion approved";
  if (p.state === "unavailable_pending")
    return "Phone unavailable · awaiting independent decision";
  if (p.state === "unavailable_approved")
    return "Approval recorded; current phone check required";
  return "Pending inspection";
}
const currentApproval = (e: Exclusion, p: Phone, v: View) =>
  e.state === "approved" &&
  e.phoneId === p.id &&
  e.phoneVersion === p.version &&
  e.censusId === v.censusId &&
  e.censusVersion === v.censusVersion &&
  e.designationId === v.designationId &&
  e.settingsVersionId === v.guard.expectedSettingsVersionId &&
  e.previousSnapshotId === v.guard.expectedPreviousSnapshotId &&
  e.kind === v.kind &&
  e.policyVersion === v.reconciliationPolicyVersion;
export function PhonesPage({ session }: { session: AdminSession }) {
  const api = useChecklistApi();
  const { store } = useAdminSession();
  const m = useChecklistMutation();
  const allowed =
    !!session.permissions?.includes("leaderboards") &&
    !!session.permissions?.includes("sales");
  const load = useCallback(async () => {
    if (!allowed) return null;
    const campaign = await api.campaign();
    if (!campaign) return null;
    const projection = await api.checklist(campaign.id);
    const inventory = await api.inventory(campaign.id);
    if (
      inventory.census.id !== projection.view.censusId ||
      inventory.census.version !== projection.view.censusVersion ||
      inventory.census.dataVersion !== projection.view.guard.expectedDataVersion
    )
      throw new AdminError("read_view_stale", 409);
    let manager = inventoryAuthority(session, {
      kind: projection.view.kind,
      phoneCheck: projection.readiness.phoneCheck,
      checks: projection.checks,
    });
    let accounts: Awaited<ReturnType<typeof api.attendants>> | null = null;
    let phones: Awaited<ReturnType<typeof api.phones>> | null = null;
    let authorityMessage = "";
    if (manager) {
      try {
        accounts = await api.attendants(campaign.id, projection.view.viewToken);
        phones = await api.phones(campaign.id, projection.view.viewToken);
      } catch (e) {
        if (e instanceof AdminError && e.status === 403) {
          manager = false;
          accounts = null;
          phones = null;
          authorityMessage =
            "Current named-manager and verified-person authority is required for choices and writes. Read-only history remains available.";
          for (const key of store.lists.keys())
            if (
              key.startsWith("checklist:census:") ||
              key.startsWith("checklist:unavailable:")
            )
              store.lists.delete(key);
          api.clearReads();
        } else throw e;
      }
    }
    if (!manager) {
      for (const key of store.lists.keys())
        if (
          key.startsWith("checklist:census:") ||
          key.startsWith("checklist:unavailable:")
        )
          store.lists.delete(key);
    }
    const exclusions = await api.exclusions(campaign.id);
    const evidence = projection.view.phoneCheckId
      ? await api.checkEvidence(campaign.id, projection.view.phoneCheckId)
      : null;
    await api.checklist(campaign.id, projection.view.viewToken);
    return {
      campaign: projection.readiness.campaign,
      projection,
      inventory,
      accounts,
      phones,
      exclusions,
      evidence,
      manager,
      authorityMessage,
    };
  }, [api, allowed, session, store]);
  const r = useChecklistRead(`phones:${m.serial}`, load);
  return (
    <ChecklistFrame title="Phone census">
      <p>
        List every physical phone used for campaign sales and every attendant
        account used on it, including leavers, disabled accounts and replacement
        phones. Server records cannot discover sales that are still only on a
        phone.
      </p>
      <Notice>Unsent sales on phones: unknown until inspected.</Notice>
      {!allowed ? (
        <Notice tone="warning">
          Your current permissions do not allow this action.
        </Notice>
      ) : (
        <>
          <ReadState {...r} />
          {!r.busy && !r.error && !r.data && (
            <Notice>Campaign values are not configured.</Notice>
          )}
          {r.data && (
            <PhoneContent
              key={`${r.data.campaign.id}:${r.data.manager}`}
              data={r.data}
            />
          )}
          <Button variant="secondary" disabled={m.locked} onClick={r.reload}>
            Refresh complete evidence
          </Button>
        </>
      )}
    </ChecklistFrame>
  );
}
type Api = ReturnType<typeof useChecklistApi>;
type Data = {
  campaign: Awaited<ReturnType<Api["checklist"]>>["readiness"]["campaign"];
  projection: Awaited<ReturnType<Api["checklist"]>>;
  inventory: Awaited<ReturnType<Api["inventory"]>>;
  accounts: Awaited<ReturnType<Api["attendants"]>> | null;
  phones: Awaited<ReturnType<Api["phones"]>> | null;
  exclusions: Exclusion[];
  evidence: Awaited<ReturnType<Api["checkEvidence"]>> | null;
  manager: boolean;
  authorityMessage: string;
};
type DraftPhone = { id?: string; label: string; attendantIds: string[] };
function PhoneContent({ data }: { data: Data }) {
  const api = useChecklistApi();
  const m = useChecklistMutation();
  const v = data.projection.view;
  const defaults = () => ({
    viewToken: v.viewToken,
    phones: data.inventory.items.map((p) => ({
      id: p.id,
      label: p.label,
      attendantIds: [...p.attendantIds],
    })) as DraftPhone[],
    reason: "",
    attested: false,
    checks: {} as Record<string, string>,
    checkReason: "",
    recoveredPhoneIds: [] as string[],
  });
  const [draft, set] = useChecklistDraft(
    `checklist:census:${data.campaign.id}`,
    defaults,
  );
  const recordedPages = useEvidencePage(data.inventory.items, v.viewToken);
  const inspectionPages = useEvidencePage(data.inventory.items, v.viewToken);
  const proposalPages = useEvidencePage(data.exclusions, v.viewToken);
  const draftPages = useEvidencePage(draft.phones, v.viewToken);
  const stale = draft.viewToken !== v.viewToken;
  const accounts = data.accounts?.items ?? [];
  const covered = new Set(draft.phones.flatMap((p) => p.attendantIds));
  const missing = accounts.filter((a) => !covered.has(a.attendantId));
  const deadline = data.campaign.timing.uploadDeadline;
  const afterDeadline = !!deadline && Date.parse(v.asOf) > Date.parse(deadline);
  const locked = m.locked || stale;
  const recovered = draft.recoveredPhoneIds ?? [];
  const policyReady = !!v.reconciliationPolicyVersion;
  const pending = data.exclusions.some((e) => e.state === "pending");
  const validCensus =
    draft.phones.length > 0 &&
    draft.phones.length <= 100 &&
    draft.phones.every(
      (p) =>
        p.label.trim() &&
        p.attendantIds.length > 0 &&
        p.attendantIds.length <= 100,
    ) &&
    missing.length === 0;
  function reviewCensus() {
    m.review(() => ({
      view: v,
      request: api.freeze(data.campaign.id, "census", {
        operationId: checklistOperation(),
        ...campaignGuard(v),
        reason: draft.reason,
        phones: draft.phones,
      }),
      title: "Review phone census",
      confirm: "Confirm phone census",
      success:
        "Phone census recorded. Inspect every listed phone or obtain independent approval for its unavailability.",
      review: (
        <>
          <Notice tone="warning">
            This replaces the current census and requires a new phone check.
            Earlier evidence is retained.
          </Notice>
          <EvidenceContext campaign={data.campaign} view={v} />
          <h3>Current census</h3>
          {data.inventory.items.length ? (
            data.inventory.items.map((p) => (
              <section className="wr-checklist-card" key={p.id}>
                <PhoneFacts phone={p} />
                <p>
                  {draft.phones.some((q) => q.id === p.id)
                    ? JSON.stringify(
                        draft.phones.find((q) => q.id === p.id),
                      ) ===
                      JSON.stringify({
                        id: p.id,
                        label: p.label,
                        attendantIds: p.attendantIds,
                      })
                      ? "Retained"
                      : "Changed"
                    : "Removed from replacement census; earlier evidence retained"}
                </p>
              </section>
            ))
          ) : (
            <p>No census recorded.</p>
          )}
          {recovered.length > 0 && (
            <p>
              Recovered phones declared available:{" "}
              {recovered.map((id) => (
                <Id key={id}>{id} </Id>
              ))}
              . This replacement requires a fresh complete phone check.
            </p>
          )}
          <h3>Proposed census</h3>
          {draft.phones.map((p, i) => (
            <section className="wr-checklist-card" key={i}>
              <PhoneFacts phone={{ ...p, id: p.id ?? "Assigned when saved" }} />
              <p>{p.id ? "Saved phone retained or changed" : "Added phone"}</p>
              <AccountLabels ids={p.attendantIds} accounts={accounts} />
            </section>
          ))}
          <p>
            {draft.attested
              ? "I have included every relevant phone and account partition, including phones used by staff who have left."
              : ""}
          </p>
          <p>Census reason: {draft.reason}</p>
        </>
      ),
    }));
  }
  function reviewCheck() {
    m.review(() => ({
      view: v,
      request: api.freeze(data.campaign.id, "check", {
        operationId: checklistOperation(),
        ...campaignGuard(v),
        reason: draft.checkReason,
        entries: data.inventory.items.map((p) => ({
          phoneId: p.id,
          expectedPhoneVersion: p.version,
          result: draft.checks[p.id] === "empty" ? "empty" : "unavailable",
          exclusionId:
            draft.checks[p.id] === "empty" ? null : draft.checks[p.id],
        })),
      }),
      title: "Review complete phone check",
      confirm: "Record complete phone check",
      success:
        "Phone check recorded. Run the finalization checklist to review a snapshot.",
      review: (
        <>
          <p>
            Inspection selections are a draft until the complete phone check is
            recorded.
          </p>
          <EvidenceContext campaign={data.campaign} view={v} />
          {data.inventory.items.map((p) => (
            <section className="wr-checklist-card" key={p.id}>
              <PhoneFacts phone={p} />
              <p>
                {draft.checks[p.id] === "empty" ? (
                  "Inspected · nothing remains unsent"
                ) : (
                  <>
                    Unavailable · approved proposal{" "}
                    <Link href={basePath + "/exclusions/" + draft.checks[p.id]}>
                      <Id>{draft.checks[p.id]}</Id>
                    </Link>
                  </>
                )}
              </p>
            </section>
          ))}
          <p>Phone-check reason: {draft.checkReason}</p>
        </>
      ),
    }));
  }
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
            Discard stale draft and review current evidence
          </Button>
        </Notice>
      )}
      {!policyReady && <Notice tone="warning">{checklistPolicyCopy}</Notice>}
      {!data.manager && (
        <Notice>
          {data.authorityMessage ||
            "Current named-manager and verified-person authority is required for choices and writes. Read-only history remains available."}
        </Notice>
      )}
      <div className="wr-two-col wr-checklist-context-grid">
        <div className="wr-checklist-context">
          <EvidenceContext campaign={data.campaign} view={v} />
        </div>
        <Sheet title="Recorded phone census">
          {!data.inventory.items.length && (
            <p>
              Add every phone used for sales. An empty census cannot be
              recorded.
            </p>
          )}
          {recordedPages.items.map((p) => (
            <section className="wr-checklist-card" key={p.id}>
              <PhoneFacts phone={p} />
              <AccountLabels ids={p.attendantIds} accounts={accounts} />
              <p>
                <b>Inspection status:</b>{" "}
                {phoneState(
                  p,
                  data.projection.readiness.phoneCheck.state,
                  data.evidence?.entries.find((e) => e.phoneId === p.id),
                )}
              </p>
              {data.evidence?.entries
                .filter((e) => e.phoneId === p.id && e.exclusionId)
                .map((e) => (
                  <p key={e.exclusionId}>
                    <Link href={basePath + "/exclusions/" + e.exclusionId}>
                      Recorded approved exclusion <Id>{e.exclusionId}</Id>
                    </Link>
                  </p>
                ))}
              {p.state === "unchecked" && (
                <p>No current phone check covers this phone.</p>
              )}
              {data.exclusions
                .filter((e) => e.phoneId === p.id && e.state === "rejected")
                .map((e) => (
                  <p key={e.id}>
                    Phone unavailable proposal rejected. Inspect this phone or
                    submit a new proposal.
                  </p>
                ))}
              {recovered.includes(p.id) && (
                <Notice tone="warning">
                  This phone is available again. Record a new census and phone
                  check. Earlier exclusion decisions remain retained history; a
                  fresh census must be recorded before inspection can be
                  certified.
                </Notice>
              )}
              {data.manager &&
                (p.state === "unavailable_pending" ||
                  recoveryNeedsCensus(data.exclusions, p.id, v.censusId)) && (
                  <Button
                    variant="secondary"
                    disabled={locked}
                    onClick={() =>
                      set({
                        ...draft,
                        recoveredPhoneIds: [...new Set([...recovered, p.id])],
                        attested: false,
                        checks: {},
                        checkReason: "",
                      })
                    }
                  >
                    Phone available again
                  </Button>
                )}
              {data.manager && (
                <Link
                  className="wr-btn wr-btn-secondary"
                  href={basePath + `/phones/${p.id}/unavailable`}
                >
                  Propose phone unavailable
                </Link>
              )}
            </section>
          ))}
          <EvidencePager
            pages={recordedPages}
            label="Phone census pages"
            disabled={m.locked}
          />
          {data.evidence && (
            <KeyValueList
              items={[
                {
                  label: "Phone-check manager",
                  value: `${data.evidence.check.manager.name} / ${data.evidence.check.manager.code}`,
                },
                {
                  label: "Checked at",
                  value: adminTime(data.evidence.check.checkedAt),
                },
                {
                  label: "Phone check ID",
                  value: <Id>{data.evidence.check.id}</Id>,
                },
              ]}
            />
          )}
        </Sheet>
      </div>
      <Sheet title="Unavailable-phone proposals">
        {!data.exclusions.length && (
          <p>No unavailable-phone proposals are recorded.</p>
        )}
        {proposalPages.items.map((e) => (
          <p className="wr-checklist-card" key={e.id}>
            <Link href={basePath + "/exclusions/" + e.id}>
              {e.phoneLabel} · {e.state} · <Id>{e.id}</Id>
            </Link>
          </p>
        ))}
        <EvidencePager
          pages={proposalPages}
          label="Unavailable-phone proposals pages"
          disabled={m.locked}
        />
      </Sheet>
      {data.manager ? (
        <>
          <Sheet title="Complete phone census">
            <p>
              Use a station label such as ‘Pump 1 handset’. Do not enter a phone
              number, IMEI, serial number or secret.
            </p>
            {draftPages.items.map((p, localIndex) => {
              const i = draftPages.start + localIndex;
              return (
                <fieldset
                  className="wr-checklist-card"
                  key={p.id ?? `draft-${i}`}
                  disabled={locked}
                >
                  <legend>Phone {i + 1}</legend>
                  <TextField
                    label={`Phone label · ${i + 1}`}
                    value={p.label}
                    maxLength={80}
                    onChange={(e) =>
                      set({
                        ...draft,
                        phones: draft.phones.map((q, j) =>
                          j === i ? { ...q, label: e.target.value } : q,
                        ),
                      })
                    }
                  />
                  <p>
                    Inventory ID: <Id>{p.id ?? "Assigned when saved"}</Id>
                  </p>
                  <h3>Attendant accounts</h3>
                  <AccountChoices
                    accounts={accounts}
                    selected={p.attendantIds}
                    index={i}
                    viewToken={v.viewToken}
                    onChange={(attendantIds) =>
                      set({
                        ...draft,
                        phones: draft.phones.map((q, j) =>
                          i === j ? { ...q, attendantIds } : q,
                        ),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    onClick={() =>
                      set({
                        ...draft,
                        phones: draft.phones.filter((_, j) => i !== j),
                      })
                    }
                  >
                    Remove draft row
                  </Button>
                </fieldset>
              );
            })}
            <EvidencePager
              pages={draftPages}
              label="Draft phones pages"
              disabled={m.locked}
            />
            <Button
              variant="secondary"
              disabled={locked || draft.phones.length >= 100}
              onClick={() => {
                set({
                  ...draft,
                  phones: [...draft.phones, { label: "", attendantIds: [] }],
                });
                draftPages.last(draft.phones.length + 1);
              }}
            >
              Add phone
            </Button>
            <p>
              {missing.length
                ? "Census incomplete. Add a phone for every missing account."
                : `${accounts.length} required accounts covered`}
            </p>
            {missing.map((a) => (
              <p key={a.attendantId}>
                Missing account: <Id>{a.attendantId}</Id>
              </p>
            ))}
            <Reason
              label="Census reason"
              value={draft.reason}
              onChange={(reason) => set({ ...draft, reason })}
              disabled={locked}
            />
            <label className="wr-checklist-choice">
              <input
                type="checkbox"
                checked={draft.attested}
                disabled={locked}
                onChange={(e) => set({ ...draft, attested: e.target.checked })}
              />
              <span>
                I have included every relevant phone and account partition,
                including phones used by staff who have left.
              </span>
            </label>
            {!afterDeadline && (
              <Notice>
                Phone checks can be recorded after the upload deadline:{" "}
                {deadline ?? "Not configured"}.
              </Notice>
            )}
            <Button
              disabled={
                locked ||
                !policyReady ||
                !validCensus ||
                !draft.reason.trim() ||
                !draft.attested ||
                !afterDeadline
              }
              onClick={reviewCensus}
            >
              Review census
            </Button>
          </Sheet>
          <Sheet title="Inspect every listed phone">
            <p>
              Inspection selections are a draft until the complete phone check
              is recorded.
            </p>
            <p>
              Inspect every relevant account partition. If sales or photos
              remain unsent, resolve them through the authorized upload or
              recovery process, then inspect again.
            </p>
            {inspectionPages.items.map((p) => (
              <section className="wr-checklist-card" key={p.id}>
                <PhoneFacts phone={p} />
                <SelectField
                  label={`Inspection result · ${p.label} · ${p.id}`}
                  value={draft.checks[p.id] ?? ""}
                  disabled={locked || recovered.length > 0}
                  onChange={(value) =>
                    set({
                      ...draft,
                      checks: { ...draft.checks, [p.id]: value },
                    })
                  }
                >
                  <option value="">Pending inspection</option>
                  <option
                    value="empty"
                    disabled={recoveryNeedsCensus(
                      data.exclusions,
                      p.id,
                      v.censusId,
                    )}
                  >
                    Inspected · nothing remains unsent
                  </option>
                  {data.exclusions
                    .filter((e) => currentApproval(e, p, v))
                    .map((e) => (
                      <option value={e.id} key={e.id}>
                        Unavailable · approved proposal {e.id}
                      </option>
                    ))}
                </SelectField>
                {recoveryNeedsCensus(data.exclusions, p.id, v.censusId) && (
                  <Notice tone="warning">
                    This census contains retained phone-unavailability approval
                    or superseded evidence. Declare the phone available and
                    record a replacement census before selecting an empty
                    inspection.
                  </Notice>
                )}
                {draft.checks[p.id] && (
                  <p>Checked on this phone census · not recorded</p>
                )}
              </section>
            ))}
            <EvidencePager
              pages={inspectionPages}
              label="Inspection phones pages"
              disabled={m.locked}
            />
            {recovered.length > 0 && (
              <Notice tone="warning">
                Record a new census for the recovered phone before recording a
                complete phone check.
              </Notice>
            )}
            <Reason
              label="Phone-check reason"
              value={draft.checkReason}
              onChange={(checkReason) => set({ ...draft, checkReason })}
              disabled={locked}
            />
            {pending && (
              <Notice tone="warning">
                An unavailable-phone proposal is awaiting a decision.
              </Notice>
            )}
            <Button
              disabled={
                locked ||
                recovered.length > 0 ||
                pending ||
                !policyReady ||
                data.inventory.items.some(
                  (p) =>
                    draft.checks[p.id] === "empty" &&
                    recoveryNeedsCensus(data.exclusions, p.id, v.censusId),
                ) ||
                !afterDeadline ||
                !data.inventory.items.length ||
                !data.inventory.items.every((p) => draft.checks[p.id]) ||
                !draft.checkReason.trim()
              }
              onClick={reviewCheck}
            >
              Review complete phone check
            </Button>
          </Sheet>
        </>
      ) : (
        <Notice>
          Only the named live campaign manager with the required action
          permission can record the census or phone check.
        </Notice>
      )}
    </>
  );
}
function AccountLabels({
  ids,
  accounts,
}: {
  ids: string[];
  accounts: z.infer<typeof attendantChoiceSchema>[];
}) {
  return (
    <ul>
      {ids.map((id) => {
        const a = accounts.find((x) => x.attendantId === id);
        return (
          <li key={id}>
            {a ? `${a.name} / ${a.staffCode}` : <Id>{id}</Id>}
            {a && !a.enabled ? " · Disabled" : ""}
            {a && !a.hasCurrentAssignment ? " · Assignment ended" : ""}
          </li>
        );
      })}
    </ul>
  );
}

function AccountChoices({
  accounts,
  selected,
  index,
  viewToken,
  onChange,
}: {
  accounts: z.infer<typeof attendantChoiceSchema>[];
  selected: string[];
  index: number;
  viewToken: string;
  onChange: (ids: string[]) => void;
}) {
  const pages = useEvidencePage(accounts, viewToken);
  const [candidate, setCandidate] = useState("");
  return (
    <>
      <AccountLabels ids={selected} accounts={accounts} />
      <SelectField
        label={`Attendant account to add · phone ${index + 1}`}
        value={candidate}
        required={false}
        onChange={setCandidate}
      >
        <option value="">Choose an authorized attendant account</option>
        {pages.items.map((a) => (
          <option
            value={a.attendantId}
            key={a.attendantId}
            disabled={selected.includes(a.attendantId)}
          >
            {a.staffCode} / {a.name}
            {!a.enabled ? " · Disabled" : ""}
            {!a.hasCurrentAssignment ? " · Assignment ended" : ""}
          </option>
        ))}
      </SelectField>
      <Button
        variant="secondary"
        disabled={
          !candidate || selected.includes(candidate) || selected.length >= 100
        }
        onClick={() => {
          if (accounts.some((a) => a.attendantId === candidate)) {
            onChange([...selected, candidate]);
            setCandidate("");
          }
        }}
      >
        Add attendant account
      </Button>
      {pages.items.map((a) => (
        <label className="wr-checklist-choice" key={a.attendantId}>
          <input
            type="checkbox"
            aria-label={`${a.staffCode} · ${a.name} · ${a.attendantId} · phone ${index + 1}`}
            checked={selected.includes(a.attendantId)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, a.attendantId]
                  : selected.filter((id) => id !== a.attendantId),
              )
            }
          />
          <span>
            {a.name} · <Id>{a.staffCode}</Id>
            <br />
            <Id>{a.attendantId}</Id>
            {!a.enabled && <span className="wr-sub"> · Disabled</span>}
            {!a.hasCurrentAssignment && (
              <span className="wr-sub"> · Assignment ended</span>
            )}
          </span>
        </label>
      ))}
      <EvidencePager
        pages={pages}
        label={`Attendant accounts · phone ${index + 1} pages`}
      />
    </>
  );
}

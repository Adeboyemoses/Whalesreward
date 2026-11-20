"use client";
import { useCallback } from "react";
import Link from "next/link";
import type { z } from "zod";
import type { checklistProjectionSchema } from "@/shared/contracts/giveaway-projections";
import { adminTime } from "@/client/admin-display";
import { KeyValueList, Notice, StatusPill } from "@/ui";
import { Sheet } from "./station-common";
import {
  ReadState,
  useChecklistApi,
  useChecklistRead,
  Id,
} from "./checklist-common";
export const checkLabels = {
  timing: "Campaign timing",
  holds: "Held sales",
  corrections: "Corrections",
  duplicates: "Possible duplicates",
  two_person_proposals: "Two-person release proposals",
  uploads: "Incomplete uploads",
  complete_photo_deadline: "Complete-photo deadline",
  eligibility: "Campaign eligibility",
  phone_census: "Phone census and checks",
};
const reasons: Record<string, string> = {
  policy_missing:
    "Finalization checklist policy is not configured. An Owner must arrange configuration; no check can be certified.",
  campaign_unconfigured: "Campaign values are not configured.",
  timing_policy_unconfigured: "Campaign timing policy is not configured.",
  before_cutoff: "Purchase cutoff has not passed.",
  grace_open: "Upload grace period is still open.",
  holds_open: "Held sales or related release proposals need review.",
  corrections_pending: "Sales have unresolved corrections.",
  duplicates_open: "Sales have unresolved duplicate flags.",
  release_proposals_pending:
    "Unresolved release proposals block this result, including stale proposals and proposals under inactive policy.",
  uploads_incomplete:
    "Server-known sales need upload or photo-evidence resolution.",
  validation_pending: "Server-known sales are awaiting validation.",
  photo_proof_missing: "Trusted complete-photo receipt evidence is missing.",
  photo_proof_unbound:
    "Trusted complete-photo receipt evidence is not bound to the selected asset.",
  photo_deadline_uncertain:
    "Complete-photo receipt before the upload deadline remains uncertain.",
  no_applicable_sources: "No applicable sources.",
  eligibility_unresolved: "Campaign eligibility remains unresolved.",
  timing_unresolved: "Sale timing remains unresolved.",
  capture_release_pending: "A capture-release proposal awaits a decision.",
  manager_missing:
    "No campaign station manager is designated. An Owner must designate an authorized admin before phone checks can be recorded.",
  manager_ineligible:
    "The designated manager no longer has the required live authority.",
  census_missing: "Record the complete phone census and check.",
  census_incomplete:
    "The census or phone check is incomplete. Cover every required account and every listed phone.",
  phone_check_missing: "A current complete phone check is required.",
  phone_check_stale:
    "Phone evidence is stale. Recheck every phone against the current census.",
  phone_unchecked: "No current phone check covers this phone.",
  phone_exclusion_pending:
    "An unavailable-phone proposal is awaiting a decision.",
  exclusion_unusable: "Earlier evidence is stale. Review this phone again.",
};
export function LiveChecks({
  projection,
}: {
  projection: z.infer<typeof checklistProjectionSchema>;
}) {
  return (
    <section aria-label="Finalization checklist">
      <h3>Finalization checklist</h3>
      <p>
        These checks use server records and the manager&apos;s recorded phone
        evidence. A reason alone cannot pass a check.
      </p>
      <p className="wr-help">
        Counts overlap. Do not add them. Phone-only queue totals remain unknown
        until inspected.
      </p>
      <div className="wr-checklist-outcomes">
        {projection.checks.map((c) => (
          <section className="wr-checklist-row" key={c.name}>
            <h4>{checkLabels[c.name]}</h4>
            <StatusPill
              tone={
                c.outcome === "resolved"
                  ? "synced"
                  : c.outcome === "unresolved"
                    ? "held"
                    : "neutral"
              }
            >
              {c.outcome === "resolved"
                ? `Resolved as of ${adminTime(projection.view.asOf)}`
                : c.outcome === "not_applicable"
                  ? "Not applicable"
                  : "Blocked"}
            </StatusPill>
            <KeyValueList
              items={[
                {
                  label: `Checked ${c.unit}`,
                  value: c.checked ?? "Not evaluable",
                },
                {
                  label: `Blocking ${c.unit}`,
                  value: c.blocking ?? "Not evaluable",
                },
              ]}
            />
            {c.reasonCodes.map((r) => (
              <p key={r}>{reasons[r]}</p>
            ))}
            {c.access === "restricted" && (
              <p className="wr-help">
                Contact an authorized reviewer to resolve this check.
              </p>
            )}
            {c.links.map((l) => (
              <p key={l.href + l.label}>
                <Link href={l.href}>{l.label}</Link>
              </p>
            ))}
          </section>
        ))}
      </div>
    </section>
  );
}
export function StoredChecks({
  campaignId,
  id,
}: {
  campaignId: string;
  id: string;
}) {
  const api = useChecklistApi();
  const load = useCallback(
    () => api.stored(campaignId, id),
    [api, campaignId, id],
  );
  const r = useChecklistRead(`stored:${campaignId}:${id}`, load);
  return (
    <Sheet title="Historical preparation checklist">
      <ReadState {...r} />
      {r.data && (
        <>
          <Notice>
            Passed during preparation. These historical outcomes do not
            establish current readiness.
          </Notice>
          <KeyValueList
            items={[
              { label: "Reconciliation ID", value: <Id>{r.data.id}</Id> },
              { label: "Prepared at", value: adminTime(r.data.checkedAt) },
              {
                label: "Prepared by",
                value: `${r.data.actor.name} / ${r.data.actor.code}`,
              },
              { label: "Reason", value: r.data.reason },
              {
                label: "Outcome",
                value:
                  r.data.outcome === "unchanged"
                    ? "Saved result unchanged"
                    : "Preview prepared",
              },
              { label: "Count basis", value: r.data.countBasis },
              { label: "Source data version", value: r.data.sourceDataVersion },
              {
                label: "Phone check ID",
                value: <Id>{r.data.phoneCheckId}</Id>,
              },
            ]}
          />
          {r.data.checks.map((c) => (
            <section className="wr-checklist-row" key={c.name}>
              <h4>{checkLabels[c.name]}</h4>
              <p>Passed during preparation</p>
              <KeyValueList
                items={[
                  { label: "Stored checked count", value: c.checked },
                  { label: "Stored blocking count", value: c.blocking },
                ]}
              />
            </section>
          ))}
        </>
      )}
    </Sheet>
  );
}

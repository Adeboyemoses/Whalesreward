"use client";
import { useCallback } from "react";
import { EvidencePager, useEvidencePage } from "./checklist-paging";
import type { AdminSession } from "@/client/admin-session";
import { checklistOperation } from "@/client/admin-checklist-api";
import { Button, KeyValueList, Notice } from "@/ui";
import { Reason, SelectField, Sheet } from "./station-common";
import {
  ChecklistFrame,
  EvidenceContext,
  Id,
  ReadState,
  useChecklistApi,
  useChecklistDraft,
  useChecklistMutation,
  useChecklistRead,
} from "./checklist-common";
export function ManagerPage({ session }: { session: AdminSession }) {
  const api = useChecklistApi();
  const m = useChecklistMutation();
  const [draft, set] = useChecklistDraft("checklist:manager", () => ({
    manager: "",
    reason: "",
  }));
  const allowed =
    !!session.role?.isOwner &&
    !!session.permissions?.includes("settings") &&
    !!session.permissions?.includes("sales");
  const load = useCallback(async () => {
    if (!allowed) return null;
    const campaign = await api.campaign(true);
    if (!campaign) return null;
    const choices = await api.managers(campaign.id);
    return { campaign, choices };
  }, [api, allowed]);
  const r = useChecklistRead(`manager:${m.serial}`, load);
  const data = r.data;
  const managerPages = useEvidencePage(
    data?.choices.items ?? [],
    data?.choices.view.viewToken ?? "loading",
  );
  const selectedChoice = data?.choices.items.find(
    (c) => c.adminId === draft.manager,
  );
  return (
    <ChecklistFrame title="Campaign station manager">
      {!allowed ? (
        <Notice tone="warning">
          Only an Owner with settings and sales permissions can designate the
          campaign station manager.
        </Notice>
      ) : (
        <>
          <ReadState {...r} />
          {!r.busy && !r.error && !data && (
            <Notice>Campaign values are not configured.</Notice>
          )}
          {data && (
            <div className="wr-two-col wr-checklist-context-grid">
              <div className="wr-checklist-context">
                <EvidenceContext
                  campaign={data.campaign}
                  view={data.choices.view}
                />
              </div>
              <Sheet title="Campaign station manager">
                {data.choices.currentDesignation ? (
                  <p>
                    Designated manager:{" "}
                    {data.choices.currentDesignation.manager.name} /{" "}
                    {data.choices.currentDesignation.manager.adminCode}
                  </p>
                ) : (
                  <Notice tone="warning">
                    No campaign station manager is designated. An Owner must
                    designate an authorized admin before phone checks can be
                    recorded.
                  </Notice>
                )}
                <p>
                  Choose the person responsible for the complete phone census.
                  Designation does not grant permissions.
                </p>
                {!data.choices.items.length ? (
                  <Notice>
                    No eligible manager is available. An Owner must arrange the
                    required permissions and verified person identity.
                  </Notice>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      m.review(() => {
                        const target = data.choices.items.find(
                          (x) => x.adminId === draft.manager,
                        );
                        if (!target) throw Error();
                        return {
                          request: api.freeze(data.campaign.id, "manager", {
                            operationId: checklistOperation(),
                            expectedVersion:
                              data.choices.view.guard.expectedVersion,
                            managerAdminId: target.adminId,
                            reason: draft.reason,
                          }),
                          title: "Review manager designation",
                          confirm: "Confirm designation",
                          success:
                            "Campaign station manager designated. Review the phone census before recording a new phone check.",
                          review: (
                            <>
                              <Notice tone="warning">
                                Changing the manager makes existing phone checks
                                and pending unavailable-phone proposals
                                unusable.
                              </Notice>
                              <EvidenceContext
                                campaign={data.campaign}
                                view={data.choices.view}
                              />
                              <KeyValueList
                                items={[
                                  {
                                    label: "Current manager",
                                    value: data.choices.currentDesignation ? (
                                      <>
                                        {
                                          data.choices.currentDesignation
                                            .manager.name
                                        }{" "}
                                        /{" "}
                                        <Id>
                                          {
                                            data.choices.currentDesignation
                                              .manager.adminCode
                                          }
                                        </Id>{" "}
                                        /{" "}
                                        <Id>
                                          {
                                            data.choices.currentDesignation
                                              .manager.adminId
                                          }
                                        </Id>
                                      </>
                                    ) : (
                                      "Not designated"
                                    ),
                                  },
                                  {
                                    label: "Proposed manager",
                                    value: (
                                      <>
                                        {target.name} /{" "}
                                        <Id>{target.adminCode}</Id> /{" "}
                                        <Id>{target.adminId}</Id>
                                      </>
                                    ),
                                  },
                                  {
                                    label: "Reason for designation",
                                    value: draft.reason,
                                  },
                                ]}
                              />
                            </>
                          ),
                        };
                      });
                    }}
                  >
                    <SelectField
                      label="Campaign station manager"
                      value={draft.manager}
                      disabled={m.locked}
                      onChange={(manager) => set({ ...draft, manager })}
                    >
                      <option value="">Select an eligible manager</option>
                      {selectedChoice &&
                        !managerPages.items.some(
                          (c) => c.adminId === selectedChoice.adminId,
                        ) && (
                          <option value={selectedChoice.adminId}>
                            Selected: {selectedChoice.name} /{" "}
                            {selectedChoice.adminCode}
                          </option>
                        )}
                      {managerPages.items.map((c) => (
                        <option value={c.adminId} key={c.adminId}>
                          {c.name} / {c.adminCode}
                        </option>
                      ))}
                    </SelectField>
                    <EvidencePager
                      pages={managerPages}
                      label="Manager choices pages"
                      disabled={m.locked}
                    />
                    <Reason
                      label="Reason for designation"
                      value={draft.reason}
                      onChange={(reason) => set({ ...draft, reason })}
                      disabled={m.locked}
                    />
                    <Button
                      type="submit"
                      disabled={
                        m.locked || !draft.manager || !draft.reason.trim()
                      }
                    >
                      Review designation
                    </Button>
                  </form>
                )}
              </Sheet>
            </div>
          )}
          <Button
            variant="secondary"
            disabled={m.locked}
            onClick={() => {
              set({ manager: "", reason: "" });
              r.reload();
            }}
          >
            Refresh complete evidence
          </Button>
        </>
      )}
    </ChecklistFrame>
  );
}

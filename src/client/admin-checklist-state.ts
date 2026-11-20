export const checklistPolicyCopy =
  "Finalization checklist policy is not configured. An Owner must arrange configuration; no check can be certified.";
export function campaignMatchesView(
  c: {
    version: number;
    settingsVersionId: string | null;
    dataVersion: string;
    latestSnapshotId: string | null;
  },
  g: {
    expectedVersion: number;
    expectedSettingsVersionId: string | null;
    expectedDataVersion: string;
    expectedPreviousSnapshotId: string | null;
  },
) {
  return (
    c.version === g.expectedVersion &&
    c.settingsVersionId === g.expectedSettingsVersionId &&
    c.dataVersion === g.expectedDataVersion &&
    c.latestSnapshotId === g.expectedPreviousSnapshotId
  );
}
export function inventoryAuthority(
  s: { account: { adminId?: string }; permissions?: readonly string[] },
  p: {
    kind: "initial" | "revision";
    phoneCheck: { managerAdminId: string | null };
    checks: readonly { name: string; reasonCodes: readonly string[] }[];
  },
) {
  return (
    s.account.adminId === p.phoneCheck.managerAdminId &&
    [
      "sales",
      "leaderboards",
      p.kind === "initial" ? "giveawayFinalize" : "giveawayRevise",
    ].every((g) => s.permissions?.includes(g)) &&
    !p.checks.some(
      (c) =>
        c.name === "phone_census" &&
        c.reasonCodes.includes("manager_ineligible"),
    )
  );
}
/** Superseded detail may omit the prior decision; it cannot establish recovery.
 * A replacement census is required before selecting an empty inspection. */
export function recoveryNeedsCensus(
  rows: readonly {
    phoneId: string;
    censusId: string;
    state: string;
    decidedBy?: unknown;
  }[],
  phoneId: string,
  censusId: string | null,
) {
  return rows.some(
    (e) =>
      e.phoneId === phoneId &&
      e.censusId === censusId &&
      (e.state === "approved" || e.state === "superseded"),
  );
}

/** Own receipt identity is historical; only the fresh server pointer is latest. */
export function reconciliationHistorySelection(
  receiptId: string | null | undefined,
  serverLatestId: string | null | undefined,
) {
  return {
    latest: serverLatestId ?? null,
    own: receiptId && receiptId !== serverLatestId ? receiptId : null,
  };
}

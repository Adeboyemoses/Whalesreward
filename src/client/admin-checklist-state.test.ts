import { expect, it } from "vitest";
import {
  campaignMatchesView,
  inventoryAuthority,
  recoveryNeedsCensus,
} from "./admin-checklist-state";
const id = "019ab100-0000-7000-8000-000000000001";
const guard = {
  expectedVersion: 2,
  expectedSettingsVersionId: id,
  expectedDataVersion: "3",
  expectedPreviousSnapshotId: null,
};
it("rejects Settings context from before a newer selection guard", () => {
  const campaign = {
    version: 2,
    settingsVersionId: id,
    dataVersion: "3",
    latestSnapshotId: null,
  };
  expect(campaignMatchesView(campaign, guard)).toBe(true);
  expect(campaignMatchesView({ ...campaign, version: 1 }, guard)).toBe(false);
  expect(
    campaignMatchesView({ ...campaign, settingsVersionId: null }, guard),
  ).toBe(false);
});
it("treats a lost verified binding as lost manager choices while read authority stays separate", () => {
  const session = {
    account: { adminId: id },
    permissions: ["sales", "leaderboards", "giveawayFinalize"],
  };
  expect(
    inventoryAuthority(session, {
      kind: "initial",
      phoneCheck: { managerAdminId: id },
      checks: [],
    }),
  ).toBe(true);
  expect(
    inventoryAuthority(session, {
      kind: "initial",
      phoneCheck: { managerAdminId: id },
      checks: [{ name: "phone_census", reasonCodes: ["manager_ineligible"] }],
    }),
  ).toBe(false);
});
it("requires a new census for retained approved or superseded approval on that census, independent of other applicability pins", () => {
  expect(
    recoveryNeedsCensus(
      [{ phoneId: id, censusId: id, state: "approved", decidedBy: { id } }],
      id,
      id,
    ),
  ).toBe(true);
  expect(
    recoveryNeedsCensus(
      [{ phoneId: id, censusId: id, state: "superseded", decidedBy: { id } }],
      id,
      id,
    ),
  ).toBe(true);
  expect(
    recoveryNeedsCensus(
      [{ phoneId: id, censusId: id, state: "rejected", decidedBy: { id } }],
      id,
      id,
    ),
  ).toBe(false);
  expect(
    recoveryNeedsCensus(
      [{ phoneId: id, censusId: id, state: "approved", decidedBy: { id } }],
      id,
      "different-census",
    ),
  ).toBe(false);
});

it("uses the refreshed server latest pointer while keeping an older own receipt separately labelled", async () => {
  const { reconciliationHistorySelection } =
    await import("./admin-checklist-state");
  expect(reconciliationHistorySelection("receipt-A", "receipt-A")).toEqual({
    latest: "receipt-A",
    own: null,
  });
  expect(reconciliationHistorySelection("receipt-A", "receipt-B")).toEqual({
    latest: "receipt-B",
    own: "receipt-A",
  });
  expect(reconciliationHistorySelection("receipt-A", undefined)).toEqual({
    latest: null,
    own: "receipt-A",
  });
});

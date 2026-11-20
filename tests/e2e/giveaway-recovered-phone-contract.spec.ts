import { test, expect } from "../leaderboards/test";
import { v7 } from "uuid";
import { checklistFixture, api } from "../checklist/helpers";
import { phoneSelectionSchema } from "../../src/shared/contracts/giveaway-projections";

test("I-46 M4 P30 recovered phone requires a fresh census before an empty check can replace approved unavailability", async ({
  request,
  leaderboardStack,
}) => {
  const f = await checklistFixture(request, leaderboardStack.origin);
  try {
    await f.configure();
    await f.designate();
    const census = await f.census();
    const phoneId = census.phones.items[0]!.id;
    const proposal = await f.propose(phoneId, []);
    const reviewer = await f.otherActor();
    const approved = await api<{ exclusion: { id: string; state: string } }>(
      reviewer,
      `giveaway/${f.campaignId}/reconciliation/exclusions/${proposal.result.exclusion.id}/decision`,
      {
        operationId: v7(),
        expectedVersion: proposal.result.exclusion.version,
        decision: "approve",
        reason: "Fictional independent phone-only absence review",
      },
    );
    expect(approved.exclusion.state).toBe("approved");
    const phones = phoneSelectionSchema.parse(
      await api(
        f.actor,
        `giveaway/${f.campaignId}/reconciliation/selection/phones`,
      ),
    );
    expect(phones.view.censusVersion).toBe(census.phones.view.censusVersion);
    const phone = phones.items.find((p) => p.id === phoneId)!;
    const before = (
      await f.pool.query(
        "SELECT phone_census_id,phone_check_id,(SELECT count(*)::int FROM giveaway_phone_check WHERE campaign_id=$1) check_count FROM campaign WHERE id=$1",
        [f.campaignId],
      )
    ).rows[0];
    const body = {
      operationId: v7(),
      kind: phones.view.kind,
      ...phones.view.guard,
      expectedCensusVersion: phones.view.censusVersion,
      reason:
        "Fictional recovered phone inspected empty without replacing old census",
      entries: [
        {
          phoneId,
          expectedPhoneVersion: phone.version,
          result: "empty",
          exclusionId: null,
        },
      ],
    };
    const response = await request.post(
      `/api/admin/giveaway/${f.campaignId}/reconciliation/phone-checks`,
      {
        headers: { Origin: leaderboardStack.origin },
        data: body,
      },
    );
    const receipt = await response.json();
    const after = (
      await f.pool.query(
        "SELECT phone_census_id,phone_check_id,(SELECT count(*)::int FROM giveaway_phone_check WHERE campaign_id=$1) check_count FROM campaign WHERE id=$1",
        [f.campaignId],
      )
    ).rows[0];
    const stored = (
      await f.pool.query(
        "SELECT id,census_id,entries FROM giveaway_phone_check WHERE campaign_id=$1",
        [f.campaignId],
      )
    ).rows;
    console.log(
      "RECOVERED_PHONE_CONTRACT",
      JSON.stringify({
        status: response.status(),
        error: receipt.error?.code ?? null,
        campaignId: f.campaignId,
        censusVersion: phones.view.censusVersion,
        phoneVersion: phone.version,
        phoneId,
        exclusionId: approved.exclusion.id,
        before,
        after,
        stored,
      }),
    );
    // M4 P30: “A recovered phone requires a fresh census/check”.
    expect(
      response.status(),
      "Old-census recovery must be refused before writing a complete phone check",
    ).toBe(409);
    expect(after).toEqual(before);
    expect(stored).toHaveLength(before.check_count);
  } finally {
    await f.close();
  }
});

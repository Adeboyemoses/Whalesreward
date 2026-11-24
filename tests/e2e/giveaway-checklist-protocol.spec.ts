import { test, expect } from "../leaderboards/test";
import { v7 } from "uuid";
import { checklistFixture, api, guard } from "../checklist/helpers";
import { seedId } from "../station/helpers";
import {
  checkNames,
  storedChecklistSchema,
  incompleteSelectionSchema,
} from "../../src/shared/contracts/giveaway-projections";

test("I-11/I-46 real HTTP checklist selects exact incomplete sales, retains disabled accounts, refuses same-person decisions and requires a current complete check", async ({
  request,
  leaderboardStack,
}) => {
  test.setTimeout(90000);
  const f = await checklistFixture(request, leaderboardStack.origin);
  try {
    const partial = await f.sale({ state: "received", amount: "1370001" });
    await f.pool.query(
      "UPDATE assignment SET effective_until=clock_timestamp() WHERE attendant_id=$1",
      [seedId(7)],
    );
    await f.pool.query(
      "UPDATE auth_user SET enabled=false,auth_version=auth_version+1 WHERE id=$1",
      [seedId(4)],
    );
    await f.configure();
    const before = await f.checklist();
    expect(before.checks.map((c) => c.name)).toEqual(checkNames);
    expect(before.checks.find((c) => c.name === "phone_census")).toMatchObject({
      outcome: "unresolved",
      blocking: null,
    });
    await f.designate();
    const census = await f.census();
    expect(census.attendants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attendantId: seedId(7),
          enabled: false,
          hasCurrentAssignment: false,
        }),
      ]),
    );
    const phoneId = census.phones.items[0]!.id;
    const proposed = await f.propose(phoneId, [partial.id]);
    expect(proposed.result.exclusion.state).toBe("pending");
    expect(proposed.result.exclusion.partialSources).toHaveLength(1);
    const e = proposed.result.exclusion;
    const same = await f.otherActor(undefined, true);
    const refused = await same.request.post(
      `/api/admin/giveaway/${f.campaignId}/reconciliation/exclusions/${e.id}/decision`,
      {
        headers: { Origin: leaderboardStack.origin },
        data: {
          operationId: v7(),
          expectedVersion: e.version,
          decision: "approve",
          reason: "Fictional alias cannot approve own proposal",
        },
      },
    );
    expect(refused.status(), await refused.text()).toBe(403);
    expect((await refused.json()).error.code).toBe(
      "independent_admin_required",
    );
    const independent = await f.otherActor();
    const rejected = await api<{
      exclusion: { state: string; version: number };
    }>(
      independent,
      `giveaway/${f.campaignId}/reconciliation/exclusions/${e.id}/decision`,
      {
        operationId: v7(),
        expectedVersion: e.version,
        expectedCampaignVersion: (await f.campaign()).version,
        decision: "reject",
        reason: "Fictional independent phone attribution not yet confirmed",
      },
    );
    expect(rejected.exclusion.state).toBe("rejected");
    const retained = await api<{
      state: string;
      reason: string;
      decisionReason: string;
    }>(f.actor, `giveaway/${f.campaignId}/reconciliation/exclusions/${e.id}`);
    expect(retained).toMatchObject({
      state: "rejected",
      reason: proposed.body.reason,
      decisionReason:
        "Fictional independent phone attribution not yet confirmed",
    });
    const second = await f.propose(phoneId, [partial.id]);
    const secondId = second.result.exclusion.id;
    const decision = {
      operationId: v7(),
      expectedVersion: second.result.exclusion.version,
      decision: "approve",
      reason: "Fictional independent exact-sale and phone review complete",
    };
    const approved = await api<{ exclusion: { state: string; id: string } }>(
      independent,
      `giveaway/${f.campaignId}/reconciliation/exclusions/${secondId}/decision`,
      decision,
    );
    expect(approved.exclusion.state).toBe("approved");
    expect(
      await api(
        independent,
        `giveaway/${f.campaignId}/reconciliation/exclusions/${secondId}/decision`,
        decision,
      ),
    ).toEqual(approved);
    expect((await f.checklist()).readiness.phoneCheck.state).not.toBe(
      "complete",
    );
    await f.certify(phoneId, secondId);
    const checked = await f.checklist();
    expect(checked.readiness.phoneCheck.state).toBe("complete");
    expect(checked.checks.find((c) => c.name === "phone_census")).toMatchObject(
      { outcome: "resolved", blocking: "0" },
    );
    expect(
      (
        await f.pool.query(
          "SELECT status,current_revision_id FROM purchase WHERE id=$1",
          [partial.id],
        )
      ).rows[0],
    ).toMatchObject({ status: "received", current_revision_id: null });
    const candidates = incompleteSelectionSchema.parse(
      await api(
        f.actor,
        `giveaway/${f.campaignId}/reconciliation/selection/phones/${phoneId}/incomplete-sources`,
      ),
    );
    expect(
      candidates.items.find((s) => s.purchaseId === partial.id),
    ).toMatchObject({
      everAccepted: false,
      hasTrustedByteObservation: false,
      hasCompletePhotoFact: false,
      phoneAttribution: "manager_attestation_required",
    });
  } finally {
    await f.close();
  }
});

test("I-46 real HTTP nine live outcomes stay distinct from immutable stored preparation checks after new intake", async ({
  request,
  leaderboardStack,
}) => {
  test.setTimeout(90000);
  const f = await checklistFixture(request, leaderboardStack.origin);
  try {
    await f.configure();
    await f.designate();
    const census = await f.census();
    await f.certify(census.phones.items[0]!.id);
    const live = await f.checklist();
    expect(live.readiness.canPrepare).toBe(true);
    expect(live.checks.find((c) => c.name === "uploads")).toMatchObject({
      outcome: "not_applicable",
      checked: "0",
      blocking: "0",
    });
    const preview = await api<{ reconciliationId: string; id: string }>(
      f.actor,
      `giveaway/${f.campaignId}/previews`,
      {
        operationId: v7(),
        kind: "initial",
        reason: "Fictional HTTP preparation for stored checks",
        ...guard(await f.campaign()),
      },
      201,
    );
    const stored = storedChecklistSchema.parse(
      await api(
        f.actor,
        `giveaway/${f.campaignId}/reconciliation/results/${preview.reconciliationId}`,
      ),
    );
    expect(stored.historical).toBe(true);
    expect(stored.countBasis).toBe("reconciliation_v1_stored");
    expect(stored.checks.map((c) => c.name)).toEqual(checkNames);
    expect(stored.checks.every((c) => c.result === "clear")).toBe(true);
    await f.sale({ state: "received", amount: "1470001" });
    const after = await f.checklist();
    expect(after.checks.find((c) => c.name === "uploads")?.outcome).toBe(
      "unresolved",
    );
    expect(after.readiness.phoneCheck.state).toBe("stale");
    expect(
      storedChecklistSchema.parse(
        await api(
          f.actor,
          `giveaway/${f.campaignId}/reconciliation/results/${preview.reconciliationId}`,
        ),
      ),
    ).toEqual(stored);
  } finally {
    await f.close();
  }
});

test("I-26/I-46 real HTTP sealed byte receipt invalidates a prior candidate view and unavailable-phone approval", async ({
  request,
  leaderboardStack,
}) => {
  test.setTimeout(90000);
  const f = await checklistFixture(request, leaderboardStack.origin);
  try {
    const partial = await f.sale({ state: "received" });
    await f.configure();
    await f.designate();
    const census = await f.census();
    const phoneId = census.phones.items[0]!.id;
    const proposed = await f.propose(phoneId, [partial.id]);
    const reviewer = await f.otherActor();
    const asset = v7(),
      observation = v7();
    await f.pool.query(
      "INSERT INTO photo_asset(id,purchase_id,upload_operation_id,state,staging_key,staging_expires_at,expected_digest,expected_bytes) VALUES($1,$2,$3,'staged',$4,clock_timestamp()+interval '1 hour',$5,100)",
      [asset, partial.id, v7(), `fictional/${asset}`, "a".repeat(64)],
    );
    await f.pool.query(
      "INSERT INTO photo_receipt_observation(id,station_id,purchase_id,asset_id,declared_digest,observed_digest,observed_bytes,sealed_key,receipt_at) VALUES($1,$2,$3,$4,$5,$5,100,$6,clock_timestamp())",
      [
        observation,
        seedId(8),
        partial.id,
        asset,
        "a".repeat(64),
        `fictional/sealed/${asset}`,
      ],
    );
    const stale = await request.get(
      `/api/admin/giveaway/${f.campaignId}/reconciliation/selection/phones/${phoneId}/incomplete-sources?${new URLSearchParams({ expectedView: proposed.sources.view.viewToken })}`,
    );
    expect(stale.status(), await stale.text()).toBe(409);
    expect((await stale.json()).error.code).toBe("read_view_stale");
    const denied = await reviewer.request.post(
      `/api/admin/giveaway/${f.campaignId}/reconciliation/exclusions/${proposed.result.exclusion.id}/decision`,
      {
        headers: { Origin: leaderboardStack.origin },
        data: {
          operationId: v7(),
          expectedVersion: 1,
          decision: "approve",
          reason: "Fictional stale-byte proposal cannot be approved",
        },
      },
    );
    expect(denied.status(), await denied.text()).toBe(409);
    // P-30 common errors require version_conflict for a stale expectedVersion.
    expect((await denied.json()).error.code).toBe("version_conflict");
    const superseded = await api<{ state: string; version: number }>(
      f.actor,
      `giveaway/${f.campaignId}/reconciliation/exclusions/${proposed.result.exclusion.id}`,
    );
    expect(superseded).toMatchObject({ state: "superseded", version: 2 });
    const freshVersion = await reviewer.request.post(
      `/api/admin/giveaway/${f.campaignId}/reconciliation/exclusions/${proposed.result.exclusion.id}/decision`,
      {
        headers: { Origin: leaderboardStack.origin },
        data: {
          operationId: v7(),
          expectedVersion: superseded.version,
          decision: "approve",
          reason: "Fictional superseded proposal remains unusable",
        },
      },
    );
    expect(freshVersion.status(), await freshVersion.text()).toBe(409);
    expect((await freshVersion.json()).error.code).toBe("exclusion_stale");
    const current = incompleteSelectionSchema.parse(
      await api(
        f.actor,
        `giveaway/${f.campaignId}/reconciliation/selection/phones/${phoneId}/incomplete-sources`,
      ),
    );
    expect(current.items.map((i) => i.purchaseId)).not.toContain(partial.id);
    expect(
      (
        await f.pool.query(
          "SELECT count(*)::int n FROM giveaway_phone_exclusion_transition WHERE exclusion_id=$1 AND state='approved'",
          [proposed.result.exclusion.id],
        )
      ).rows[0].n,
    ).toBe(0);
  } finally {
    await f.close();
  }
});

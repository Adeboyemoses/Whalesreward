import { test, expect } from "../leaderboards/test";
import { v7 } from "uuid";
import type pg from "pg";
import { checklistFixture, api, guard } from "../checklist/helpers";
import type { Preview, Snapshot } from "../leaderboards/helpers";
import { phoneSelectionSchema } from "../../src/shared/contracts/giveaway-projections";

/** Includes receipts and audits: a refusal must roll back the entire domain
 * mutation, rather than merely leave its current phone-check pointer alone. */
async function domainState(pool: pg.Pool) {
  const state: Record<string, unknown> = {};
  for (const table of [
    "campaign",
    "station_reporting_state",
    "giveaway_phone_census",
    "giveaway_phone_check",
    "giveaway_phone_exclusion",
    "giveaway_phone_exclusion_transition",
    "mutation_receipt",
    "audit_event",
    "giveaway_reconciliation",
    "giveaway_preview",
    "giveaway_snapshot",
  ]) {
    state[table] = (
      await pool.query(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${table} t`,
      )
    ).rows[0].rows;
  }
  return state;
}

async function history(pool: pg.Pool, campaignId: string) {
  return (
    await pool.query(
      `SELECT
       (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id)::text FROM giveaway_phone_exclusion e WHERE campaign_id=$1) exclusions,
       (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id)::text FROM giveaway_phone_exclusion_transition t JOIN giveaway_phone_exclusion e ON e.id=t.exclusion_id WHERE e.campaign_id=$1) decisions,
       (SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id)::text FROM giveaway_snapshot s WHERE campaign_id=$1) snapshots,
       (SELECT jsonb_agg(to_jsonb(ss) ORDER BY ss.id)::text FROM giveaway_snapshot_source ss JOIN giveaway_snapshot s ON s.id=ss.snapshot_id WHERE s.campaign_id=$1) snapshot_sources`,
      [campaignId],
    )
  ).rows[0];
}

test("I-46 P-30 real HTTP refuses old-census recovery without effects and accepts the same phone only under a replacement census while preserving exclusions and snapshots", async ({
  request,
  leaderboardStack,
}) => {
  test.setTimeout(90000);
  const f = await checklistFixture(request, leaderboardStack.origin);
  try {
    await f.sale({ amount: "1370001" });
    await f.configure();
    await f.designate();
    const initial = await f.census();
    const phoneId = initial.phones.items[0]!.id;
    const proposal = await f.propose(phoneId, []);
    const reviewer = await f.otherActor();
    const approved = await api<{ exclusion: { id: string; state: string } }>(
      reviewer,
      `giveaway/${f.campaignId}/reconciliation/exclusions/${proposal.result.exclusion.id}/decision`,
      {
        operationId: v7(),
        expectedVersion: proposal.result.exclusion.version,
        decision: "approve",
        reason: "Fictional independent unavailable handset approval",
      },
    );
    expect(approved.exclusion.state).toBe("approved");
    const beforeHistory = await history(f.pool, f.campaignId!);
    const current = phoneSelectionSchema.parse(
      await api(
        f.actor,
        `giveaway/${f.campaignId}/reconciliation/selection/phones`,
      ),
    );
    expect(current.view.censusId).toBe(initial.phones.view.censusId);
    const phone = current.items.find((p) => p.id === phoneId)!;
    const emptyRequest = {
      operationId: v7(),
      kind: current.view.kind,
      reason: "Fictional recovered handset inspected empty under old census",
      ...current.view.guard,
      expectedCensusVersion: current.view.censusVersion,
      entries: [
        {
          phoneId,
          expectedPhoneVersion: phone.version,
          result: "empty",
          exclusionId: null,
        },
      ],
    };
    const before = await domainState(f.pool);
    const refused = await request.post(
      `/api/admin/giveaway/${f.campaignId}/reconciliation/phone-checks`,
      { headers: { Origin: leaderboardStack.origin }, data: emptyRequest },
    );
    expect(refused.status(), await refused.text()).toBe(409);
    expect(refused.headers()["cache-control"]).toBe("no-store");
    expect((await refused.json()).error).toMatchObject({
      code: "phone_check_stale",
      retryable: false,
    });
    expect(await domainState(f.pool)).toEqual(before);
    expect(await history(f.pool, f.campaignId!)).toEqual(beforeHistory);

    // The approved unavailable result remains valid under its original census.
    await f.certify(phoneId, approved.exclusion.id);
    const preview = await api<Preview>(
      f.actor,
      `giveaway/${f.campaignId}/previews`,
      {
        operationId: v7(),
        kind: "initial",
        reason: "Fictional frozen result before handset recovery",
        ...guard(await f.campaign()),
      },
      201,
    );
    const snapshot = await api<Snapshot>(
      f.actor,
      `giveaway/${f.campaignId}/snapshots`,
      {
        operationId: v7(),
        previewId: preview.id,
        contentDigest: preview.contentDigest,
        ...preview.guard,
      },
      201,
    );
    expect(snapshot.number).toBe(1);
    const frozen = await history(f.pool, f.campaignId!);
    expect(frozen.snapshots).not.toBeNull();
    expect(frozen.snapshot_sources).not.toBeNull();
    const originalCensus = (
      await f.pool.query(
        "SELECT to_jsonb(c)::text AS body FROM giveaway_phone_census c WHERE id=$1",
        [current.view.censusId],
      )
    ).rows[0].body;
    const revisionView = phoneSelectionSchema.parse(
      await api(
        f.actor,
        `giveaway/${f.campaignId}/reconciliation/selection/phones`,
      ),
    );
    expect(revisionView.view.kind).toBe("revision");
    await api(
      f.actor,
      `giveaway/${f.campaignId}/reconciliation/censuses`,
      {
        operationId: v7(),
        kind: revisionView.view.kind,
        reason: "Fictional replacement census after physical handset recovery",
        ...revisionView.view.guard,
        expectedCensusVersion: revisionView.view.censusVersion,
        phones: [
          {
            id: phoneId,
            label: phone.label,
            attendantIds: initial.attendants.map((a) => a.attendantId),
          },
        ],
      },
      201,
    );
    const replacement = phoneSelectionSchema.parse(
      await api(
        f.actor,
        `giveaway/${f.campaignId}/reconciliation/selection/phones`,
      ),
    );
    expect(replacement.view.censusId).not.toBe(current.view.censusId);
    expect(replacement.view.censusVersion).toBe(current.view.censusVersion + 1);
    expect(replacement.items[0]!.id).toBe(phoneId);
    expect(replacement.items[0]!.version).toBe(phone.version + 1);
    const checked = await f.certify(phoneId);
    expect(checked).toMatchObject({
      phoneCheck: { censusId: replacement.view.censusId, kind: "revision" },
    });
    const checklist = await f.checklist();
    expect(checklist.readiness.phoneCheck.state).toBe("complete");
    expect(checklist.readiness.canPrepare).toBe(true);
    expect(checklist.readiness.blockers).not.toContain("phone_check_required");
    const reconciled = await api(f.actor, `giveaway/${f.campaignId}/previews`, {
      operationId: v7(),
      kind: "revision",
      reason: "Fictional recovered handset replacement census reconciliation",
      ...guard(await f.campaign()),
    });
    expect(reconciled).toMatchObject({
      state: "unchanged",
      currentSnapshotId: snapshot.id,
    });
    expect(await history(f.pool, f.campaignId!)).toEqual(frozen);
    expect(
      (
        await f.pool.query(
          "SELECT to_jsonb(c)::text AS body FROM giveaway_phone_census c WHERE id=$1",
          [current.view.censusId],
        )
      ).rows[0].body,
    ).toBe(originalCensus);
  } finally {
    await f.close();
  }
});

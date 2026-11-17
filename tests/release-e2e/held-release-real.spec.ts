import { test, expect, type Page } from "@playwright/test";
import { v7 } from "uuid";
import {
  releaseFixture,
  boundarySale,
  preparation,
  uploadSheet,
  proposalBody,
  post,
  type Proposal,
  historical,
  type ReleaseFixture,
} from "../fixtures/held-release-browser";
import { adminDetail } from "../reviews/helpers";
import { data } from "../sales-history/helpers";

// Signed object URLs and protected paper content must never enter test traces.
test.use({
  trace: "off",
  video: "off",
  screenshot: "off",
  actionTimeout: 15000,
});

async function propose(
  page: Page,
  f: ReleaseFixture,
  kind: "price" | "card" | "date" | "capture",
  outcome: "confirm" | "cancel" = "confirm",
) {
  const sale = await boundarySale(f, kind);
  const prep = await preparation(page, sale.id, kind);
  expect(prep.admission).toEqual({
    state: "structurally_admissible",
    reason: "temporal_boundary",
  });
  expect(prep.proposerAccess).toEqual({ allowed: true, reason: null });
  const sheet = await uploadSheet(page, sale.id, prep, outcome);
  const body = proposalBody(prep, sheet.assetId, outcome);
  const proposal = (await post(
    page.request,
    `/api/admin/sales/${sale.id}/release-proposals`,
    body,
    201,
  )) as Proposal;
  return { sale, prep, sheet, body, proposal };
}

for (const kind of ["price", "card", "date", "capture"] as const) {
  test(`I-22 I-35 ${kind}: real v2 preparation, private upload and independent approval retain original facts`, async ({
    request,
  }) => {
    const page = { request } as Page;
    test.setTimeout(120000);
    const f = await releaseFixture(page);
    try {
      const x = await propose(page, f, kind);
      expect(x.proposal.state).toBe("pending");
      expect(x.proposal.target).toEqual(x.prep.target);
      expect(x.proposal.facts.cardId).toBe(f.cardId);
      expect(x.proposal.facts.accountId).toBe(f.attendant.accountId);
      const before = await adminDetail(page, x.sale.id);
      expect(before.version).toBe(x.prep.guard.expectedVersion + 1);
      expect(before.credited).toBe(false);
      const self = await page.request.post(
        `/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}/decision`,
        {
          headers: { Origin: "http://127.0.0.1:3000" },
          data: {
            operationId: v7(),
            expectedVersion: before.version,
            expectedRevisionId: before.currentRevisionId,
            expectedProposalVersion: x.proposal.version,
            outcome: "approve",
            reason: "Fictional independent inspection",
          },
        },
      );
      expect(self.status()).toBe(403);
      expect((await self.json()).error.code).toBe(
        "independent_reviewer_required",
      );
      const body = {
        operationId: v7(),
        expectedVersion: before.version,
        expectedRevisionId: before.currentRevisionId,
        expectedProposalVersion: x.proposal.version,
        outcome: "approve",
        reason:
          "I independently inspected the matching entry and complete range",
      };
      const result = (await post(
        f.reviewer.request,
        `/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}/decision`,
        body,
      )) as {
        proposal: Proposal;
        decision: { result: { creditedAfter: boolean } };
      };
      expect(result.proposal.state).toBe("approved");
      expect(result.proposal.decision!.actor.id).toBe(f.second.userId);
      expect(result.proposal.proposedBy.id).toBe(f.userId);
      const replay = await post(
        f.reviewer.request,
        `/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}/decision`,
        body,
      );
      expect(replay).toEqual(result);
      const current = await adminDetail(page, x.sale.id);
      expect(current.original).toEqual(before.original);
      expect(current.credited).toBe(result.decision.result.creditedAfter);
      if (kind !== "capture")
        expect(
          current.holds.find(
            (h) => h.id === (x.prep.target as { holdId: string }).holdId,
          )?.state,
        ).not.toBe("open");
      const own = await data<Record<string, unknown>>(
        f.phone.request,
        `/api/attendant/sales/${x.sale.id}`,
      );
      expect(own).not.toHaveProperty("pendingRelease");
      for (const forbidden of [
        "facts",
        "sheetAssetId",
        "releaseProposalId",
        "entryReference",
        "proposedBy",
      ])
        expect(own).not.toHaveProperty(forbidden);
      const audit = (
        await f.db.query(
          "SELECT action,after,reason FROM audit_event WHERE target_id=$1 AND action LIKE 'held_release_%' ORDER BY occurred_at",
          [x.sale.id],
        )
      ).rows;
      expect(audit.map((a) => a.action)).toEqual([
        "held_release_proposed",
        "held_release_approved",
      ]);
      expect(JSON.stringify(audit)).not.toContain(x.body.facts.entryReference);
      expect(JSON.stringify(audit)).not.toContain(x.body.reason);
      expect(JSON.stringify(audit)).not.toContain("recordedAmountKobo");
    } finally {
      await f.close();
    }
  });
}

test("I-35 void-only cancellation is terminal while rejection preserves held values", async ({
  request,
}) => {
  const page = { request } as Page;
  test.setTimeout(120000);
  const f = await releaseFixture(page);
  try {
    const x = await propose(page, f, "date", "cancel");
    const before = await adminDetail(page, x.sale.id);
    const reject = {
      operationId: v7(),
      expectedVersion: before.version,
      expectedRevisionId: before.currentRevisionId,
      expectedProposalVersion: 1,
      outcome: "reject",
      reason: "The photographed entry cannot be independently verified",
    };
    const result = (await post(
      f.reviewer.request,
      `/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}/decision`,
      reject,
    )) as { proposal: Proposal; decision: { result: null } };
    expect(result.proposal.state).toBe("rejected");
    expect(result.decision.result).toBeNull();
    const after = await adminDetail(page, x.sale.id);
    expect(after.credited).toBe(false);
    expect(after.original).toEqual(before.original);
    expect(after.holds).toEqual(before.holds);
    const prep = await preparation(page, x.sale.id, "date");
    const second = (await post(
      page.request,
      `/api/admin/sales/${x.sale.id}/release-proposals`,
      proposalBody(prep, x.sheet.assetId, "cancel"),
      201,
    )) as Proposal;
    const fresh = await adminDetail(page, x.sale.id);
    await post(
      f.reviewer.request,
      `/api/admin/sales/${x.sale.id}/release-proposals/${second.id}/decision`,
      {
        operationId: v7(),
        expectedVersion: fresh.version,
        expectedRevisionId: fresh.currentRevisionId,
        expectedProposalVersion: second.version,
        outcome: "approve",
        reason:
          "The matching entry explicitly records the original sale as erroneous",
      },
    );
    const cancelled = await adminDetail(page, x.sale.id);
    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.credited).toBe(false);
    expect(cancelled.original).toEqual(before.original);
  } finally {
    await f.close();
  }
});

test("I-39 stale approval never rebases; independent rejection uses the fresh post-proposal guard", async ({
  request,
}) => {
  const page = { request } as Page;
  test.setTimeout(120000);
  const f = await releaseFixture(page);
  try {
    const x = await propose(page, f, "date");
    const current = await adminDetail(page, x.sale.id);
    await historical(
      f.db,
      "purchase",
      "UPDATE purchase SET version=version+1 WHERE id=$1",
      [x.sale.id],
    );
    const body = {
      operationId: v7(),
      expectedVersion: current.version,
      expectedRevisionId: current.currentRevisionId,
      expectedProposalVersion: x.proposal.version,
      outcome: "approve",
      reason: "Independently reviewed before a concurrent change",
    };
    const response = await f.reviewer.request.post(
      `/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}/decision`,
      { headers: { Origin: "http://127.0.0.1:3000" }, data: body },
    );
    expect(response.status()).toBe(409);
    expect(["version_conflict", "proposal_stale"]).toContain(
      (await response.json()).error.code,
    );
    const pending = await data<Proposal>(
      page.request,
      `/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}`,
    );
    expect(pending.state).toBe("pending");
    const fresh = await adminDetail(page, x.sale.id);
    const result = (await post(
      f.reviewer.request,
      `/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}/decision`,
      {
        ...body,
        operationId: v7(),
        expectedVersion: fresh.version,
        outcome: "reject",
        reason:
          "Reject obsolete proposal after independently checking current history",
      },
    )) as { proposal: Proposal };
    expect(result.proposal.state).toBe("rejected");
    expect((await adminDetail(page, x.sale.id)).credited).toBe(false);
  } finally {
    await f.close();
  }
});

test("I-07 alias and unknown canonical people cannot decide; kind access alone grants no paper", async ({
  request,
}) => {
  const page = { request } as Page;
  test.setTimeout(120000);
  const f = await releaseFixture(page);
  try {
    const x = await propose(page, f, "date");
    await f.db.query(
      "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,2,true)",
      [v7(), x.prep.originalContext.stationId, f.second.userId, f.userId],
    );
    const current = await adminDetail(page, x.sale.id);
    const body = {
      operationId: v7(),
      expectedVersion: current.version,
      expectedRevisionId: current.currentRevisionId,
      expectedProposalVersion: x.proposal.version,
      outcome: "reject",
      reason: "Different account for same person must be denied",
    };
    const alias = await f.reviewer.request.post(
      `/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}/decision`,
      { headers: { Origin: "http://127.0.0.1:3000" }, data: body },
    );
    expect(alias.status()).toBe(403);
    expect((await alias.json()).error.code).toBe(
      "independent_reviewer_required",
    );
    await f.db.query(
      "INSERT INTO held_release_person_binding(id,station_id,user_id,person_id,version,verified) VALUES($1,$2,$3,$4,3,false)",
      [
        v7(),
        x.prep.originalContext.stationId,
        f.second.userId,
        f.second.userId,
      ],
    );
    const unknown = await f.reviewer.request.post(
      `/api/admin/sales/${x.sale.id}/release-proposals/${x.proposal.id}/decision`,
      {
        headers: { Origin: "http://127.0.0.1:3000" },
        data: { ...body, operationId: v7() },
      },
    );
    expect(unknown.status()).toBe(403);
    expect((await unknown.json()).error.code).toBe("independence_unverifiable");
  } finally {
    await f.close();
  }
});

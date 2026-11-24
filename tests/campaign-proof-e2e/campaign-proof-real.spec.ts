import {
  test,
  request as requestFactory,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { v7 } from "uuid";
import {
  releaseFixture,
  boundarySale,
  preparation,
  uploadSheet,
  proposalBody,
  post,
  historical,
  type ReleaseFixture,
  type Proposal,
  type PaperCaptureRange,
} from "../fixtures/held-release-browser";
import { data, type OwnDetail } from "../sales-history/helpers";
import { adminDetail } from "../reviews/helpers";
import { browserReleasePolicy } from "../reviews/release-browser-policy";
import { seedId } from "../station/helpers";
import {
  guard,
  type Campaign,
  type Preview,
  type Snapshot,
} from "../leaderboards/helpers";
import type { AttendantCorrection } from "../../src/shared/contracts/sales";

// Private paper, session data and presigned URLs must not enter Playwright artifacts.
test.use({ trace: "off", video: "off", screenshot: "off" });
test.setTimeout(180000);

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`/api/admin/${path}`);
  const json = await response.json();
  expect(response.status(), json.error?.code ?? path).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  return json.data as T;
}
async function campaign(f: ReleaseFixture) {
  return (
    await get<{ campaign: Campaign }>(f.adminRequest, "giveaway/campaign")
  ).campaign;
}
async function setupBounds(f: ReleaseFixture) {
  const c = await campaign(f);
  // Disposable retained history: the immutable capture interval crosses this start.
  // Approval below must resolve it; never forge a review_evaluation or conclusion.
  await historical(
    f.db,
    "settings_version",
    "UPDATE settings_version SET launch_at='2026-11-01T00:00:00Z',purchase_start='2026-11-10T12:05:00Z',purchase_cutoff='2026-11-11T12:00:00Z',grace_hours=24,upload_deadline='2026-11-12T12:00:00Z',timing_policy_version='campaign-timing-v1' WHERE id=$1",
    [c.settingsVersionId],
  );
  await f.db.query(
    "UPDATE campaign SET reconciliation_required=true,version=version+1 WHERE id=$1",
    [c.id],
  );
  return campaign(f);
}
async function timelyPhoto(f: ReleaseFixture, purchaseId: string) {
  // Retain an actual decoded/uploaded meter with fictional historical receipt time.
  // Both sides of the exact FK move together during fixture construction only;
  // restore its immediate constraint and every immutable trigger before HTTP decisions.
  await f.db.query("BEGIN");
  try {
    await f.db.query(
      "ALTER TABLE photo_receipt_fact ALTER CONSTRAINT receipt_fact_exact_observation DEFERRABLE INITIALLY DEFERRED",
    );
    await f.db.query(
      "ALTER TABLE photo_receipt_observation DISABLE TRIGGER USER",
    );
    await f.db.query("ALTER TABLE photo_receipt_fact DISABLE TRIGGER USER");
    await f.db.query(
      "UPDATE photo_receipt_observation SET receipt_at='2026-11-10T13:00:00Z' WHERE purchase_id=$1",
      [purchaseId],
    );
    await f.db.query(
      "UPDATE photo_receipt_fact SET receipt_at='2026-11-10T13:00:00Z' WHERE purchase_id=$1",
      [purchaseId],
    );
    await f.db.query("SET CONSTRAINTS ALL IMMEDIATE");
    await f.db.query(
      "ALTER TABLE photo_receipt_observation ENABLE TRIGGER USER",
    );
    await f.db.query("ALTER TABLE photo_receipt_fact ENABLE TRIGGER USER");
    await f.db.query(
      "ALTER TABLE photo_receipt_fact ALTER CONSTRAINT receipt_fact_exact_observation NOT DEFERRABLE",
    );
    await f.db.query("COMMIT");
  } catch (error) {
    await f.db.query("ROLLBACK");
    throw error;
  }
}

async function approve(
  f: ReleaseFixture,
  saleId: string,
  range: PaperCaptureRange,
) {
  const page = { request: f.adminRequest } as Page;
  const prep = await preparation(page, saleId, "capture");
  expect(prep.admission.state).toBe("structurally_admissible");
  const original = (await adminDetail(page, saleId)).original;
  const sheet = await uploadSheet(page, saleId, prep, "confirm", range);
  const body = proposalBody(prep, sheet.assetId, "confirm", range);
  const proposal = (await post(
    f.adminRequest,
    `/api/admin/sales/${saleId}/release-proposals`,
    body,
    201,
  )) as Proposal;
  const before = await adminDetail(page, saleId);
  const decisionBody = {
    operationId: v7(),
    expectedVersion: before.version,
    expectedRevisionId: before.currentRevisionId,
    expectedProposalVersion: proposal.version,
    outcome: "approve",
    reason:
      "Independent inspection confirms the complete photographed time range",
  };
  const endpoint = `/api/admin/sales/${saleId}/release-proposals/${proposal.id}/decision`;
  const self = await f.adminRequest.post(endpoint, {
    headers: { Origin: "http://127.0.0.1:3000" },
    data: decisionBody,
  });
  expect(self.status()).toBe(403);
  expect((await self.json()).error.code).toBe("independent_reviewer_required");
  const decision = await post(f.reviewer.request, endpoint, decisionBody);
  const after = await adminDetail(page, saleId);
  expect(after.credited).toBe(true);
  expect(after.original).toEqual(original);
  expect(after.currentRevisionId).toBeTruthy();
  return { original, after, endpoint, decisionBody, decision };
}
async function phoneCheck(f: ReleaseFixture, kind: "initial" | "revision") {
  const c = await campaign(f),
    root = `/api/admin/giveaway/${c.id}/reconciliation`;
  if (kind === "initial")
    await post(
      f.adminRequest,
      `${root}/manager`,
      {
        operationId: v7(),
        expectedVersion: c.version,
        managerAdminId: f.adminId,
        reason: "Fictional local campaign manager",
      },
      201,
    );
  const existing = await get<{ census: { version: number } }>(
    f.adminRequest,
    `giveaway/${c.id}/reconciliation/phones`,
  );
  const attendants = (
    await f.db.query("SELECT DISTINCT attendant_id FROM assignment")
  ).rows.map((r) => r.attendant_id as string);
  const census = (await post(
    f.adminRequest,
    `${root}/censuses`,
    {
      operationId: v7(),
      kind,
      reason: "Complete physical census of fictional local phones",
      ...guard(await campaign(f)),
      expectedCensusVersion: existing.census.version,
      phones: [
        {
          label: "Fictional retained capture handset",
          attendantIds: attendants,
        },
      ],
    },
    201,
  )) as { census: { version: number } };
  const phones = await get<{
    phones: { items: { id: string; version: number }[] };
  }>(f.adminRequest, `giveaway/${c.id}/reconciliation/phones`);
  await post(
    f.adminRequest,
    `${root}/phone-checks`,
    {
      operationId: v7(),
      kind,
      reason: "Each fictional phone inspected and its queue found empty",
      ...guard(await campaign(f)),
      expectedCensusVersion: census.census.version,
      entries: phones.phones.items.map((p) => ({
        phoneId: p.id,
        expectedPhoneVersion: p.version,
        result: "empty",
        exclusionId: null,
      })),
    },
    201,
  );
}
async function snapshot(f: ReleaseFixture, kind: "initial" | "revision") {
  await phoneCheck(f, kind);
  const c = await campaign(f);
  const readiness = await get<{ blockers: string[]; canPrepare: boolean }>(
    f.adminRequest,
    `giveaway/${c.id}/readiness`,
  );
  expect(readiness.blockers).not.toContain("eligibility_unresolved");
  expect(readiness.canPrepare).toBe(true);
  const preview = (await post(
    f.adminRequest,
    `/api/admin/giveaway/${c.id}/previews`,
    {
      operationId: v7(),
      kind,
      reason: "Fictional bound release source reconciliation",
      ...guard(c),
    },
    201,
  )) as Preview;
  const saved = (await post(
    f.adminRequest,
    `/api/admin/giveaway/${c.id}/snapshots${preview.guard.expectedPreviousSnapshotId ? `/${preview.guard.expectedPreviousSnapshotId}/revisions` : ""}`,
    {
      operationId: v7(),
      previewId: preview.id,
      contentDigest: preview.contentDigest,
      ...preview.guard,
    },
    201,
  )) as Snapshot;
  const sources = await get<{
    items: {
      purchaseId: string;
      revisionId: string;
      included: boolean;
      reasons: string[];
      amountKobo: string;
    }[];
  }>(f.adminRequest, `giveaway/${c.id}/snapshots/${saved.id}/sources`);
  return { saved, sources };
}
async function assertSpend(
  f: ReleaseFixture,
  campaignId: string,
  amount: string,
  included = true,
) {
  type Rows = {
    items: {
      customerId: string;
      totals: { spend: { currency: string; amountKobo: string }[] };
    }[];
  };
  for (const basis of ["recorded_all_time", "campaign_qualifying"] as const) {
    const rows = await get<Rows>(
      f.adminRequest,
      `leaderboards?basis=${basis}${basis === "campaign_qualifying" ? `&campaignId=${campaignId}` : ""}`,
    );
    const row = rows.items.find((r) => r.customerId === f.customerId);
    if (basis === "campaign_qualifying" && !included)
      expect(row).toBeUndefined();
    else {
      expect(row).toBeDefined();
      expect(
        row!.totals.spend.find((s) => s.currency === "NGN")?.amountKobo,
      ).toBe(amount);
    }
  }
}

test("WHR-184 I-45a real HTTP inside and outside proof reaches both leaderboards, readiness and immutable snapshot sources after later correction", async ({
  request,
}) => {
  const f = await releaseFixture({ request } as Page);
  let outside: ReleaseFixture | undefined;
  const outsideRequest = await requestFactory.newContext({
    baseURL: "http://127.0.0.1:3000",
  });
  try {
    const version = Number(
      (await f.db.query("SHOW server_version_num")).rows[0].server_version_num,
    );
    expect(version).toBeGreaterThanOrEqual(160000);
    expect(version).toBeLessThan(170000);
    const sale = await boundarySale(f, "capture");
    await timelyPhoto(f, sale.id);
    // A different real attendant/pump avoids overlapping historical assignments.
    outside = await releaseFixture(
      { request: outsideRequest } as Page,
      undefined,
      {
        pumpId: seedId(15),
      },
    );
    const outsideSale = await boundarySale(outside, "capture");
    await timelyPhoto(outside, outsideSale.id);
    const c = await setupBounds(f);
    const outsideResult = await approve(outside, outsideSale.id, {
      from: "2026-11-10T12:01:00.000Z",
      through: "2026-11-10T12:03:59.999Z",
      timezone: "Africa/Lagos",
    });
    await assertSpend(outside, c.id, "2000000", false);
    const x = await approve(f, sale.id, {
      from: "2026-11-10T12:10:00.000Z",
      through: "2026-11-10T12:20:59.999Z",
      timezone: "Africa/Lagos",
    });
    await assertSpend(f, c.id, "2000000");
    const first = await snapshot(f, "initial");
    expect(first.sources.items.filter((s) => s.purchaseId === sale.id)).toEqual(
      [
        expect.objectContaining({
          purchaseId: sale.id,
          revisionId: x.after.currentRevisionId,
          included: true,
          reasons: [],
          amountKobo: "2000000",
        }),
      ],
    );
    expect(
      first.sources.items.filter((s) => s.purchaseId === outsideSale.id),
    ).toEqual([
      expect.objectContaining({
        revisionId: outsideResult.after.currentRevisionId,
        included: false,
        reasons: ["outside_period"],
      }),
    ]);
    const frozen = await get(
      f.adminRequest,
      `giveaway/${c.id}/snapshots/${first.saved.id}`,
    );
    const frozenSources = first.sources;
    // Ordinary late numeric correction uses real attendant submission and admin approval.
    const own = await data<OwnDetail>(
      f.phone.request,
      `/api/attendant/sales/${sale.id}`,
    );
    let correction = await data<AttendantCorrection>(
      f.phone.request,
      `/api/attendant/sales/${sale.id}/corrections`,
      {
        operationId: v7(),
        expectedVersion: own.version,
        basedOnRevisionId: own.currentRevisionId,
        evidenceAssetId: own.evidence.assetId,
        edit: { basis: "amount", enteredAmountKobo: "2200000" },
        reason: "Correct fictional captured amount after independent release",
      },
      201,
    );
    await expect
      .poll(
        async () => {
          correction = await data<AttendantCorrection>(
            f.phone.request,
            `/api/attendant/sales/${sale.id}/corrections/by-operation/${correction.operationId}`,
          );
          return correction.state;
        },
        { timeout: 30000 },
      )
      .toBe("awaiting_review");
    const latest = await adminDetail({ request } as Page, sale.id);
    await post(
      f.adminRequest,
      `/api/admin/sales/${sale.id}/corrections/${correction.id}/decision`,
      {
        operationId: v7(),
        expectedVersion: latest.version,
        expectedRevisionId: latest.currentRevisionId,
        expectedCorrectionVersion: correction.version,
        outcome: "approve",
        reason: "Independent meter inspection confirms corrected amount",
      },
    );
    const corrected = await adminDetail({ request } as Page, sale.id);
    expect(corrected.currentRevisionId).not.toBe(x.after.currentRevisionId);
    expect(corrected.original).toEqual(x.original);
    await assertSpend(f, c.id, "2200000");
    const second = await snapshot(f, "revision");
    expect(second.saved.previousSnapshotId).toBe(first.saved.id);
    expect(
      second.sources.items.filter((s) => s.purchaseId === sale.id),
    ).toEqual([
      expect.objectContaining({
        revisionId: corrected.currentRevisionId,
        included: true,
        amountKobo: "2200000",
      }),
    ]);
    expect(
      await get(f.adminRequest, `giveaway/${c.id}/snapshots/${first.saved.id}`),
    ).toEqual(frozen);
    expect(
      await get(
        f.adminRequest,
        `giveaway/${c.id}/snapshots/${first.saved.id}/sources`,
      ),
    ).toEqual(frozenSources);
    // Policy selection can later be unavailable; accepted proof and replay remain historical.
    await f.db.query(
      "INSERT INTO review_evidence_configuration(id,station_id,environment,revision,configuration,authorization_reference) VALUES($1,$2,'development',3,$3,'Fictional later unavailable policy selection')",
      [
        v7(),
        seedId(8),
        {
          ...browserReleasePolicy,
          revision: 3,
          activation: {
            state: "inactive",
            approvalReference: null,
            activatedAt: null,
          },
        },
      ],
    );
    const unavailable = await f.adminRequest.get(
      `/api/admin/sales/${sale.id}/release-preparation?kind=capture`,
    );
    expect(unavailable.status()).toBe(409);
    expect((await unavailable.json()).error.code).toBe(
      "release_policy_unconfigured",
    );
    const replay = await post(f.reviewer.request, x.endpoint, x.decisionBody);
    expect(replay).toEqual(x.decision);
    await assertSpend(f, c.id, "2200000");
    expect(
      (
        await get<{ blockers: string[] }>(
          f.adminRequest,
          `giveaway/${c.id}/readiness`,
        )
      ).blockers,
    ).not.toContain("eligibility_unresolved");
    // An equal-looking configuration is a new pin, never authority to reuse the old proof.
    const alternateSettings = v7();
    await f.db.query(
      `INSERT INTO settings_version(id,station_id,campaign_id,version,section,launch_at,purchase_start,purchase_cutoff,grace_hours,upload_deadline,timezone,effective_from,actor_id,reason,timing_policy_version,previous_version_id)
       SELECT $1,station_id,campaign_id,(SELECT max(version)+1 FROM settings_version WHERE station_id=$2),'giveaway',launch_at,purchase_start,purchase_cutoff,grace_hours,upload_deadline,timezone,clock_timestamp(),$3,'Fictional different settings identity','campaign-timing-v1',id FROM settings_version WHERE id=$4`,
      [alternateSettings, seedId(8), f.adminId, c.settingsVersionId],
    );
    await f.db.query(
      "UPDATE campaign SET current_timing_version_id=$2,version=version+1 WHERE id=$1",
      [c.id, alternateSettings],
    );
    await assertSpend(f, c.id, "2200000", false);
    expect(
      (
        await get<{ blockers: string[] }>(
          f.adminRequest,
          `giveaway/${c.id}/readiness`,
        )
      ).blockers,
    ).toContain("eligibility_unresolved");
    const foreignCampaign = await f.adminRequest.get(
      `/api/admin/leaderboards?basis=campaign_qualifying&campaignId=${v7()}`,
    );
    expect(foreignCampaign.status()).toBe(404);
    expect((await foreignCampaign.json()).error.code).toBe("not_found");
    expect((await adminDetail({ request } as Page, sale.id)).original).toEqual(
      x.original,
    );
    expect(
      await get(
        f.adminRequest,
        `giveaway/${c.id}/snapshots/${first.saved.id}/sources`,
      ),
    ).toEqual(frozenSources);
  } finally {
    await outside?.close();
    await outsideRequest.dispose();
    await f.close();
  }
});

import { beforeAll, afterAll, describe, it, expect } from "vitest";
import {
  evidenceDatabase,
  evidenceFixture,
  resetReviewFixture,
  seedHistorical,
  S,
} from "../helpers/review-evidence-fixture";
import { reviewFixtureHarness } from "../helpers/review-fixture";
import { syncFixture, campaign } from "../helpers/sync-fixture";
import {
  readSettings,
  reviewSettings,
  confirmSettings,
} from "../../src/server/modules/settings/service";
import {
  resolveEvidenceSources,
  fingerprint,
} from "../../src/server/modules/reviews/evidence-resolvers";
import { createReviewsService } from "../../src/server/modules/reviews/service";
import { newId } from "../../src/server/lib/ids";
let db: Awaited<ReturnType<typeof evidenceDatabase>>;
const config = {
  secret: "fictional-settings-lineage-test-secret",
  origin: "https://settings.example.test",
};
beforeAll(async () => {
  db = await evidenceDatabase();
}, 30000);
afterAll(async () => {
  await db.close();
});
async function retain(token: string, days: number) {
  const current = await readSettings(db.pool, config, token, "get");
  if (!("version" in current)) throw new Error("settings expected");
  const proposal = {
    expectedVersion: current.version,
    days,
    reason: "Record intended retention duration",
  };
  const review = await reviewSettings(
    db.pool,
    config,
    token,
    "retention",
    proposal,
  );
  return confirmSettings(db.pool, config, token, "retention", {
    ...proposal,
    operationId: newId(),
    reviewDigest: review.reviewDigest,
  });
}
async function trackLegacy(stationId: string) {
  await db.pool.query(
    "INSERT INTO station_reporting_state(station_id,settings_version,current_settings_version_id) SELECT station_id,version,id FROM settings_version WHERE station_id=$1 ORDER BY version DESC LIMIT 1",
    [stationId],
  );
  await db.pool.query(
    "UPDATE campaign SET current_timing_version_id=(SELECT id FROM settings_version WHERE campaign_id=campaign.id ORDER BY version DESC LIMIT 1),version=version+1 WHERE station_id=$1",
    [stationId],
  );
}
async function facts(purchaseId: string, assetId: string) {
  const c = await db.pool.connect();
  try {
    await c.query("BEGIN");
    const result = await resolveEvidenceSources(c, purchaseId, assetId);
    await c.query("COMMIT");
    return result;
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}
async function syncContext(configured: boolean) {
  await resetReviewFixture(db.pool);
  await db.pool.query(
    db.fixtures
      .split("\n")
      .filter((line) => /^(INSERT INTO (customer|card)|UPDATE card)/.test(line))
      .join("\n"),
  );
  const h = reviewFixtureHarness(db.pool),
    bytes = await h.image(),
    f = await syncFixture(db.pool, bytes);
  if (configured) {
    await campaign(db.pool, f, false);
    await trackLegacy(f.stationId);
  }
  const token = await h.adminToken();
  return { h, bytes, f, token };
}
describe("retention never enters campaign timing lineage", () => {
  it.each([false, true])(
    "actual sync across retention confirmations preserves credit and campaign membership configured=%s",
    async (configured) => {
      const x = await syncContext(configured);
      await retain(x.token, 30);
      await retain(x.token, 31);
      const sale = await x.h.settle(x.f, x.bytes);
      const row = (
        await db.pool.query(
          "SELECT p.status,v.reasons,v.campaign_eligible FROM purchase p JOIN sync_validation v ON v.purchase_id=p.id WHERE p.id=$1",
          [sale.purchaseId],
        )
      ).rows[0];
      expect(row).toEqual({
        status: "credited",
        reasons: [],
        campaign_eligible: configured,
      });
    },
  );
  it("P25 capture review excludes retention from configuration IDs and generation while retaining real timing gaps", async () => {
    const x = await evidenceFixture(db, "capture");
    await db.pool.query(
      "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_time_unresolved','fixture',clock_timestamp(),1)",
      [newId(), x.sale.purchaseId],
    );
    await trackLegacy(x.f.stationId);
    const baseline = await facts(x.sale.purchaseId, x.sale.assetId);
    expect(baseline.settings).toHaveLength(1);
    await retain(x.token, 40);
    await retain(x.token, 41);
    // Historical timestamps make retention cross the actual reviewed capture interval.
    await seedHistorical(
      db.pool,
      "settings_version",
      "UPDATE settings_version SET effective_from=$2::timestamptz+version*interval '1 second' WHERE station_id=$1 AND section='retention'",
      [x.f.stationId, S],
    );
    const after = await facts(x.sale.purchaseId, x.sale.assetId);
    expect(after.historyGeneration).toBe(baseline.historyGeneration);
    expect(after.settings).toEqual(baseline.settings);
    expect(
      after.sources
        .filter((s) => s.category === "campaign_history")
        .map((s) => s.id),
    ).toEqual(baseline.settings.map((s) => s.id));
    // A genuine subsequent timing row uses station version4, with retention versions2/3 omitted from timing ordinals.
    const timingId = newId();
    await db.pool.query(
      "INSERT INTO settings_version(id,station_id,campaign_id,version,purchase_start,purchase_cutoff,upload_deadline,timezone,effective_from,actor_id,reason,section,grace_hours,previous_version_id) SELECT $2,station_id,campaign_id,4,purchase_start,purchase_cutoff,upload_deadline,timezone,$3,actor_id,'Fictional timing revision','giveaway',24,(SELECT id FROM settings_version WHERE station_id=$1 AND version=3) FROM settings_version WHERE station_id=$1 AND version=1",
      [x.f.stationId, timingId, "2026-11-10T12:30:00Z"],
    );
    const svc = createReviewsService({
      pool: db.pool,
      storage: x.h.storage,
      env: {
        ...process.env,
        WHR_ENV: "test",
        WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(x.config),
      },
    });
    const result = await svc.decideCapture(x.token, x.sale.purchaseId, x.body);
    expect(result.creditedAfter).toBe(true);
    const evaluation = (
      await db.pool.query(
        "SELECT provenance FROM review_evaluation WHERE purchase_id=$1",
        [x.sale.purchaseId],
      )
    ).rows[0];
    expect(JSON.stringify(evaluation)).toContain(timingId);
    const retained = (
      await db.pool.query(
        "SELECT id FROM settings_version WHERE station_id=$1 AND section='retention'",
        [x.f.stationId],
      )
    ).rows;
    const conclusion = evaluation.provenance.conclusions.find(
      (c: { tag: string }) => c.tag === "campaign_membership_uniform",
    );
    expect(conclusion.configurationIds).toEqual([
      baseline.settings[0]!.id,
      timingId,
    ]);
    for (const r of retained) {
      expect(conclusion.configurationIds).not.toContain(r.id);
      expect(
        evaluation.provenance.sources.map((s: { id: string }) => s.id),
      ).not.toContain(r.id);
    }
  });
  it("actual sync still holds an interval crossing a genuine timing change after retention", async () => {
    const x = await syncContext(true);
    await retain(x.token, 50);
    await db.pool.query(
      "INSERT INTO settings_version(id,station_id,campaign_id,version,purchase_start,purchase_cutoff,upload_deadline,timezone,effective_from,actor_id,reason,section,grace_hours,previous_version_id) SELECT $2,station_id,campaign_id,3,purchase_start,purchase_cutoff+interval '1 hour',upload_deadline+interval '1 hour',timezone,clock_timestamp(),actor_id,'Fictional timing revision','giveaway',24,(SELECT id FROM settings_version WHERE station_id=$1 AND version=2) FROM settings_version WHERE station_id=$1 AND version=1",
      [x.f.stationId, newId()],
    );
    const sale = await x.h.settle(x.f, x.bytes);
    const row = (
      await db.pool.query(
        "SELECT p.status,v.reasons,v.campaign_eligible FROM purchase p JOIN sync_validation v ON v.purchase_id=p.id WHERE p.id=$1",
        [sale.purchaseId],
      )
    ).rows[0];
    expect(row.status).toBe("held");
    expect(row.reasons).toContain("capture_time_unresolved");
    expect(row.campaign_eligible).toBe(false);
  });
  it("P25 still refuses genuinely missing timing versions rather than renumbering away a gap", async () => {
    const x = await evidenceFixture(db, "capture");
    await db.pool.query(
      "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_time_unresolved','fixture',clock_timestamp(),1)",
      [newId(), x.sale.purchaseId],
    );
    await db.pool.query(
      "INSERT INTO settings_version(id,station_id,campaign_id,version,purchase_start,purchase_cutoff,upload_deadline,timezone,effective_from,actor_id,reason) SELECT $2,station_id,campaign_id,3,purchase_start,purchase_cutoff,upload_deadline,timezone,$3,actor_id,'Fictional incomplete history' FROM settings_version WHERE station_id=$1 AND version=1",
      [x.f.stationId, newId(), "2026-11-10T12:30:00Z"],
    );
    const svc = createReviewsService({
      pool: db.pool,
      storage: x.h.storage,
      env: {
        ...process.env,
        WHR_ENV: "test",
        WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(x.config),
      },
    });
    await expect(
      svc.decideCapture(x.token, x.sale.purchaseId, x.body),
    ).rejects.toMatchObject({ code: "evidence_insufficient", status: 422 });
    expect(
      (
        await db.pool.query("SELECT status FROM purchase WHERE id=$1", [
          x.sale.purchaseId,
        ])
      ).rows[0].status,
    ).toBe("held");
  });
});

describe("pre-upgrade P25 campaign provenance", () => {
  it.each([false, true])(
    "reuses exact old campaign snapshots without ignoring changed meaningful fields altered=%s",
    async (altered) => {
      const x = await evidenceFixture(db, "capture");
      await db.pool.query(
        "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_time_unresolved','fixture',clock_timestamp(),1)",
        [newId(), x.sale.purchaseId],
      );
      await trackLegacy(x.f.stationId);
      const svc = createReviewsService({
        pool: db.pool,
        storage: x.h.storage,
        env: {
          ...process.env,
          WHR_ENV: "test",
          WHR_REVIEW_EVIDENCE_POLICY: JSON.stringify(x.config),
        },
      });
      const previous = await svc.decideCapture(
        x.token,
        x.sale.purchaseId,
        x.body,
      );
      const stored = (
        await db.pool.query(
          "SELECT provenance FROM review_evaluation WHERE decision_id=$1",
          [previous.id],
        )
      ).rows[0].provenance;
      // Reconstruct the exact pre-WHR-26 to_jsonb(settings_version)-reason shape
      // from the original table columns, independent of the upgraded resolver.
      for (const source of stored.sources) {
        if (source.category !== "campaign_history") continue;
        const old = (
          await db.pool.query(
            `SELECT to_jsonb(legacy) AS snapshot FROM
    (SELECT id,created_at,station_id,campaign_id,version,purchase_start,purchase_cutoff,
     upload_deadline,timezone,retention_days,retention_approved_by,retention_approved_at,
     effective_from,actor_id FROM settings_version WHERE id=$1) legacy`,
            [source.id],
          )
        ).rows[0].snapshot;
        expect(source.snapshot).toEqual(old);
        source.snapshot = old;
        if (altered)
          source.snapshot.purchase_cutoff = "2026-12-01T00:00:00.000001+00:00";
      }
      stored.historyGeneration = fingerprint(stored.sources);
      await seedHistorical(
        db.pool,
        "review_evaluation",
        "UPDATE review_evaluation SET provenance=$2 WHERE decision_id=$1",
        [previous.id, stored],
      );
      const oldStored = JSON.stringify(
        (
          await db.pool.query(
            "SELECT provenance FROM review_evaluation WHERE decision_id=$1",
            [previous.id],
          )
        ).rows[0].provenance,
      );
      await retain(x.token, 60);
      await retain(x.token, 61);
      await seedHistorical(
        db.pool,
        "purchase",
        "UPDATE purchase SET status='held',version=version+1 WHERE id=$1 AND status='credited'",
        [x.sale.purchaseId],
      );
      const hold = newId();
      await db.pool.query(
        "INSERT INTO purchase_hold(id,purchase_id,kind,state,opened_revision_id,reason_code,version) VALUES($1,$2,'date','open',$3,'capture_date_uncertain',1)",
        [hold, x.sale.purchaseId, x.original],
      );
      const body = {
        ...(await x.h.guard(x.sale.purchaseId)),
        expectedHoldVersion: 1,
        verifiedSaleDate: "2026-11-10",
        evidence: { ...x.evidence, referenceIds: [previous.id] },
      };
      const operation = () =>
        svc.decideDate(x.token, x.sale.purchaseId, hold, body);
      if (altered)
        await expect(operation()).rejects.toMatchObject({
          code: "evidence_insufficient",
          status: 422,
        });
      else {
        const result = await operation();
        expect(result.creditedAfter).toBe(true);
        expect(await operation()).toEqual(result);
      }
      expect(
        JSON.stringify(
          (
            await db.pool.query(
              "SELECT provenance FROM review_evaluation WHERE decision_id=$1",
              [previous.id],
            )
          ).rows[0].provenance,
        ),
      ).toBe(oldStored);
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int AS count FROM review_evaluation WHERE purchase_id=$1",
            [x.sale.purchaseId],
          )
        ).rows[0].count,
      ).toBe(altered ? 1 : 2);
    },
  );
});

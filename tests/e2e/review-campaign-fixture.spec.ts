import { test, expect } from "../settings/retention-test";
import { fixture } from "../admin-access/admin-access.fixtures";
import { v7 } from "uuid";
import { ensureHistoricalCampaign } from "../reviews/helpers";

test("I-45 M3 historical campaign setup preserves retention-first history and is idempotent", async ({
  request,
  retentionStack,
}) => {
  const f = await fixture();
  try {
    expect(
      (await f.db.query("SELECT current_schema() schema")).rows[0].schema,
    ).toBe(retentionStack.schema);
    await f.db.query(
      "UPDATE auth_user SET must_change_password=false WHERE id=$1",
      [f.userId],
    );
    const post = async (path: string, input: unknown, status = 200) => {
      const response = await request.post(`/api/admin/${path}`, {
        headers: { Origin: retentionStack.origin, "idempotency-key": v7() },
        data: input,
      });
      expect(response.status()).toBe(status);
      return (await response.json()).data;
    };
    await post("sign-in", { username: f.username, password: f.password });
    const readSettings = async () => {
      const response = await request.get("/api/admin/settings");
      expect(response.status()).toBe(200);
      return (await response.json()).data;
    };
    const initial = await readSettings();
    const review = await post("settings/retention/review", {
      days: 83,
      reason: "Fictional retention before historical campaign",
      expectedVersion: initial.version,
    });
    await post(
      "settings/retention/confirm",
      {
        ...review.proposal,
        expectedVersion: review.expectedVersion,
        reviewDigest: review.reviewDigest,
        operationId: v7(),
      },
      201,
    );
    const before = await readSettings();
    const retained = (
      await f.db.query("SELECT * FROM settings_version ORDER BY version")
    ).rows;
    const history = (
      await f.db.query("SELECT * FROM settings_change ORDER BY version")
    ).rows;
    expect(retained.length).toBeGreaterThan(0);
    expect(retained.every((row) => row.section === "retention")).toBe(true);
    await ensureHistoricalCampaign(f.db);
    const timing = (
      await f.db.query(`SELECT v.*, c.current_timing_version_id
      FROM settings_version v JOIN campaign c ON c.id=v.campaign_id
      WHERE v.purchase_start='2026-11-01T00:00:00Z'
      AND v.purchase_cutoff='2026-12-01T00:00:00Z'
      AND v.upload_deadline='2026-12-02T00:00:00Z'`)
    ).rows;
    expect(timing).toHaveLength(1);
    expect(timing[0].current_timing_version_id).toBe(timing[0].id);
    expect(timing[0].version).toBe(before.version + 1);
    expect(timing[0].previous_version_id).toBe(before.settingsVersionId);
    expect((await readSettings()).retention).toEqual(before.retention);
    expect(
      (
        await f.db.query(
          "SELECT * FROM settings_version WHERE id=ANY($1::uuid[]) ORDER BY version",
          [retained.map((row) => row.id)],
        )
      ).rows,
    ).toEqual(retained);
    expect(
      (await f.db.query("SELECT * FROM settings_change ORDER BY version")).rows,
    ).toEqual(history);
    const state = (await f.db.query("SELECT * FROM station_reporting_state"))
      .rows;
    const versions = (
      await f.db.query("SELECT * FROM settings_version ORDER BY version")
    ).rows;
    await ensureHistoricalCampaign(f.db);
    expect(
      (await f.db.query("SELECT * FROM station_reporting_state")).rows,
    ).toEqual(state);
    expect(
      (await f.db.query("SELECT * FROM settings_version ORDER BY version"))
        .rows,
    ).toEqual(versions);
    // Reverse order too: a later retention intent must retain the established
    // historical campaign and its timing pointer; setup remains a no-op.
    const later = await readSettings();
    const retentionReview = await post("settings/retention/review", {
      days: 84,
      reason: "Fictional retention after historical campaign",
      expectedVersion: later.version,
    });
    await post(
      "settings/retention/confirm",
      {
        ...retentionReview.proposal,
        expectedVersion: retentionReview.expectedVersion,
        reviewDigest: retentionReview.reviewDigest,
        operationId: v7(),
      },
      201,
    );
    const campaignBefore = (
      await f.db.query("SELECT * FROM campaign ORDER BY id")
    ).rows;
    const versionsAfter = (
      await f.db.query("SELECT * FROM settings_version ORDER BY version")
    ).rows;
    const stateAfter = (
      await f.db.query("SELECT * FROM station_reporting_state")
    ).rows;
    await ensureHistoricalCampaign(f.db);
    expect(
      (await f.db.query("SELECT * FROM campaign ORDER BY id")).rows,
    ).toEqual(campaignBefore);
    expect(
      (await f.db.query("SELECT * FROM settings_version ORDER BY version"))
        .rows,
    ).toEqual(versionsAfter);
    expect(
      (await f.db.query("SELECT * FROM station_reporting_state")).rows,
    ).toEqual(stateAfter);
    expect((await readSettings()).retention.days).toBe(84);
  } finally {
    await f.db.end();
  }
});

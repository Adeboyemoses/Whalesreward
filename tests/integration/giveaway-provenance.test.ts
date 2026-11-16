import { it, expect } from "vitest";
import {
  evidenceDatabase,
  evidenceFixture,
  seedHistorical,
  S,
} from "../helpers/review-evidence-fixture";
import { createReviewsService } from "../../src/server/modules/reviews/service";
import { contributions } from "../../src/server/modules/giveaway/data";
import { newId } from "../../src/server/lib/ids";
it.each(["inside", "outside"] as const)(
  "P-25 committed %s provenance retains original facts and binds campaign configuration",
  async (mode) => {
    const db = await evidenceDatabase();
    try {
      const x = await evidenceFixture(db, "capture");
      await db.pool.query(
        "INSERT INTO purchase_validation_block(id,purchase_id,code,policy_reference,opened_at,version) VALUES($1,$2,'capture_time_unresolved','fixture',clock_timestamp(),1)",
        [newId(), x.sale.purchaseId],
      );
      await seedHistorical(
        db.pool,
        "settings_version",
        "UPDATE settings_version SET purchase_start=$2 WHERE station_id=$1",
        [x.f.stationId, mode === "inside" ? S : "2026-11-10T14:00:00Z"],
      );
      await seedHistorical(
        db.pool,
        "sync_validation",
        "UPDATE sync_validation SET campaign_eligible=false WHERE purchase_id=$1",
        [x.sale.purchaseId],
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
      await svc.decideCapture(x.token, x.sale.purchaseId, x.body);
      const settings = (
        await db.pool.query(
          "SELECT id,campaign_id FROM settings_version WHERE station_id=$1 ORDER BY version DESC LIMIT 1",
          [x.f.stationId],
        )
      ).rows[0];
      const client = await db.pool.connect();
      try {
        // A later requested interval crosses the retained raw bounds: only the bound committed conclusion supplies the answer.
        const bounds = {
          id: settings.campaign_id,
          settingsVersionId: settings.id,
          launch: (
            (BigInt(Date.parse(S)) +
              (mode === "inside" ? 1800000n : -1800000n)) *
            1000n
          ).toString(),
          start: (
            (BigInt(Date.parse(S)) +
              (mode === "inside" ? 1800000n : -1800000n)) *
            1000n
          ).toString(),
          cutoff: "1894306600000000",
          deadline: "1994306600000000",
        };
        const row = (await contributions(client, x.f.stationId, bounds)).find(
          (s) => s.purchaseId === x.sale.purchaseId,
        )!;
        expect(row.included).toBe(mode === "inside");
        expect(row.reasons).not.toContain("timing_unresolved");
        if (mode === "inside")
          expect(row.reasons).not.toContain("outside_period");
        else expect(row.reasons).toContain("outside_period");
        const stale = (
          await contributions(client, x.f.stationId, { ...bounds, id: newId() })
        ).find((s) => s.purchaseId === x.sale.purchaseId)!;
        expect(stale.included).toBe(mode === "outside");
        const staleConfig = (
          await contributions(client, x.f.stationId, {
            ...bounds,
            settingsVersionId: newId(),
          })
        ).find((s) => s.purchaseId === x.sale.purchaseId)!;
        expect(staleConfig.included).toBe(mode === "outside");
        expect(
          (
            await db.pool.query(
              "SELECT campaign_eligible FROM sync_validation WHERE purchase_id=$1",
              [x.sale.purchaseId],
            )
          ).rows[0].campaign_eligible,
        ).toBe(false);
      } finally {
        client.release();
      }
    } finally {
      await db.close();
    }
  },
  30000,
);

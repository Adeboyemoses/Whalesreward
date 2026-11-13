import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { cardsFixture, config } from "../helpers/cards-adversarial-fixture";
import {
  readSettings,
  reviewSettings,
  confirmSettings,
} from "../../src/server/modules/settings/service";
import { newId } from "../../src/server/lib/ids";
let f: Awaited<ReturnType<typeof cardsFixture>>;
beforeAll(async () => {
  f = await cardsFixture();
}, 30000);
afterAll(async () => {
  await f?.close();
});
describe("settings durable service", () => {
  it("records and clears bounded retention intent with immutable receipt and no approval", async () => {
    const a = await f.actor(["settings"]);
    const first = await readSettings(f.pool, config, a.token, "get");
    expect(first).toMatchObject({
      version: 1,
      settingsVersionId: null,
      retention: { days: null, deletionEnabled: false },
    });
    for (const days of [1, 36500, null]) {
      const current = await readSettings(f.pool, config, a.token, "get");
      if (!("version" in current)) throw new Error("settings expected");
      const proposal = {
        days,
        expectedVersion: current.version,
        reason: "Record intended evidence period",
      };
      const review = await reviewSettings(
        f.pool,
        config,
        a.token,
        "retention",
        proposal,
      );
      const input = {
        ...proposal,
        reviewDigest: review.reviewDigest,
        operationId: newId(),
      };
      const result = await confirmSettings(
        f.pool,
        config,
        a.token,
        "retention",
        input,
      );
      expect(result.replayed).toBe(false);
      expect(result.data.after).toMatchObject({ days, deletionEnabled: false });
      expect(
        await confirmSettings(f.pool, config, a.token, "retention", input),
      ).toEqual({ ...result, replayed: true });
    }
    const rows = (
      await f.pool.query(
        "SELECT retention_approved_by,retention_approved_at,full_snapshot FROM settings_version",
      )
    ).rows;
    expect(rows).toHaveLength(3);
    expect(
      rows.every(
        (r) =>
          r.retention_approved_by === null &&
          r.retention_approved_at === null &&
          r.full_snapshot.retention.deletionEnabled === false,
      ),
    ).toBe(true);
  });
  it("rejects invalid duration as a domain error without effects", async () => {
    const a = await f.actor(["settings"]);
    const current = await readSettings(f.pool, config, a.token, "get");
    if (!("version" in current)) throw new Error("settings expected");
    for (const days of [0, -1, 1.5, 36501])
      await expect(
        reviewSettings(f.pool, config, a.token, "retention", {
          days,
          expectedVersion: current.version,
          reason: "Change intended period",
        }),
      ).rejects.toMatchObject({ code: "retention_invalid", status: 422 });
  });
});

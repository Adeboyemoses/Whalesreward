import { it, expect } from "vitest";
import { giveawayFixture } from "../helpers/giveaway-fixture";
import { historicalSale } from "../helpers/cards-adversarial-fixture";
import { newId } from "../../src/server/lib/ids";

it("P-30 census cannot omit a historical attendant account", async () => {
  const f = await giveawayFixture();
  try {
    const ids = (
      await f.pool.query("SELECT DISTINCT attendant_id FROM assignment")
    ).rows.map((r) => r.attendant_id);
    expect(ids.length).toBeGreaterThan(1);
    await expect(
      f.phones.census(f.token, f.campaignId, {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional incomplete census",
        ...(await f.guard()),
        expectedCensusVersion: 1,
        phones: [{ label: "Fictional phone", attendantIds: [ids[0]] }],
      }),
    ).rejects.toMatchObject({ code: "census_incomplete" });
  } finally {
    await f.close();
  }
}, 30000);
it("P-30 accepted contributions cannot enter exact unavailable-phone partial exclusions", async () => {
  const f = await giveawayFixture();
  try {
    const sale = await historicalSale(f.pool, {});
    await f.check();
    const census = (
      await f.pool.query(
        "SELECT version,content FROM giveaway_phone_census WHERE campaign_id=$1 ORDER BY version DESC LIMIT 1",
        [f.campaignId],
      )
    ).rows[0];
    const version = (
      await f.pool.query("SELECT version FROM purchase WHERE id=$1", [sale.id])
    ).rows[0].version;
    await expect(
      f.phones.propose(f.token, f.campaignId, census.content.phones[0].id, {
        operationId: newId(),
        kind: "initial",
        reason: "Fictional invalid accepted source",
        ...(await f.guard()),
        expectedCensusVersion: census.version,
        expectedPhoneVersion: 1,
        partialSources: [
          { purchaseId: sale.id, expectedPurchaseVersion: version },
        ],
      }),
    ).rejects.toMatchObject({ code: "exclusion_source_invalid" });
  } finally {
    await f.close();
  }
}, 30000);

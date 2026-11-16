import { beforeEach, afterEach, describe, it, expect } from "vitest";
import {
  cardsFixture,
  config,
  fixtureId,
  historicalSale,
} from "../helpers/cards-adversarial-fixture";
import { readLeaderboards } from "../../src/server/modules/leaderboards/service";
let f: Awaited<ReturnType<typeof cardsFixture>>;
let token: string;
beforeEach(async () => {
  f = await cardsFixture();
  token = (await f.actor(["leaderboards"])).token;
}, 30000);
afterEach(async () => {
  await f?.close();
});
const ranking = (patch: Record<string, unknown> = {}) =>
  readLeaderboards(f.pool, config, token, {
    basis: "recorded_all_time",
    ...patch,
  });
describe("M4 exact leaderboards", () => {
  it("I-42 accepted numbers count once while proposed held and cancelled values cannot inflate spend", async () => {
    await historicalSale(f.pool, {
      amount: "1000000",
      acceptedAmount: "2000000",
      lateProposal: true,
    });
    await historicalSale(f.pool, { state: "held", amount: "9000000" });
    await historicalSale(f.pool, { state: "cancelled", amount: "9000000" });
    const r = await ranking();
    expect(r.customers).toBe("1");
    expect(r.items[0].totals.spend).toEqual([
      { currency: "NGN", amountKobo: "2000000" },
    ]);
  });
  it("I-42 equal spend shares rank across pages despite different transaction counts", async () => {
    await historicalSale(f.pool, { amount: "2000000" });
    await historicalSale(f.pool, {
      amount: "1000000",
      customerId: fixtureId(27),
    });
    await historicalSale(f.pool, {
      amount: "1000000",
      customerId: fixtureId(27),
    });
    const first = await ranking({ limit: 1 });
    const second = await ranking({ limit: 1, cursor: first.nextCursor });
    expect(first.items[0].rank).toBe("1");
    expect(second.items[0].rank).toBe("1");
    expect(first.items[0].sharedRank).toBe(true);
    expect(second.items[0].sharedRank).toBe(true);
    expect(first.items[0].customerId).not.toBe(second.items[0].customerId);
    expect(first.summary).toEqual(second.summary);
  });
  it("I-07 live permission revocation denies the next leaderboard read", async () => {
    await f.pool.query(
      "DELETE FROM role_permission WHERE permission_code='leaderboards'",
    );
    await expect(ranking()).rejects.toMatchObject({
      code: "permission_denied",
    });
  });
  it("I-42 empty categories return exact zero totals", async () => {
    const r = await ranking({ category: "cooking_gas_customer" });
    expect(r.items).toEqual([]);
    expect(r.customers).toBe("0");
  });
});

import { expect, it } from "vitest";
import { rankSpend } from "./rank";
it("shares exact spend ties with competition gaps before pagination", () => {
  expect(
    rankSpend([
      { customerId: "b", amountKobo: "9007199254740993" },
      { customerId: "a", amountKobo: "9007199254740993" },
      { customerId: "c", amountKobo: "9007199254740992" },
    ]),
  ).toEqual([
    {
      customerId: "a",
      amountKobo: "9007199254740993",
      rank: "1",
      sharedRank: true,
    },
    {
      customerId: "b",
      amountKobo: "9007199254740993",
      rank: "1",
      sharedRank: true,
    },
    {
      customerId: "c",
      amountKobo: "9007199254740992",
      rank: "3",
      sharedRank: false,
    },
  ]);
});
it("returns no ranks for an empty category", () =>
  expect(rankSpend([])).toEqual([]));

import { it, expect } from "vitest";
import { mergeOwnHistory, ownsAttendantSale } from "./history-model";
import type { AttendantSaleRow } from "@/client/sales-api";
import type { OutboxRow } from "@/client/types";
it("merges only the active account and deduplicates original identities in receipt order", () => {
  const row = (accountId: string, operationId: string, at: string) =>
    ({
      id: operationId,
      operationId,
      serverReceivedAt: at,
      seller: { accountId: `auth-${accountId}`, attendantId: accountId },
    }) as AttendantSaleRow;
  const local = (originatingAccountId: string, operationId: string) =>
    ({
      originatingAccountId,
      operationId,
      localSavedAt: "2026-11-11",
    }) as OutboxRow;
  const result = mergeOwnHistory(
    "a",
    [
      row("a", "old", "2026-01"),
      row("b", "foreign", "2027"),
      row("a", "new", "2026-02"),
      row("a", "new", "2026-02"),
    ],
    [local("a", "new"), local("a", "unsent"), local("b", "hidden")],
  );
  expect(result.remote.map((x) => x.operationId)).toEqual(["new", "old"]);
  expect(result.pending.map((x) => x.operationId)).toEqual(["unsent"]);
});

it("I-06 compares the session profile to attendantId while distinct auth IDs never confer ownership", () => {
  const own = {
    seller: { attendantId: "profile-own", accountId: "auth-own" },
  } as AttendantSaleRow;
  const foreign = {
    seller: { attendantId: "profile-foreign", accountId: "profile-own" },
  } as AttendantSaleRow;
  expect(ownsAttendantSale("profile-own", own)).toBe(true);
  expect(ownsAttendantSale("profile-own", foreign)).toBe(false);
});

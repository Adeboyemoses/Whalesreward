import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { CaptureDatabase } from "../offline/db";
import { hasPendingSales } from "./update-safety";
let db: CaptureDatabase;
beforeEach(() => {
  db = new CaptureDatabase("update-safety-test");
});
afterEach(async () => {
  await db.delete();
});
it("blocks updates for unsent sales from another signed-out account", async () => {
  await db.outbox.put({
    originatingAccountId: "other-account",
    operationId: "pending",
    state: "saved",
  } as never);
  expect(await hasPendingSales(db)).toBe(true);
});
it("allows an empty outbox without reading account identities into UI", async () => {
  expect(await hasPendingSales(db)).toBe(false);
});

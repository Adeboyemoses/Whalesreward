import { expect, it } from "vitest";
import { reviewAuditAction } from "./audit-actions";
it.each([
  ["price", "accept_captured", "price_accepted"],
  ["price", "correct_meter", "price_corrected"],
  ["price", "cancel", "price_cancelled"],
  ["card", "confirm_earlier", "card_eligibility_confirmed"],
  ["card", "cancel", "card_eligibility_cancelled"],
  ["date", "verify_date", "sale_date_verified"],
  ["capture", "confirm", "capture_confirmed"],
  ["capture", "cancel", "capture_cancelled"],
  ["duplicate", "keep_both", "duplicate_cleared"],
  ["duplicate", "cancel", "duplicate_cancelled"],
] as const)("maps %s/%s to M3 action %s", (kind, outcome, action) => {
  expect(reviewAuditAction(kind, outcome)).toBe(action);
});
it("rejects an outcome outside the target kind", () => {
  expect(() => reviewAuditAction("card", "keep_both")).toThrow(
    expect.objectContaining({ code: "invalid_request" }),
  );
});

import type { z } from "zod";
import type * as wire from "../../../shared/contracts/sales";
import { AuthError } from "../auth/errors";

type Outcomes = {
  price: z.infer<typeof wire.priceDecisionSchema>["decision"]["outcome"];
  card: z.infer<typeof wire.cardDecisionSchema>["outcome"];
  date: "verify_date";
  capture: z.infer<typeof wire.captureDecisionSchema>["outcome"];
  duplicate: z.infer<
    typeof wire.duplicateDecisionSchema
  >["decision"]["outcome"];
};
// Adding a request outcome requires an explicit M3 audit action here.
const actions = {
  price: {
    accept_captured: "price_accepted",
    correct_meter: "price_corrected",
    cancel: "price_cancelled",
  },
  card: {
    confirm_earlier: "card_eligibility_confirmed",
    cancel: "card_eligibility_cancelled",
  },
  date: { verify_date: "sale_date_verified" },
  capture: { confirm: "capture_confirmed", cancel: "capture_cancelled" },
  duplicate: { keep_both: "duplicate_cleared", cancel: "duplicate_cancelled" },
} as const satisfies { [K in keyof Outcomes]: Record<Outcomes[K], string> };
type ReviewAuditAction = {
  [K in keyof typeof actions]: (typeof actions)[K][keyof (typeof actions)[K]];
}[keyof typeof actions];
export function reviewAuditAction(
  kind: keyof Outcomes,
  outcome: string,
): ReviewAuditAction {
  const byOutcome: Readonly<Record<string, ReviewAuditAction>> = actions[kind];
  const action = Object.hasOwn(byOutcome, outcome)
    ? byOutcome[outcome]
    : undefined;
  if (!action) throw new AuthError("invalid_request", 400);
  return action;
}

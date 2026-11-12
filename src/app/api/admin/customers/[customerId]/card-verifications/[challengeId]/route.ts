import { handleCustomerRecovery } from "../../../../../../../server/modules/customers/recovery-http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ customerId: string; challengeId: string }> },
) {
  const params = await context.params;
  return handleCustomerRecovery(
    request,
    "challenge",
    params.customerId,
    params.challengeId,
  );
}

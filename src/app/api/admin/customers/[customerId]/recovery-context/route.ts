import { handleCustomerRecovery } from "../../../../../../server/modules/customers/recovery-http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
) {
  const params = await context.params;
  return handleCustomerRecovery(request, "context", params.customerId);
}

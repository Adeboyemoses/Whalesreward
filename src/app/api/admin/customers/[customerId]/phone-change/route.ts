import { handleCustomerRecovery } from "../../../../../../server/modules/customers/recovery-http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ customerId: string }> },
) {
  const params = await context.params;
  return handleCustomerRecovery(request, "phone-change", params.customerId);
}

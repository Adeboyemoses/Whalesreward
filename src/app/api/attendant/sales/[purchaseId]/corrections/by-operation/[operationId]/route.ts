import { handleCorrections } from "../../../../../../../../server/modules/corrections/http";
export async function GET(
  request: Request,
  context: { params: Promise<{ purchaseId: string; operationId: string }> },
) {
  const p = await context.params;
  return handleCorrections(request, "lookup", p.purchaseId, p.operationId);
}

import { handleReleaseDiscovery } from "../../../../../../server/modules/reviews/release-discovery-http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) {
  return handleReleaseDiscovery(request, (await context.params).purchaseId);
}

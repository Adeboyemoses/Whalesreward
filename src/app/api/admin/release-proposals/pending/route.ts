import { handleReleaseDiscovery } from "../../../../../server/modules/reviews/release-discovery-http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return handleReleaseDiscovery(request);
}

import { handleSync } from "../../../../server/modules/sync/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return handleSync(request, "submit");
}

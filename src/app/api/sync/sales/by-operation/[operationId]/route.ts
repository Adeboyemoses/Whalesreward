import { handleSync } from "../../../../../../server/modules/sync/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ operationId: string }> },
) {
  return handleSync(request, "status", (await context.params).operationId);
}

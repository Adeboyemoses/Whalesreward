import { handleSync } from "../../../../../../server/modules/sync/http";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ purchaseId: string }> },
) {
  return handleSync(
    request,
    "upload-permission",
    (await context.params).purchaseId,
  );
}

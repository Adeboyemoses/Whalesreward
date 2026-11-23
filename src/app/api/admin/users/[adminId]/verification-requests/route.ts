import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleAdmin } from "@/server/modules/admin-access/http";
export const runtime = "nodejs";
async function handlePOST(
  request: Request,
  context: { params: Promise<{ adminId: string }> },
) {
  return handleAdmin(
    request,
    "verification-requests",
    (await context.params).adminId,
  );
}

export const POST = withOperationalTelemetry(handlePOST);

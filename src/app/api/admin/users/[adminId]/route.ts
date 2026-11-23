import { withOperationalTelemetry } from "../../../../../server/modules/monitoring/telemetry";
import { handleAdmin } from "@/server/modules/admin-access/http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ adminId: string }> },
) {
  return handleAdmin(request, "users-get", (await context.params).adminId);
}

export const GET = withOperationalTelemetry(handleGET);

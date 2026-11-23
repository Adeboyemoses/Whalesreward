import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleAdmin } from "@/server/modules/admin-access/http";
export const runtime = "nodejs";
async function handlePATCH(
  request: Request,
  context: { params: Promise<{ adminId: string }> },
) {
  return handleAdmin(request, "users-access", (await context.params).adminId);
}

export const PATCH = withOperationalTelemetry(handlePATCH);

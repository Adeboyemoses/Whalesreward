import { withOperationalTelemetry } from "../../../../../server/modules/monitoring/telemetry";
import { handleAdmin } from "@/server/modules/admin-access/http";
export const runtime = "nodejs";
async function handleGET(
  request: Request,
  context: { params: Promise<{ roleId: string }> },
) {
  return handleAdmin(request, "roles-get", (await context.params).roleId);
}
async function handlePATCH(
  request: Request,
  context: { params: Promise<{ roleId: string }> },
) {
  return handleAdmin(request, "roles-edit", (await context.params).roleId);
}

export const GET = withOperationalTelemetry(handleGET);
export const PATCH = withOperationalTelemetry(handlePATCH);

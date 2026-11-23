import { withOperationalTelemetry } from "../../../../server/modules/monitoring/telemetry";
import { handleAdmin } from "@/server/modules/admin-access/http";
export const runtime = "nodejs";
async function handleGET(request: Request) {
  return handleAdmin(request, "roles-list");
}
async function handlePOST(request: Request) {
  return handleAdmin(request, "roles-create");
}

export const GET = withOperationalTelemetry(handleGET);
export const POST = withOperationalTelemetry(handlePOST);

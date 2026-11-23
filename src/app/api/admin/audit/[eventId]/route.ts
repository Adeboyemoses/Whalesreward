import { withOperationalTelemetry } from "../../../../../server/modules/monitoring/telemetry";
import { handleAudit } from "../../../../../server/modules/audit/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  return handleAudit(request, "detail", (await params).eventId);
}

export const GET = withOperationalTelemetry(handleGET);

import { withOperationalTelemetry } from "../../../server/modules/monitoring/telemetry";
import { healthResponse } from "@/server/modules/health/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handleGET(request: Request) {
  return healthResponse(request);
}

export const GET = withOperationalTelemetry(handleGET);

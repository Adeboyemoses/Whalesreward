import { withOperationalTelemetry } from "../../../../server/modules/monitoring/telemetry";
import { monitoringResponse } from "../../../../server/modules/monitoring/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handleGET = (request: Request) => monitoringResponse(request);

export const GET = withOperationalTelemetry(handleGET);

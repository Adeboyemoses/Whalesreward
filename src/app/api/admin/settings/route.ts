import { withOperationalTelemetry } from "../../../../server/modules/monitoring/telemetry";
import { handleSettings } from "../../../../server/modules/settings/http";
export const runtime = "nodejs";
const handleGET = (request: Request) => handleSettings(request, "get");

export const GET = withOperationalTelemetry(handleGET);

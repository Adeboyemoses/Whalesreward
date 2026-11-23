import { withOperationalTelemetry } from "../../../../../../server/modules/monitoring/telemetry";
import { handleSettings } from "../../../../../../server/modules/settings/http";
export const runtime = "nodejs";
const handlePOST = (request: Request) =>
  handleSettings(request, "retention-review");

export const POST = withOperationalTelemetry(handlePOST);

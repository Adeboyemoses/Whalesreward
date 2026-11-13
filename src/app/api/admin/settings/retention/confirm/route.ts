import { handleSettings } from "../../../../../../server/modules/settings/http";
export const runtime = "nodejs";
export const POST = (request: Request) =>
  handleSettings(request, "retention-confirm");

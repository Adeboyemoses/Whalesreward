import { handleAuth } from "../../../../server/modules/auth/http";
export const runtime = "nodejs";
export function GET(request: Request) {
  return handleAuth(request, "session");
}

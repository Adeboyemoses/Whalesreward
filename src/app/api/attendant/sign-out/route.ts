import { handleAuth } from "../../../../server/modules/auth/http";
export const runtime = "nodejs";
export function POST(request: Request) {
  return handleAuth(request, "sign-out");
}

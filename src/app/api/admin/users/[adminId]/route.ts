import { handleAdmin } from "@/server/modules/admin-access/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ adminId: string }> },
) {
  return handleAdmin(request, "users-get", (await context.params).adminId);
}

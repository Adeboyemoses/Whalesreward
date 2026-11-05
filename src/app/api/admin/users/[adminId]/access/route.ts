import { handleAdmin } from "@/server/modules/admin-access/http";
export const runtime = "nodejs";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ adminId: string }> },
) {
  return handleAdmin(request, "users-access", (await context.params).adminId);
}

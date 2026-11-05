import { handleAdmin } from "@/server/modules/admin-access/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ roleId: string }> },
) {
  return handleAdmin(request, "roles-get", (await context.params).roleId);
}
export async function PATCH(
  request: Request,
  context: { params: Promise<{ roleId: string }> },
) {
  return handleAdmin(request, "roles-edit", (await context.params).roleId);
}

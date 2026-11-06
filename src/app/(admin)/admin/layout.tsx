import type { ReactNode } from "react";
import { AdminSessionProvider } from "@/ui/admin/session";
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminSessionProvider>{children}</AdminSessionProvider>;
}

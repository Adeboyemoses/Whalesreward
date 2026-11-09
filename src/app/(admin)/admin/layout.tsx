import type { ReactNode } from "react";
import { AdminSessionProvider } from "@/ui/admin/session";
import { AdminPortal } from "@/ui/admin/portal";
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminSessionProvider>
      <AdminPortal path={[]} />
      {children}
    </AdminSessionProvider>
  );
}

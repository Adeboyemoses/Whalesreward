"use client";

import type { ReactNode } from "react";
import {
  AppHeader,
  BottomNav,
  Sidebar,
  type NavItem,
  type NavLabel,
  type SidebarItem,
} from "./navigation";
export function AttendantShell({
  children,
  title,
  context,
  connection,
  nav,
  active,
  pending,
  action,
}: {
  children: ReactNode;
  title: string;
  context?: ReactNode;
  connection?: "online" | "offline";
  nav: readonly NavItem[];
  active: NavLabel;
  pending?: number;
  action?: ReactNode;
}) {
  return (
    <div className="wr-root wr-phone wr-attendant-shell">
      <AppHeader title={title} context={context} connection={connection} />
      <main className="wr-screen">{children}</main>
      {action && <div className="wr-actionbar">{action}</div>}
      <BottomNav items={nav} active={active} pending={pending} />
    </div>
  );
}
export function AdminShell({
  children,
  items,
  active,
  station,
  footer,
}: {
  children: ReactNode;
  items: readonly SidebarItem[];
  active: string;
  station: string;
  footer?: ReactNode;
}) {
  return (
    <div className="wr-root wr-admin wr-admin-shell">
      <Sidebar
        items={items}
        active={active}
        station={station}
        footer={footer}
      />
      <main className="wr-main">{children}</main>
    </div>
  );
}

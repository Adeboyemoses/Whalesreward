"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  Fuel,
  UserRoundPlus,
  History,
  CloudUpload,
  UserRound,
  LayoutDashboard,
  Receipt,
  Users,
  Trophy,
  CreditCard,
  Settings,
  ChartNoAxesCombined,
  ClipboardList,
  Tag,
} from "lucide-react";
import { cx } from "./shared";
import { StatusPill } from "./feedback";
export function Brand({ surface = "Attendant" }: { surface?: string }) {
  return (
    <span className="wr-brand">
      <Image src="/design-system/mark.svg" alt="" width={28} height={28} />
      <span className="wr-brand-name">
        Whales Rewards
        {surface && <span className="wr-brand-surface">{surface}</span>}
      </span>
    </span>
  );
}
export function AppHeader({
  title,
  context,
  connection = "online",
  secondary = false,
  action,
}: {
  title: string;
  context?: ReactNode;
  connection?: "online" | "offline";
  secondary?: boolean;
  action?: ReactNode;
}) {
  return (
    <header className="wr-header">
      <div className="wr-header-top">
        <Brand />
        {action ?? (
          <StatusPill tone={connection} small>
            {connection === "online" ? "Online" : "Offline"}
          </StatusPill>
        )}
      </div>
      <h1 className={cx("wr-page-title", secondary && "wr-md")}>{title}</h1>
      {context && <div className="wr-context">{context}</div>}
    </header>
  );
}
export type NavLabel = "Sale" | "Register" | "History" | "Uploads" | "Account";
export type NavItem = { label: NavLabel; href: string };
const navIcons = {
  Sale: Fuel,
  Register: UserRoundPlus,
  History,
  Uploads: CloudUpload,
  Account: UserRound,
};
export function BottomNav({
  items,
  active,
  pending = 0,
}: {
  items: readonly NavItem[];
  active: NavLabel;
  pending?: number;
}) {
  return (
    <nav className="wr-nav" aria-label="Main">
      {items.map((item) => {
        const Icon = navIcons[item.label];
        return (
          <a
            key={item.label}
            href={item.href}
            aria-current={active === item.label ? "page" : undefined}
          >
            <Icon aria-hidden="true" strokeWidth={1.75} />
            {item.label}
            {item.label === "Uploads" && pending > 0 && (
              <span
                className="wr-badge"
                aria-label={`${pending} pending uploads`}
              >
                {pending}
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
}
export type SidebarItem = { label: string; href: string; count?: number };
const sidebarIcons = [
  LayoutDashboard,
  Receipt,
  Users,
  Trophy,
  UserRound,
  CreditCard,
  Fuel,
  Tag,
  ChartNoAxesCombined,
  ClipboardList,
  Settings,
  Users,
];
export function Sidebar({
  items,
  active,
  station,
  footer,
}: {
  items: readonly SidebarItem[];
  active: string;
  station: string;
  footer?: ReactNode;
}) {
  return (
    <aside className="wr-sidebar">
      <Brand surface="Admin · Whales Energy" />
      <nav className="wr-navlist" aria-label="Admin">
        {items.map((item, index) => {
          const Icon = sidebarIcons[index] ?? Settings;
          return (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active === item.label ? "page" : undefined}
            >
              <Icon aria-hidden="true" strokeWidth={1.75} />
              {item.label}
              {!!item.count && (
                <span
                  className="wr-count"
                  aria-label={`${item.count} records need attention`}
                >
                  {item.count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="wr-sidebar-foot">
        <b>{station}</b>
        <span>Single-station launch</span>
        {footer}
      </div>
    </aside>
  );
}

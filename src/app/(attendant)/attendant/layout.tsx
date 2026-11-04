import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AttendantProvider } from "./_components/runtime";
export const metadata: Metadata = {
  manifest: "/attendant/manifest.webmanifest",
};
export default function AttendantLayout({ children }: { children: ReactNode }) {
  return <AttendantProvider>{children}</AttendantProvider>;
}

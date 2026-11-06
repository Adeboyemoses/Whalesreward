import { AdminPortal } from "@/ui/admin/portal";
export const metadata = {
  title: "Admin portal · Whales Rewards",
  referrer: "no-referrer" as const,
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path } = await params;
  return <AdminPortal key={(path ?? []).join("/")} path={path ?? []} />;
}

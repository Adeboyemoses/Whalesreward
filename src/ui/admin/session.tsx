"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { AdminSessionStore } from "@/client/admin-session";
const Context = createContext<AdminSessionStore | null>(null);
export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new AdminSessionStore());
  const path = usePathname();
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible" && store.getSnapshot().session)
        void store.refresh();
    };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [store]);
  useEffect(() => {
    store.finishTransition(path);
    if (
      ![
        "/admin/sign-in",
        "/admin/signed-out",
        "/admin/forgot-password",
        "/admin/forgot-password/sent",
        "/admin/reset-password",
        "/admin/verify-email",
      ].includes(path) &&
      !store.getSnapshot().checked
    )
      void store.refresh();
  }, [path, store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function useAdminSession() {
  const store = useContext(Context);
  if (!store) throw new Error("Admin session provider unavailable");
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return { store, ...state };
}

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  getAttendantClient,
  type ClientState,
  type Session,
  type OutboxRow,
} from "@/client/offline/client";
import { needsUpload } from "@/client/offline/sync-status";
import { registerAttendantWorker } from "@/client/sw/register";
import { connection, probeConnection } from "@/client/offline/connection";
import { AppHeader, BottomNav, Notice, Button } from "@/ui";
import type { NavLabel } from "@/ui/navigation";
import type { ConfiguredAssignment } from "@/client/types";

type Client = ReturnType<typeof getAttendantClient>;
type Runtime = {
  client: Client | null;
  state: ClientState | null;
  online: boolean;
  error: string | null;
  reassignmentRequiresSignIn: boolean;
};
const RuntimeContext = createContext<Runtime>({
  client: null,
  state: null,
  online: true,
  error: null,
  reassignmentRequiresSignIn: false,
});
type SaleHandoff = {
  accountId: string;
  contextId: string;
  cardCode: string;
  customerId: string;
};
type RegistrationHandoff = Omit<SaleHandoff, "customerId"> & {
  source: "code" | "qr";
};
const SaleHandoffContext = createContext<{
  offer: (value: SaleHandoff) => void;
  take: (session: Session) => SaleHandoff | null;
  offerRegistration: (value: RegistrationHandoff) => void;
  registrationCandidate: (session: Session) => RegistrationHandoff | null;
  clearRegistration: () => void;
}>({
  offer: () => {},
  take: () => null,
  offerRegistration: () => {},
  registrationCandidate: () => null,
  clearRegistration: () => {},
});
export function useSaleHandoff() {
  return useContext(SaleHandoffContext);
}
export function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
export function AttendantProvider({ children }: { children: ReactNode }) {
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const saleHandoff = useRef<SaleHandoff | null>(null);
  const registrationHandoff = useRef<RegistrationHandoff | null>(null);
  const [handoff] = useState(() => ({
    offer: (value: SaleHandoff) => {
      saleHandoff.current = value;
    },
    take: (session: Session) => {
      const value = saleHandoff.current;
      saleHandoff.current = null;
      return value?.accountId === session.account.id &&
        value.contextId === session.captureContextId
        ? value
        : null;
    },
    offerRegistration: (value: RegistrationHandoff) => {
      registrationHandoff.current = value;
    },
    registrationCandidate: (session: Session) => {
      const value = registrationHandoff.current;
      return value?.accountId === session.account.id &&
        value.contextId === session.captureContextId
        ? value
        : null;
    },
    clearRegistration: () => {
      registrationHandoff.current = null;
    },
  }));
  const [runtime, setRuntime] = useState<Runtime>({
    client: null,
    state: null,
    online: true,
    error: null,
    reassignmentRequiresSignIn: false,
  });
  useEffect(() => {
    const client = getAttendantClient();
    let active = true;
    let stopWorker = () => {};
    let initialized = false;
    let probing = false;
    let refreshingAssignment = false;
    let reassignmentContext: string | null = null;
    const assignmentChanged = (state: ClientState) => {
      const context = state.session
        ? `${state.session.account.id}:${state.session.captureContextId}`
        : null;
      if (!context || (reassignmentContext && reassignmentContext !== context))
        reassignmentContext = null;
      if (state.session?.reassignmentRequiresSignIn)
        reassignmentContext = context;
      return !!context && reassignmentContext === context;
    };
    const update = () => {
      const state = client.getState();
      const changed = assignmentChanged(state);
      if (
        state.access !== "active" ||
        saleHandoff.current?.accountId !== state.session?.account.id ||
        saleHandoff.current?.contextId !== state.session?.captureContextId
      )
        saleHandoff.current = null;
      if (
        state.access !== "active" ||
        registrationHandoff.current?.accountId !== state.session?.account.id ||
        registrationHandoff.current?.contextId !==
          state.session?.captureContextId
      )
        registrationHandoff.current = null;
      if (active)
        setRuntime((previous) => ({
          client: initialized ? client : previous.client,
          state: initialized ? client.getState() : previous.state,
          online: connection.isOnline(),
          error: null,
          reassignmentRequiresSignIn: changed,
        }));
    };
    const fail = (error: unknown) => {
      initialized = true;
      if (active)
        setRuntime({
          client,
          state: client.getState(),
          online: connection.isOnline(),
          error: message(error),
          reassignmentRequiresSignIn: assignmentChanged(client.getState()),
        });
    };
    const unsubscribe = client.subscribe(update);
    const unsubscribeConnection = connection.subscribe(update);
    connection.browserChanged();
    update();
    const stopSync = client.startForegroundSync();
    void (async () => {
      await client.initialize();
      // Publish only after the durable local window has been checked. The server
      // request remains live in the background and any denial still locks it.
      initialized = true;
      update();
      if (navigator.onLine) void client.refresh().then(update, fail);
      void registerAttendantWorker(setUpdateMessage)
        .then((stop) => {
          if (active) stopWorker = stop;
          else stop();
        })
        .catch(fail);
    })().catch(fail);
    const network = () => {
      connection.browserChanged();
      update();
      if (navigator.onLine) void client.refresh().then(update, fail);
      else void client.checkAccess().then(update, fail);
    };
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      void (async () => {
        await client.checkAccess();
        if (navigator.onLine) await client.refresh();
        update();
      })().catch(fail);
    };
    const timer = window.setInterval(() => {
      void client.checkAccess().then(update, fail);
      if (navigator.onLine && !connection.isOnline() && !probing) {
        probing = true;
        void probeConnection()
          .then(() => {
            if (active && connection.isOnline())
              void client.refresh().then(update, fail);
          })
          .finally(() => {
            probing = false;
          });
      }
    }, 1000);
    // Reuse the authority refresh while the phone stays on Sale. It keeps the
    // original capture context/anchor and never navigates or interrupts a save.
    const assignmentTimer = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        connection.isOnline() &&
        client.getState().access === "active" &&
        !refreshingAssignment
      ) {
        refreshingAssignment = true;
        void client
          .refresh()
          .then(update, fail)
          .finally(() => {
            refreshingAssignment = false;
          });
      }
    }, 30000);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    document.addEventListener("visibilitychange", resume);
    return () => {
      active = false;
      stopWorker();
      unsubscribe();
      unsubscribeConnection();
      stopSync();
      clearInterval(timer);
      clearInterval(assignmentTimer);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);
  return (
    <RuntimeContext.Provider value={runtime}>
      <SaleHandoffContext.Provider value={handoff}>
        {updateMessage && (
          <Notice role="status">
            {updateMessage}{" "}
            <Button
              onClick={() =>
                window.dispatchEvent(new Event("whr-request-update"))
              }
            >
              Reload when safe
            </Button>
            <p>
              Finish recording and upload pending sales first. Other open
              attendant tabs must also be idle.
            </p>
          </Notice>
        )}
        {children}
      </SaleHandoffContext.Provider>
    </RuntimeContext.Provider>
  );
}
export function go(
  router: { push: (href: string) => void; replace: (href: string) => void },
  href: string,
  replace = false,
) {
  const capturePath = /^\/attendant\/sale(?:\/[^/]+\/recorded)?\/?$/;
  const destination = new URL(href, window.location.href);
  if (
    destination.origin === window.location.origin &&
    capturePath.test(window.location.pathname) &&
    capturePath.test(destination.pathname)
  ) {
    // Both URLs render the same client capture shell. Next's native history
    // integration updates usePathname without waiting for an RSC request.
    if (replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
    return;
  }
  if (!navigator.onLine) {
    if (replace) window.location.replace(href);
    else window.location.assign(href);
  } else if (replace) router.replace(href);
  else router.push(href);
}
export function useAttendant() {
  return useContext(RuntimeContext);
}
export const productName: Record<string, string> = {
  pms: "PMS",
  diesel: "Diesel",
  kerosene: "Kerosene",
  cooking_gas: "Cooking gas",
};
export const categoryName: Record<string, string> = {
  car_owner: "Car owner",
  commercial_bus_driver: "Commercial bus driver",
  three_wheeler_user: "Three-wheeler user",
  bike_user: "Bike user",
  keg_buyer: "Keg buyer",
  cooking_gas_customer: "Cooking-gas customer",
};
export const mediumName: Record<string, string> = {
  vehicle: "Vehicle",
  keg: "Keg",
  three_wheeler: "Three-wheeler",
  bike: "Bike",
  cylinder: "Cylinder",
};
export function stationName(session: Session) {
  return session.station.name;
}
export function pumpName(code: string) {
  return /^pump\b/i.test(code) ? code : `Pump ${code}`;
}
export function Assignment({ session }: { session: Session }) {
  return (
    <>
      {stationName(session)} <span className="wr-dot">·</span>{" "}
      {pumpName(session.pump.code)} <span className="wr-dot">·</span>{" "}
      {productName[session.product.code]} <span className="wr-dot">·</span>{" "}
      <b>{session.account.name}</b> <span className="wr-dot">·</span>{" "}
      <span className="wr-mono wr-username">{session.account.username}</span>
    </>
  );
}
export function formatTime(instant: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(instant));
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === name)?.value ?? "";
  return `${part("day")} ${part("month")} ${part("year")} · ${part("hour")}:${part("minute")} ${part("dayPeriod").toUpperCase()}`;
}
export function Frame({
  title,
  context,
  children,
  action,
  active = "Sale",
  noNav = false,
  signIn = false,
  assignmentChanged = false,
  configuredAssignment,
}: {
  title: string;
  context?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  active?: NavLabel;
  noNav?: boolean;
  signIn?: boolean;
  assignmentChanged?: boolean;
  configuredAssignment?: ConfiguredAssignment["configured"];
}) {
  const { online, state, reassignmentRequiresSignIn } = useAttendant();
  const pending = useOwnCount();
  return (
    <div
      className={`wr-root wr-phone wr-attendant-shell wr-capture-shell${noNav ? " wr-without-nav" : ""}${signIn ? " wr-sign-in" : ""}`}
    >
      <AppHeader
        title={signIn ? "" : title}
        context={context}
        connection={online ? "online" : "offline"}
        secondary={!signIn && title !== "New sale"}
      />
      <main className="wr-screen">
        {!signIn &&
          state?.session &&
          (reassignmentRequiresSignIn || assignmentChanged) && (
            <Notice tone="warning">
              <b>
                {configuredAssignment
                  ? `New pump assigned: ${configuredAssignment.pump.name} · ${productName[configuredAssignment.product.code]}.`
                  : "Your pump assignment has changed."}
              </b>{" "}
              Sign out and sign in online with your own account before using the
              new pump. Pending sales keep their original details.
            </Notice>
          )}
        {children}
      </main>
      {action && <div className="wr-actionbar">{action}</div>}
      {!noNav && (
        <BottomNav
          items={[
            { label: "Sale", href: "/attendant/sale" },
            { label: "Register", href: "/attendant/register" },
            { label: "Uploads", href: "/attendant/uploads" },
            { label: "Account", href: "/attendant/account" },
          ]}
          active={active}
          pending={pending ?? 0}
        />
      )}
    </div>
  );
}
export function AccessGate({
  children,
  allowExpired = false,
}: {
  children: ReactNode;
  allowExpired?: boolean;
}) {
  const { client, state, error } = useAttendant();
  const router = useRouter();
  useEffect(() => {
    if (
      state?.access === "signed_out" ||
      state?.access === "password_change_required"
    )
      go(router, "/attendant/sign-in", true);
    else if (state?.access === "expired" && !allowExpired)
      go(router, "/attendant/access-expired", true);
  }, [state?.access, allowExpired, router]);
  if (
    !state?.session ||
    state.access === "signed_out" ||
    state.access === "password_change_required" ||
    (state.access === "expired" && !allowExpired)
  )
    return (
      <Frame title="Whales Rewards" noNav>
        <Notice role="status">{error ?? "Checking access…"}</Notice>
        {error && (
          <Button onClick={() => void client?.refresh()}>Try again</Button>
        )}
      </Frame>
    );
  return (
    <div key={`${state.session.account.id}:${state.session.captureContextId}`}>
      {children}
    </div>
  );
}
export function useOwnSales() {
  const { client, state } = useAttendant();
  const accountId = state?.session?.account.id;
  const contextId = state?.session?.captureContextId;
  const access = state?.access;
  const [result, setResult] = useState<{
    accountId?: string;
    rows: OutboxRow[] | null;
    error: string | null;
  }>({ rows: null, error: null });
  useEffect(() => {
    let live = true;
    let request = 0;
    if (!client || !accountId || access === "signed_out") return;
    const read = () => {
      const current = ++request;
      void client.ownSales().then(
        (rows) => {
          if (
            live &&
            current === request &&
            client.getState().session?.account.id === accountId
          )
            setResult({ accountId, rows, error: null });
        },
        (error) => {
          if (live && current === request)
            setResult({ accountId, rows: null, error: message(error) });
        },
      );
    };
    const unsubscribe = client.subscribeSales(read);
    read();
    return () => {
      live = false;
      unsubscribe();
    };
  }, [client, accountId, contextId, access]);
  if (!accountId || access === "signed_out" || result.accountId !== accountId)
    return { rows: null, error: null };
  return { rows: result.rows, error: result.error };
}
export function useOwnCount() {
  const { rows } = useOwnSales();
  return rows ? rows.filter(needsUpload).length : null;
}
export function WindowNotice() {
  return (
    <Notice tone="warning">
      Offline recording lasts <b>24 hours</b> after an online sign-in. Reopening
      the app does not extend it.
    </Notice>
  );
}

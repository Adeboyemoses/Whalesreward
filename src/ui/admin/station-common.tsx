"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { z } from "zod";
import { Button, Notice, KeyValueList } from "@/ui";
import { useAdminSession } from "./session";
import {
  StationApi,
  type FrozenChange,
  stationMessage,
  priceDisplay,
} from "@/client/station-api";
import { AdminError } from "@/client/admin-api";
import type {
  Product,
  PriceEvent,
  AssignmentEvent,
} from "@/client/station-types";
import { adminTime } from "@/client/admin-display";
export const productNames: Record<Product["code"], string> = {
  pms: "PMS",
  diesel: "Diesel",
  kerosene: "Kerosene",
  cooking_gas: "Cooking gas",
};
export const rate = (price: { rateKobo: string } | null, unit: string) =>
  price ? `${priceDisplay(price.rateKobo)} / ${unit}` : "Not configured";
export const unitPlural = (unit: string) =>
  unit === "kilogram" ? "kilograms" : "litres";
export function PageHead({
  title,
  eyebrow,
  subtitle,
  back,
  action,
}: {
  title: string;
  eyebrow: string;
  subtitle?: ReactNode;
  back?: { href: string; label: string };
  action?: ReactNode;
}) {
  return (
    <div className="wr-pagehead">
      <div>
        <div className="wr-eyebrow">{eyebrow}</div>
        <h1 className="wr-page-title">{title}</h1>
        {subtitle && <p className="wr-secondary">{subtitle}</p>}
      </div>
      {action ??
        (back && (
          <Link className="wr-btn wr-btn-secondary" href={back.href}>
            {back.label}
          </Link>
        ))}
    </div>
  );
}
export function Sheet({
  title,
  children,
  quiet = false,
  badge,
}: {
  title: string;
  children: ReactNode;
  quiet?: boolean;
  badge?: ReactNode;
}) {
  return (
    <section className={quiet ? "wr-sheet wr-station-quiet" : "wr-sheet"}>
      <h2>
        {title}
        {badge}
      </h2>
      {children}
    </section>
  );
}
export function SelectField({
  label,
  value,
  onChange,
  children,
  disabled = false,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  required?: boolean;
}) {
  const id = "station-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <div className="wr-field">
      <label className="wr-label" htmlFor={id}>
        {label}
      </label>
      <div className="wr-select-wrap">
        <select
          className="wr-input wr-select"
          id={id}
          value={value}
          required={required}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {children}
        </select>
      </div>
    </div>
  );
}
export function Reason({
  value,
  onChange,
  label = "Reason for change",
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const id = "station-reason";
  return (
    <div className="wr-field">
      <label className="wr-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="wr-input wr-station-reason"
        rows={3}
        value={value}
        maxLength={1000}
        required
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="wr-help">
        Required. Recorded in the history with your name.
      </p>
    </div>
  );
}
export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <Notice tone="danger" role="alert">
      {error}
    </Notice>
  ) : null;
}
export function useStationApi() {
  const { store } = useAdminSession();
  return useMemo(() => new StationApi(store.request), [store]);
}
function useLoad<T>(key: string, load: () => Promise<T>, enabled: boolean) {
  const { store } = useAdminSession();
  const [data, setData] = useState<T | null>(
    () => (store.lists.get("station:data:" + key) as T | undefined) ?? null,
  );
  const [loading, setLoading] = useState(enabled),
    [error, setError] = useState("");
  const [serial, setSerial] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const perform = async () => {
      setLoading(true);
      setError("");
      try {
        const value = await load();
        if (!alive) return;
        store.lists.set("station:data:" + key, value);
        setData(value);
      } catch (e) {
        if (alive) setError(stationMessage(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void perform();
    return () => {
      alive = false;
    };
  }, [key, load, enabled, store, serial]);
  return {
    data,
    loading,
    error,
    reload: (clear = false) => {
      if (clear) setData(null);
      setSerial((x) => x + 1);
    },
  };
}
export function useRead<T>(path: string, schema: z.ZodType<T>, enabled = true) {
  const api = useStationApi();
  const load = useCallback(() => api.read(path, schema), [api, path, schema]);
  return useLoad("read:" + path, load, enabled);
}
export function useAll<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: Record<string, unknown>,
  enabled = true,
) {
  const api = useStationApi();
  const bodyKey = body === undefined ? "" : JSON.stringify(body);
  const load = useCallback(
    () =>
      api.all(
        path,
        schema,
        bodyKey ? (JSON.parse(bodyKey) as Record<string, unknown>) : undefined,
      ),
    [api, path, schema, bodyKey],
  );
  return useLoad("all:" + path + ":" + bodyKey, load, enabled);
}
export function useViewGuard() {
  const { store } = useAdminSession();
  const pathname = usePathname();
  const alive = useRef(false);
  const generation = useRef(0);
  useLayoutEffect(() => {
    generation.current++;
  }, [pathname]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return () => {
    const epoch = store.getSnapshot().epoch,
      version = generation.current,
      path = pathname;
    return () =>
      alive.current &&
      epoch === store.getSnapshot().epoch &&
      version === generation.current &&
      window.location.pathname === path;
  };
}
export function useMutation<T>(
  schema: z.ZodType<T>,
  onSuccess: (result: T) => void,
) {
  const api = useStationApi(),
    capture = useViewGuard();
  const inflight = useRef<{ token: symbol; path: string } | null>(null);
  const pathname = usePathname();
  const [pending, setPending] = useState<{
    token: symbol;
    path: string;
  } | null>(null);
  const busy = pending?.path === pathname;
  const [error, setError] = useState(""),
    [uncertain, setUncertain] = useState(false),
    [blocked, setBlocked] = useState(false);
  async function submit(change: FrozenChange<object>) {
    if (inflight.current?.path === pathname) return "busy";
    const current = capture();
    const token = Symbol();
    const pendingRequest = { token, path: pathname };
    inflight.current = pendingRequest;
    setPending(pendingRequest);
    setError("");
    try {
      const value = await api.commit(change, schema);
      if (current()) {
        setUncertain(false);
        setBlocked(false);
        onSuccess(value);
        return "applied";
      }
      return "obsolete";
    } catch (e) {
      if (!current()) return "obsolete";
      setError(stationMessage(e));
      const unknown =
        e instanceof AdminError && (e.status === 0 || e.status >= 500);
      setUncertain(unknown);
      setBlocked(!unknown);
      return unknown ? "uncertain" : "rejected";
    } finally {
      if (inflight.current?.token === token) {
        inflight.current = null;
        setPending(null);
      }
    }
  }
  return {
    submit,
    busy,
    error,
    uncertain,
    blocked,
    reset: () => {
      setError("");
      setUncertain(false);
      setBlocked(false);
    },
  };
}
export function MutationState({
  state,
  reload,
  retry,
}: {
  state: { error: string; uncertain: boolean; blocked: boolean; busy: boolean };
  reload?: () => void;
  retry?: () => void;
}) {
  return (
    <>
      <ErrorNotice error={state.error} />
      {state.uncertain && (
        <Notice tone="warning">
          The result is uncertain. Retry the same confirmation to retrieve its
          original result. Do not start another change.
        </Notice>
      )}
      {state.uncertain && retry && (
        <Button variant="secondary" loading={state.busy} onClick={retry}>
          Retry same confirmation
        </Button>
      )}
      {state.blocked && reload && (
        <Button variant="secondary" onClick={reload}>
          Reload and review current record
        </Button>
      )}
    </>
  );
}
export function useReceipt() {
  const { store } = useAdminSession();
  return {
    get: <T,>(path: string) =>
      store.lists.get("station:receipt:" + path) as T | undefined,
    save: (
      path: string,
      value: unknown,
      seed?: { path: string; value: unknown },
    ) => {
      for (const key of store.lists.keys())
        if (key.startsWith("station:data:")) store.lists.delete(key);
      store.lists.set("station:receipt:" + path, value);
      if (seed) store.lists.set("station:data:read:" + seed.path, seed.value);
    },
  };
}
export function PriceHistory({
  items,
  error,
  loading,
}: {
  items: PriceEvent[] | null;
  error: string;
  loading: boolean;
}) {
  return (
    <Sheet title="Price history">
      <ErrorNotice error={error} />
      {loading && <p role="status">Refreshing price history…</p>}
      {items?.length === 0 && (
        <p className="wr-secondary">No price changes recorded yet.</p>
      )}
      <div className="wr-list">
        {items?.map((x) => (
          <div className="wr-list-row" key={x.id}>
            <b>
              Version {x.version} · {adminTime(x.current.effectiveFrom)}
            </b>
            <p>
              {rate(x.previous, x.product.unit)} to{" "}
              {rate(x.current, x.product.unit)} · Quantity decimal places{" "}
              {x.current.quantityPrecision}
            </p>
            <p className="wr-secondary">
              {x.actor.name} · <span className="wr-mono">{x.actor.code}</span> ·
              Reason: {x.reason}
            </p>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
export function AssignmentHistory({
  items,
  error,
  loading,
  pumpNames,
}: {
  items: AssignmentEvent[] | null;
  error: string;
  loading: boolean;
  pumpNames: Map<string, string>;
}) {
  return (
    <Sheet title="Assignment history">
      <ErrorNotice error={error} />
      {loading && <p role="status">Refreshing assignment history…</p>}
      {items?.length === 0 && (
        <p className="wr-secondary">No assignment changes yet.</p>
      )}
      <div className="wr-list">
        {items?.map((x) => (
          <div className="wr-list-row" key={x.id}>
            <b>{adminTime(x.effectiveFrom)}</b>
            <p>
              {x.fromPumpId
                ? (pumpNames.get(x.fromPumpId) ?? x.fromPumpId)
                : "Unassigned"}{" "}
              to {pumpNames.get(x.toPumpId) ?? x.toPumpId}
            </p>
            <p className="wr-secondary">
              {x.actor.name} · Reason: {x.reason}
            </p>
            {x.effectiveUntil && (
              <p className="wr-help">
                Interval ended {adminTime(x.effectiveUntil)}. The actor and
                reason above describe its opening.
              </p>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
export function Attribution() {
  return (
    <Sheet title="Sale attribution">
      <p className="wr-secondary">
        Each purchase retains the originating attendant’s name, username,
        permanent ID, station and pump. A later account or assignment change
        does not rewrite previous sales.
      </p>
    </Sheet>
  );
}
export function AssignmentRule() {
  return (
    <Sheet title="Keep personal attribution" quiet>
      <p>
        The attendant keeps their username and permanent ID. Existing sales
        retain the pump and identity recorded at capture.
      </p>
      <p className="wr-secondary">
        After an authorized assignment change, the attendant must sign out and
        sign in online with their own account before using the new pump. Earlier
        sales and queued uploads keep their original pump and identity.
      </p>
    </Sheet>
  );
}
export function Loading({
  error,
  loading,
  label,
  reload,
}: {
  error: string;
  loading: boolean;
  label: string;
  reload: () => void;
}) {
  return (
    <>
      <ErrorNotice error={error} />
      {loading && <p role="status">{label}</p>}
      {!loading && error && (
        <Button variant="secondary" onClick={reload}>
          Retry loading
        </Button>
      )}
    </>
  );
}
export { KeyValueList };

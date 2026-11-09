"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { z } from "zod";
import { useAdminSession } from "./session";
import {
  CustomerAdminApi,
  customerMessage,
  pageOf,
  pageQuery,
} from "@/client/customer-admin-api";
import { Button, Notice } from "@/ui";
export {
  PageHead,
  Sheet,
  SelectField,
  Reason,
  ErrorNotice,
  Loading,
  productNames,
} from "./station-common";
export function useCustomerApi() {
  const { store } = useAdminSession();
  return useMemo(() => new CustomerAdminApi(store.request), [store]);
}
export function useMemory<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const { store } = useAdminSession();
  const [value, update] = useState<T>(
    () => (store.lists.get("customers:" + key) as T | undefined) ?? initial,
  );
  const latest = useRef(value);
  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      const v =
        typeof next === "function"
          ? (next as (x: T) => T)(latest.current)
          : next;
      latest.current = v;
      store.lists.set("customers:" + key, v);
      update(v);
    },
    [key, store],
  );
  return [value, set];
}
/** One bounded page at a time; immutable filter key binds every cursor. */
export function useCustomerPage<T>(
  path: string,
  schema: z.ZodType<T>,
  filters: Record<string, string | undefined> = {},
  post = false,
  enabled = true,
) {
  const api = useCustomerApi();
  const { store } = useAdminSession();
  const filterKey = JSON.stringify(filters),
    key = path + ":" + filterKey;
  const [cursor, setCursor] = useMemory<string | undefined>(
    key + ":cursor",
    undefined,
  );
  const [previous, setPrevious] = useMemory<(string | undefined)[]>(
    key + ":previous",
    [],
  );
  type Page = { items: T[]; nextCursor: string | null };
  const [loaded, setLoaded] = useState<{
    cursor: string | undefined;
    value: Page | null;
  }>(() => ({
    cursor,
    value:
      (store.lists.get("customers:page:" + key + ":" + (cursor ?? "")) as
        Page | undefined) ?? null,
  }));
  const data = loaded.cursor === cursor ? loaded.value : null;
  const [loading, setLoading] = useState(enabled),
    [error, setError] = useState(""),
    [serial, setSerial] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const values = JSON.parse(filterKey) as Record<string, string>;
    const cached = store.lists.get(
      "customers:page:" + key + ":" + (cursor ?? ""),
    ) as Page | undefined;
    const perform = async () => {
      setLoaded({ cursor, value: cached ?? null });
      setLoading(true);
      setError("");
      await api
        .read(
          post ? path : pageQuery(path, { ...values, cursor }),
          pageOf(schema),
          post
            ? { ...values, ...(cursor ? { cursor } : {}), limit: 25 }
            : undefined,
        )
        .then(
          (value) => {
            if (alive) {
              store.lists.set(
                "customers:page:" + key + ":" + (cursor ?? ""),
                value,
              );
              setLoaded({ cursor, value });
            }
          },
          (e) => {
            if (alive) setError(customerMessage(e));
          },
        )
        .finally(() => {
          if (alive) setLoading(false);
        });
    };
    void perform();
    return () => {
      alive = false;
    };
    // data is output only; schema references are module constants.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, path, schema, filterKey, cursor, enabled, store, serial, key]);
  return {
    data,
    loading: loading || loaded.cursor !== cursor,
    error,
    reload: () => setSerial((s) => s + 1),
    next: () => {
      if (data?.nextCursor) {
        setPrevious((p) => [...p, cursor]);
        setCursor(data.nextCursor);
      }
    },
    back: () => {
      if (previous.length) {
        setCursor(previous.at(-1));
        setPrevious((p) => p.slice(0, -1));
      }
    },
    hasBack: previous.length > 0,
  };
}
export function PageControls({
  page,
}: {
  page: {
    data: { nextCursor: string | null } | null;
    loading: boolean;
    next: () => void;
    back: () => void;
    hasBack: boolean;
  };
}) {
  return (
    <div className="wr-row">
      <Button
        variant="secondary"
        disabled={!page.hasBack || page.loading}
        onClick={page.back}
      >
        Previous
      </Button>
      <span className="wr-help">Current page · server order</span>
      <Button
        variant="secondary"
        disabled={!page.data?.nextCursor || page.loading}
        onClick={page.next}
      >
        Next
      </Button>
    </div>
  );
}
export function PageState({
  page,
  empty,
}: {
  page: {
    data: { items: unknown[] } | null;
    loading: boolean;
    error: string;
    reload: () => void;
  };
  empty: string;
}) {
  return (
    <>
      {page.error && (
        <Notice tone="danger" role="alert">
          {page.error}
        </Notice>
      )}
      {page.loading && <p role="status">Loading…</p>}
      {!page.loading && page.error && (
        <Button variant="secondary" onClick={page.reload}>
          Retry loading
        </Button>
      )}
      {!page.loading && page.data?.items.length === 0 && (
        <p role="status">{empty}</p>
      )}
    </>
  );
}

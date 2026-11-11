"use client";
/* eslint-disable react-hooks/set-state-in-effect -- External account-scoped API lifecycle resets are fenced by identity and abort on cleanup. */
import { useEffect, useState } from "react";
import {
  HttpAttendantSalesApi,
  type AttendantSaleDetail,
} from "@/client/sales-api";
import type { CorrectionOutboxRow } from "@/client/offline/correction-types";
import { useAttendant, useOwnSales, message } from "../_components/runtime";
import { correctionReceiptKey, ownsAttendantSale } from "./history-model";
export const salesApi = new HttpAttendantSalesApi();
// One transient viewed record supports an offline edit while navigating; never persisted.
let viewed: { identity: string; detail: AttendantSaleDetail } | null = null;
export function useCorrections() {
  const { client, state } = useAttendant();
  const accountId = state?.session?.account.id;
  const contextId = state?.session?.captureContextId;
  const access = state?.access;
  const identity = `${accountId}:${contextId}`;
  const [result, setResult] = useState<{
    identity: string;
    rows: CorrectionOutboxRow[];
    error: string | null;
  }>({ identity: "", rows: [], error: null });
  useEffect(() => {
    let live = true,
      serial = 0;
    if (!client || !accountId || !contextId || access === "signed_out") return;
    const current = () =>
      live &&
      client.getState().session?.account.id === accountId &&
      client.getState().session?.captureContextId === contextId;
    const read = () => {
      const n = ++serial;
      void client.ownCorrections().then(
        (rows) => {
          if (current() && n === serial)
            setResult({ identity, rows, error: null });
        },
        (error) => {
          if (current() && n === serial)
            setResult((previous) => ({
              identity,
              rows: previous.identity === identity ? previous.rows : [],
              error: message(error),
            }));
        },
      );
    };
    const stop = client.subscribeSales(read);
    read();
    return () => {
      live = false;
      stop();
    };
  }, [client, accountId, contextId, identity, access]);
  return result.identity === identity && access !== "signed_out"
    ? { rows: result.rows, error: result.error }
    : { rows: [], error: null };
}
export function useSale(saleId: string, refresh: number) {
  const { client, state, online } = useAttendant();
  const { rows, error: localError } = useOwnSales();
  const { rows: corrections, error: correctionLoadError } = useCorrections();
  const account = state?.session?.account.id;
  const identity = `${account}:${state?.session?.captureContextId}`;
  const local = rows?.find(
    (r) => r.operationId === saleId || r.purchaseId === saleId,
  );
  const purchaseId = local?.purchaseId ?? saleId;
  const pendingLocal = !!local && !local.purchaseId;
  const receipt = correctionReceiptKey(
    corrections.filter(
      (c) =>
        c.purchaseId === purchaseId ||
        c.originalOperationId === local?.operationId,
    ),
  );
  const [result, setResult] = useState<{
    identity: string;
    id: string;
    detail: AttendantSaleDetail | null;
    error: string | null;
    loading: boolean;
  }>({ identity: "", id: "", detail: null, error: null, loading: true });
  const rowsReady = rows !== null;
  useEffect(() => {
    if (viewed?.identity !== identity) viewed = null;
    const cached = viewed?.detail.id === purchaseId ? viewed.detail : null;
    if (!client || !account || !rowsReady) return;
    if (pendingLocal) {
      setResult({
        identity,
        id: purchaseId,
        detail: null,
        error: null,
        loading: false,
      });
      return;
    }
    if (!online) {
      setResult((previous) => ({
        identity,
        id: purchaseId,
        detail:
          previous.identity === identity && previous.id === purchaseId
            ? previous.detail
            : cached,
        error: cached
          ? null
          : "Offline · server history is unavailable. Only this account's saved originals can be viewed on this phone.",
        loading: false,
      }));
      return;
    }
    let live = true;
    const controller = new AbortController();
    setResult((previous) => ({
      identity,
      id: purchaseId,
      detail:
        previous.identity === identity && previous.id === purchaseId
          ? previous.detail
          : cached,
      error: null,
      loading: true,
    }));
    void salesApi.detail(purchaseId, controller.signal).then(
      (detail) => {
        if (
          !live ||
          client.getState().session?.account.id !== account ||
          client.getState().session?.captureContextId !==
            state?.session?.captureContextId
        )
          return;
        if (!ownsAttendantSale(account, detail)) {
          setResult({
            identity,
            id: purchaseId,
            detail: null,
            error: "This sale is unavailable.",
            loading: false,
          });
          return;
        }
        viewed = { identity, detail };
        setResult({
          identity,
          id: purchaseId,
          detail,
          error: null,
          loading: false,
        });
      },
      async (error) => {
        if (!live) return;
        await client.observeAuthorityError(error, state!.session!);
        if (live && client.getState().session?.account.id === account)
          setResult((previous) => ({
            identity,
            id: purchaseId,
            detail:
              previous.identity === identity && previous.id === purchaseId
                ? previous.detail
                : cached,
            error: message(error),
            loading: false,
          }));
      },
    );
    return () => {
      live = false;
      controller.abort();
    };
    // Security changes are represented by identity; avoid restarting on cloned session/outbox objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    client,
    account,
    identity,
    purchaseId,
    pendingLocal,
    rowsReady,
    online,
    refresh,
    receipt,
  ]);
  const visible = result.identity === identity && result.id === purchaseId;
  return {
    detail: visible ? result.detail : null,
    local,
    corrections: corrections.filter(
      (c) =>
        c.purchaseId === purchaseId ||
        c.originalOperationId ===
          (local?.operationId ?? result.detail?.operationId),
    ),
    error: visible
      ? (result.error ?? localError ?? correctionLoadError)
      : (localError ?? correctionLoadError),
    loading: !visible || result.loading,
    identity,
  };
}

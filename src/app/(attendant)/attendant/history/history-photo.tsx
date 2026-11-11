"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Notice } from "@/ui";
import type { OutboxRow } from "@/client/types";
import type { AttendantSaleDetail } from "@/client/sales-api";
import { useAttendant, message } from "../_components/runtime";
import { salesApi } from "./history-hooks";
export function HistoryPhoto({
  detail,
  local,
  onAvailable,
}: {
  detail: AttendantSaleDetail | null;
  local?: OutboxRow;
  onAvailable?: (ready: boolean) => void;
}) {
  const { client, state, online } = useAttendant();
  const [photo, setPhoto] = useState<{
    key: string;
    url: string;
    error: string;
  }>({ key: "", url: "", error: "" });
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const key = `${state?.session?.account.id}:${state?.session?.captureContextId}:${detail?.id ?? local?.operationId}:${detail?.evidence.state ?? "local"}:${detail?.evidence.assetId ?? ""}`;
  const retained = useRef<{ key: string; blob: Blob } | null>(null);
  useEffect(() => {
    let live = true,
      url = "";
    const controller = new AbortController();
    const photoDialog = dialog.current;
    const show = (blob: Blob) => {
      if (!live) return;
      retained.current = { key, blob };
      url = URL.createObjectURL(blob);
      setPhoto({ key, url, error: "" });
      onAvailable?.(true);
    };
    // Resolve private bytes asynchronously and fence every continuation to this view.
    void Promise.resolve().then(async () => {
      if (!live) return;
      onAvailable?.(false);
      if (retained.current?.key !== key) retained.current = null;
      if (detail) {
        if (detail.evidence.state !== "validated") {
          setPhoto({
            key,
            url: "",
            error:
              detail.evidence.state === "deleted"
                ? "The meter photo is no longer available."
                : detail.evidence.state === "pending"
                  ? "The meter photo is still uploading or being checked."
                  : "The meter photo is unavailable.",
          });
        } else if (!online) {
          if (retained.current?.key === key) show(retained.current.blob);
          else
            setPhoto({
              key,
              url: "",
              error: "Offline · reconnect to inspect the server meter photo.",
            });
        } else
          try {
            show(await salesApi.photo(detail.id, controller.signal));
          } catch (error) {
            if (!live) return;
            if (state?.session)
              await client?.observeAuthorityError(error, state.session);
            if (live) setPhoto({ key, url: "", error: message(error) });
          }
      } else if (local) show(local.photoBlob);
    });
    return () => {
      live = false;
      controller.abort();
      if (url) URL.revokeObjectURL(url);
      photoDialog?.close();
    };
    // The identity/evidence key controls authority; object clones must not refetch private bytes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, online, retry, client]);
  const current = photo.key === key ? photo : null;
  return (
    <section className="wr-section">
      <h2 className="wr-section-title">Meter photo evidence</h2>
      {current?.url ? (
        <>
          <div className="wr-photo wr-taken wr-history-photo">
            {/* Private image bytes stay in this document; do not use an image optimizer/cache. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt="Retained meter photo"
              referrerPolicy="no-referrer"
            />
            <div className="wr-photo-bar">
              <span>
                {detail ? "Validated meter photo" : "Saved on this phone"}
              </span>
              <button
                type="button"
                className="wr-btn-link"
                onClick={() => dialog.current?.showModal()}
              >
                View full size
              </button>
            </div>
          </div>
          <dialog ref={dialog} className="wr-history-photo-dialog">
            <Button onClick={() => dialog.current?.close()}>Close photo</Button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt="Full size retained meter photo"
              referrerPolicy="no-referrer"
            />
          </dialog>
        </>
      ) : (
        <Notice role="status">
          {current?.error ?? "Loading meter photo…"}
        </Notice>
      )}
      {current?.error && online && detail?.evidence.state === "validated" && (
        <Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>
          Retry photo
        </Button>
      )}
    </section>
  );
}

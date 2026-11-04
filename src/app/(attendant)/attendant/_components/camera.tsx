"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Notice } from "@/ui";
import {
  openCamera,
  capturePhoto,
  scanQr,
  stopCamera,
} from "@/client/offline/camera";
import type { CapturedPhoto } from "@/client/offline/client";
import { message, useAttendant } from "./runtime";
export function Camera({
  mode,
  onPhoto,
  onCode,
  onClose,
}: {
  mode: "photo" | "qr";
  onPhoto: (photo: CapturedPhoto) => void;
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const { client } = useAttendant();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    dialog.current?.showModal();
    void (async () => {
      await client?.checkAccess();
      if (client?.getState().access !== "active")
        throw new Error(
          "Reconnect and sign in with the same account to continue.",
        );
      const camera = await openCamera();
      if (!live) {
        stopCamera(camera);
        return;
      }
      stream.current = camera;
      if (video.current) {
        video.current.srcObject = camera;
        await video.current.play();
      }
      if (live) setReady(true);
    })().catch((e) => {
      if (live)
        setError(
          `${message(e)} Allow camera access in your browser settings, then try again.`,
        );
    });
    return () => {
      live = false;
      if (stream.current) stopCamera(stream.current);
      stream.current = null;
    };
  }, [client, attempt]);
  async function capture() {
    if (!video.current || busy || !client) return;
    setBusy(true);
    setError(null);
    try {
      await client.checkAccess();
      if (client.getState().access !== "active")
        throw new Error(
          "Reconnect and sign in with the same account to continue.",
        );
      if (mode === "photo") {
        const photo = await capturePhoto(video.current);
        onPhoto(photo);
        onClose();
      } else {
        const code = await scanQr(video.current);
        if (code) {
          onCode(code);
          onClose();
        } else
          setError(
            "No QR card found. Hold the card steady and try again, or enter the printed card number.",
          );
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="wr-camera-dialog"
      aria-labelledby="camera-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="camera-title" className="wr-section-title">
        {mode === "photo" ? "Meter photo" : "Scan QR card"}
      </h2>
      <p>
        {mode === "photo"
          ? "Show amount and quantity clearly."
          : "Place the printed QR card in view."}
      </p>
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        aria-label="Live camera preview"
      />
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {!ready && !error && <p role="status">Opening camera…</p>}
      {error && !ready && (
        <Button
          variant="secondary"
          onClick={() => {
            setError(null);
            setAttempt(attempt + 1);
          }}
        >
          Try camera again
        </Button>
      )}
      <Button
        cta
        onClick={() => void capture()}
        disabled={!ready}
        loading={busy}
      >
        {mode === "photo" ? "Take photo" : "Read QR card"}
      </Button>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
    </dialog>
  );
}

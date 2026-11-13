"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Notice } from "@/ui";
import { cardDetector, cardQrValue } from "@/client/customer-card-scanner";
import { useViewGuard } from "./station-common";
/** Ephemeral live preview only: no photo, gallery, recording, upload or storage. */
export function CustomerCardScanner({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    video = useRef<HTMLVideoElement>(null);
  const capture = useViewGuard();
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    dialog.current?.showModal();
    const stop = () => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };
    const start = async () => {
      if (!cardDetector()) {
        setError(
          "QR scanning is unavailable in this browser. Enter the printed code.",
        );
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Camera access is unavailable. Enter the printed code.");
        return;
      }
      try {
        const camera = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        if (!active) {
          camera.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = camera;
        if (video.current) {
          video.current.srcObject = camera;
          await video.current.play();
        }
        if (active) setReady(true);
      } catch {
        stop();
        if (active)
          setError(
            "Camera access was not available. Allow camera access or enter the printed code.",
          );
      }
    };
    void start();
    return () => {
      active = false;
      stop();
    };
  }, []);
  async function scan() {
    if (!video.current || busy) return;
    const live = capture();
    setBusy(true);
    setError("");
    try {
      const detector = cardDetector();
      if (!detector) throw new Error();
      const results = await detector.detect(video.current);
      if (!live()) return;
      const value = results[0] ? cardQrValue(results[0].rawValue) : null;
      if (!value) {
        setError(
          "No valid loyalty card found. Hold the card steady and try again, or enter the printed code.",
        );
        return;
      }
      onCode(value);
      onClose();
    } catch {
      if (live())
        setError(
          "The QR could not be read. Try again or enter the printed code.",
        );
    } finally {
      if (live()) setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="wr-camera-dialog"
      aria-labelledby="replacement-scan-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id="replacement-scan-title">Scan replacement card</h2>
      <p>Place the printed QR card in view.</p>
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        aria-label="Live card camera preview"
      />
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      {!ready && !error && <p role="status">Opening camera…</p>}
      <Button disabled={!ready} loading={busy} onClick={scan}>
        Read QR card
      </Button>
      <Button variant="secondary" onClick={onClose}>
        Enter printed code
      </Button>
    </dialog>
  );
}

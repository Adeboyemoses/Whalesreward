"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import {
  Camera,
  Check,
  Clock,
  Info,
  AlertTriangle,
  WifiOff,
} from "lucide-react";
import { cx, type Tone } from "./shared";
import { Button } from "./controls";
export function StatusPill({
  children,
  tone = "neutral",
  small = false,
  plain = false,
}: {
  children: ReactNode;
  tone?: Tone;
  small?: boolean;
  plain?: boolean;
}) {
  return (
    <span
      className={cx(
        "wr-pill",
        tone !== "neutral" && `wr-${tone}`,
        small && "wr-sm",
        plain && "wr-plain",
      )}
    >
      {children}
    </span>
  );
}
export function Notice({
  children,
  tone = "info",
  role,
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "success" | "danger" | "inverse";
  role?: "status" | "alert";
}) {
  const Icon =
    tone === "success"
      ? Check
      : tone === "inverse"
        ? WifiOff
        : tone === "warning" || tone === "danger"
          ? AlertTriangle
          : Info;
  return (
    <div
      className={cx("wr-notice", tone !== "info" && `wr-${tone}`)}
      role={role}
    >
      <Icon aria-hidden="true" strokeWidth={1.75} />
      <div>{children}</div>
    </div>
  );
}
export function PhotoCapture({
  src,
  alt,
  takenAt,
  onCapture,
  disabled = false,
  error,
}: {
  src?: string;
  alt?: string;
  takenAt?: string;
  onCapture: () => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className="wr-section">
      {src ? (
        <div className="wr-photo wr-taken">
          <Image
            unoptimized
            className="wr-photo-image"
            src={src}
            width={640}
            height={320}
            alt={alt ?? "Meter reading"}
          />
          <div className="wr-photo-bar">
            <span>
              <Check aria-hidden="true" strokeWidth={1.75} />
              Taken {takenAt}
            </span>
            <Button variant="link" onClick={onCapture} disabled={disabled}>
              Retake
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="wr-photo"
          onClick={onCapture}
          disabled={disabled}
        >
          <Camera aria-hidden="true" strokeWidth={1.75} />
          Take meter photo<small>Show amount and quantity clearly</small>
        </button>
      )}
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
    </div>
  );
}
export function ResultBlock({
  title,
  children,
  tone = "synced",
}: {
  title: string;
  children: ReactNode;
  tone?: "synced" | "pending" | "held" | "failed";
}) {
  const Icon =
    tone === "synced" ? Check : tone === "failed" ? AlertTriangle : Clock;
  return (
    <div className="wr-result">
      <div className={cx("wr-result-icon", tone !== "synced" && `wr-${tone}`)}>
        <Icon aria-hidden="true" strokeWidth={1.75} />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

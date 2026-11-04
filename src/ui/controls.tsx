"use client";

import {
  useId,
  type ReactNode,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
} from "react";
import { cx } from "./shared";
export function Button({
  variant = "primary",
  cta = false,
  small = false,
  loading = false,
  icon,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "link";
  cta?: boolean;
  small?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      disabled={props.disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        variant !== "link" && "wr-btn",
        `wr-btn-${variant}`,
        cta && "wr-btn-cta",
        small && "wr-btn-sm",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
export function TextField({
  id: providedId,
  label,
  hint,
  helper,
  error,
  prefix,
  action,
  mono = false,
  large = false,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: ReactNode;
  hint?: ReactNode;
  helper?: ReactNode;
  error?: string;
  prefix?: ReactNode;
  action?: ReactNode;
  mono?: boolean;
  large?: boolean;
}) {
  const generated = useId();
  const id = providedId ?? generated;
  const description = error ? `${id}-error` : helper ? `${id}-help` : undefined;
  return (
    <div className="wr-field">
      <label className="wr-label" htmlFor={id}>
        {label}
        {hint && <span className="wr-hint">{hint}</span>}
      </label>
      <div className="wr-row">
        {prefix && (
          <span
            className={cx("wr-prefix", large && "wr-prefix-large")}
            aria-hidden="true"
          >
            {prefix}
          </span>
        )}
        <input
          {...props}
          id={id}
          className={cx(
            "wr-input",
            mono && "wr-mono",
            large && "wr-input-lg",
            !!error && "wr-invalid",
            className,
          )}
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={
            [props["aria-describedby"], description]
              .filter(Boolean)
              .join(" ") || undefined
          }
        />
        {action}
      </div>
      {error ? (
        <div id={`${id}-error`} className="wr-help wr-error">
          {error}
        </div>
      ) : helper ? (
        <div id={`${id}-help`} className="wr-help">
          {helper}
        </div>
      ) : null}
    </div>
  );
}
export type SegmentOption = {
  value: string;
  label: string;
  disabled?: boolean;
};
export function SegmentedControl({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: readonly SegmentOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        "wr-segments",
        options.length === 3 && "wr-cols-3",
        options.length === 4 && "wr-cols-4",
      )}
    >
      {options.map((option) => (
        <button
          type="button"
          className="wr-segment"
          key={option.value}
          aria-pressed={value === option.value}
          disabled={disabled || option.disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

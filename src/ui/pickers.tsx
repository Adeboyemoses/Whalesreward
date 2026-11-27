"use client";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cx } from "./shared";

/**
 * A small, dependency-free set of IANA zone names used only when the
 * runtime has no `Intl.supportedValuesOf` (older engines). Modern browsers
 * and Node 18+ return the full IANA database instead, so this list exists
 * purely as a safety net and does not need to be exhaustive.
 */
const FALLBACK_ZONES = [
  "Africa/Lagos",
  "Africa/Accra",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Nairobi",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/New_York",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/London",
  "Europe/Moscow",
  "Europe/Paris",
  "Pacific/Auckland",
  "UTC",
];

function pad(value: number, length = 2): string {
  return String(Math.trunc(value)).padStart(length, "0");
}

/**
 * Returns the UTC offset, in minutes (positive = ahead of UTC), that `zone`
 * observes at the given instant. Built only from `Intl.DateTimeFormat`'s
 * `longOffset` name, since this repo does not take on a date/timezone
 * library.
 */
export function offsetMinutesInZone(epochMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(epochMs));
  const label =
    parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(label);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

/**
 * Converts a wall-clock date and time, read as local time in `zone`, to the
 * exact instant the server expects: an explicit-offset ISO string
 * (`z.iso.datetime({ offset: true })` in src/shared/contracts/settings.ts).
 *
 * Algorithm: guess the instant by treating the wall clock as if it were UTC,
 * read the zone's offset at that guess, subtract it, then re-check the
 * offset at the corrected instant and subtract again if it changed (this
 * converges immediately except exactly at a DST transition). This handles
 * DST for any IANA zone, not only zones without DST such as Africa/Lagos.
 */
export function wallClockToInstant(
  date: string,
  time: string,
  zone: string,
): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!dateMatch || !timeMatch || !zone) return null;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? "0");
  if ([year, month, day, hour, minute, second].some((n) => Number.isNaN(n)))
    return null;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  let offset = offsetMinutesInZone(utcGuess, zone);
  let instantMs = utcGuess - offset * 60000;
  const offset2 = offsetMinutesInZone(instantMs, zone);
  if (offset2 !== offset) {
    instantMs = utcGuess - offset2 * 60000;
    offset = offset2;
  }
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const offsetLabel = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.000${offsetLabel}`;
}

/**
 * The reverse of wallClockToInstant: reads an explicit-offset (or `Z`) ISO
 * instant back as wall-clock date and time fields in `zone`, for pre-filling
 * the date and time pickers when editing an existing campaign.
 */
export function instantToWallClock(
  value: string | null | undefined,
  zone: string | null | undefined,
): { date: string; time: string } | null {
  if (!value || !zone) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${hour}:${get("minute")}:${get("second")}`,
  };
}

/**
 * IANA zone names for the timezone combobox: Africa/Lagos first (the
 * station's home zone and the default for a brand-new campaign), then the
 * rest alphabetically. Sourced from `Intl.supportedValuesOf("timeZone")`
 * (the browser's own IANA database) where available, with a short static
 * fallback for older engines. `current` (the campaign's stored value, if
 * any) is always included even if the source list doesn't have it, so a
 * saved zone is never dropped or silently replaced.
 */
export function timezoneOptions(current?: string | null): string[] {
  let zones: readonly string[];
  try {
    zones =
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : FALLBACK_ZONES;
  } catch {
    zones = FALLBACK_ZONES;
  }
  const set = new Set(zones);
  if (current) set.add(current);
  set.delete("Africa/Lagos");
  return ["Africa/Lagos", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
}

/**
 * A searchable combobox of IANA timezone names, built from wr-field/wr-input
 * and a wr-list-style option panel (no new colours or shadows). Typing
 * filters the list; arrow keys move the highlighted option; Enter or a
 * pointer selects it. The input always reflects the committed value (it
 * reverts on blur or Escape if nothing was selected), so a stored value that
 * isn't typed out in full is never lost.
 */
export function TimezoneCombobox({
  label,
  hint,
  helper,
  value,
  onChange,
  disabled = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  helper?: ReactNode;
  value: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const listId = `${id}-listbox`;
  const helperId = `${id}-help`;
  const options = useMemo(() => timezoneOptions(value), [value]);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // While closed, the input always shows the committed value rather than a
  // stale search string from a previous open (no effect needed to mirror it).
  const displayed = open ? query : value;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery(value);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, value]);

  const filtered = useMemo(() => {
    const q = displayed.trim().toLowerCase();
    const matches = q
      ? options.filter((zone) => zone.toLowerCase().includes(q))
      : options;
    return matches.slice(0, 50);
  }, [options, displayed]);

  function commit(zone: string) {
    onChange(zone);
    setQuery(zone);
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      if (open && activeIndex >= 0 && filtered[activeIndex]) {
        event.preventDefault();
        commit(filtered[activeIndex]);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery(value);
      setActiveIndex(-1);
    }
  }

  return (
    <div className="wr-field wr-combobox" ref={rootRef}>
      <label className="wr-label" htmlFor={id}>
        {label}
        {hint && <span className="wr-hint">{hint}</span>}
      </label>
      <div className="wr-combobox-control">
        <input
          id={id}
          className="wr-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={displayed}
          aria-describedby={helper ? helperId : undefined}
          onFocus={() => {
            setQuery(value);
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setOpen(false);
            setQuery(value);
            setActiveIndex(-1);
          }}
          aria-activedescendant={
            open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
          }
        />
        {open && filtered.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="wr-combobox-list"
            aria-label={typeof label === "string" ? label : "Timezone options"}
          >
            {filtered.map((zone, index) => (
              <li
                key={zone}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={zone === value}
              >
                <button
                  type="button"
                  className={cx(
                    "wr-combobox-option",
                    index === activeIndex && "wr-combobox-option-active",
                    zone === value && "wr-combobox-option-selected",
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(zone);
                  }}
                >
                  {zone}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {helper && (
        <div id={helperId} className="wr-help">
          {helper}
        </div>
      )}
    </div>
  );
}

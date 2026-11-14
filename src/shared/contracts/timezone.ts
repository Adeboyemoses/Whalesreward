/** Intl also accepts numeric offsets on modern Node; campaign policy requires a
 * supported IANA name (including named aliases such as UTC and US/Eastern). */
export function isSupportedIanaTimezone(value: string): boolean {
  if (/^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** T-08: all station calendar logic lives here; process timezone is irrelevant. */
export const STATION_TIMEZONE = "Africa/Lagos";
const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function epoch(instant: Date): number {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime()))
    throw new TypeError("Expected a valid explicit instant");
  return instant.getTime();
}

/** Lagos has no DST; UTC getters on a shifted copy avoid host-timezone dependencies. */
function stationClock(instant: Date): Date {
  const shifted = new Date(epoch(instant) + LAGOS_OFFSET_MS);
  if (!Number.isFinite(shifted.getTime()))
    throw new RangeError("Instant outside station calendar range");
  return shifted;
}

export function stationDate(instant: Date): string {
  return stationClock(instant).toISOString().slice(0, 10);
}

export function nextStationMidnight(instant: Date): Date {
  const clock = stationClock(instant);
  return new Date(
    Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate()) +
      DAY_MS -
      LAGOS_OFFSET_MS,
  );
}

/** Helper only: authorization/ownership and trustworthy sale date remain service responsibilities. */
export function canAutoApplyCorrection(
  saleInstant: Date,
  serverReceivedAt: Date,
): boolean {
  const sale = epoch(saleInstant);
  const receipt = epoch(serverReceivedAt);
  return (
    receipt >= sale &&
    stationDate(saleInstant) === stationDate(serverReceivedAt) &&
    receipt < nextStationMidnight(saleInstant).getTime()
  );
}

export function formatStationDateTime(instant: Date): string {
  const clock = stationClock(instant);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const hour = clock.getUTCHours();
  return `${clock.getUTCDate()} ${months[clock.getUTCMonth()]} ${clock.getUTCFullYear()} · ${(hour % 12 || 12).toString().padStart(2, "0")}:${clock.getUTCMinutes().toString().padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

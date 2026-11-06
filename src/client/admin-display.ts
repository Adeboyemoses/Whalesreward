export function adminTime(instant: string) {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Lagos",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${day} · ${time}`;
}
export function adminAction(action: string) {
  const words = action.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

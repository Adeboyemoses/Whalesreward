export const cx = (...values: (string | false | undefined)[]) =>
  values.filter(Boolean).join(" ");
export type Tone =
  "synced" | "pending" | "held" | "failed" | "offline" | "online" | "neutral";

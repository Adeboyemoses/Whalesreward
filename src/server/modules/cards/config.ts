import { validateCardPrintLayout, type CardPrintLayout } from "./renderer";
import { AuthError } from "../auth/errors";
export const CARD_POLICY = Object.freeze({
  maxBatchSize: 1000,
  allocationAttempts: 20,
  artifactLifetimeMs: 86400000,
  maxArtifactBytes: 32 * 1024 * 1024,
  leaseMs: 120000,
  maxAttempts: 3,
  retryMs: 30000,
});
export type CardOptions = {
  layout?: CardPrintLayout;
  codeGenerator?: () => string;
  artifactLifetimeMs?: number;
};
export function cardPrintLayout(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CardPrintLayout | undefined {
  const raw = env.WHR_CARD_PRINT_LAYOUT;
  let layout: CardPrintLayout | undefined;
  if (raw) {
    try {
      const value = JSON.parse(raw);
      const fields = [
        "pageWidthMm",
        "pageHeightMm",
        "cardWidthMm",
        "cardHeightMm",
        "marginMm",
        "gapMm",
      ];
      if (
        typeof value !== "object" ||
        value === null ||
        Object.keys(value).some((k) => !fields.includes(k)) ||
        !fields.every(
          (k) =>
            typeof value[k] === "number" &&
            Number.isFinite(value[k]) &&
            value[k] >= 0,
        )
      )
        throw new Error();
      validateCardPrintLayout(value);
      layout = value;
    } catch {
      layout = undefined;
    }
  }
  return layout;
}
export function cardOptions(): CardOptions {
  const layout = cardPrintLayout();
  const lifetime = process.env.WHR_CARD_EXPORT_LIFETIME_SECONDS;
  if (lifetime && !/^[1-9][0-9]{0,6}$/.test(lifetime))
    throw new AuthError("temporarily_unavailable", 503);
  return {
    layout,
    artifactLifetimeMs: lifetime
      ? Number(lifetime) * 1000
      : CARD_POLICY.artifactLifetimeMs,
  };
}

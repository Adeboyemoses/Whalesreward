import { z } from "zod";

export type EmailOptions = {
  adapter: "noop" | "mailpit" | "zoho_cpaas";
  staging?: boolean;
  mailpitUrl?: string;
  apiUrl?: string;
  token?: string;
  from?: string;
  allowedRecipients?: readonly string[];
};
const address = z.email().max(254);
export function normalizedEmail(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  return address.safeParse(normalized).success ? normalized : undefined;
}
const invalid = () => new Error("Email configuration is invalid");
/** No values in configuration errors: these variables contain private inboxes and credentials. */
export function emailConfig(
  env: Record<string, string | undefined> = process.env,
): EmailOptions {
  const staging = env.WHR_ENV === "staging";
  const production =
    env.WHR_ENV === "production" ||
    (!env.WHR_ENV && env.NODE_ENV === "production");
  if (production && env.EMAIL_ALLOWED_RECIPIENTS !== undefined) throw invalid();
  const provider =
    env.EMAIL_PROVIDER ?? (staging || production ? "noop" : "mailpit");
  if (!["noop", "mailpit", "zoho_cpaas"].includes(provider)) throw invalid();
  if (provider === "noop") return { adapter: "noop", staging };
  if (provider === "mailpit") {
    if (staging || production) throw invalid();
    return {
      adapter: "mailpit",
      mailpitUrl: env.MAILPIT_URL ?? "http://127.0.0.1:8025",
    };
  }
  // This work order approves only staging delivery in the EU data centre.
  if (!staging || env.ZOHO_CPAAS_API_URL !== "https://cpaas.zoho.eu/v1.1/email")
    throw invalid();
  const token = env.ZOHO_CPAAS_TOKEN;
  const from = normalizedEmail(env.EMAIL_FROM ?? "");
  const allowedRecipients = (env.EMAIL_ALLOWED_RECIPIENTS ?? "")
    .split(",")
    .map(normalizedEmail);
  if (
    !token ||
    /\s/.test(token) ||
    !from ||
    allowedRecipients.some((item) => !item)
  )
    throw invalid();
  return {
    adapter: "zoho_cpaas",
    staging,
    apiUrl: env.ZOHO_CPAAS_API_URL,
    token,
    from,
    allowedRecipients: allowedRecipients as string[],
  };
}

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
export type EmailSetting =
  | "WHR_ENV"
  | "EMAIL_PROVIDER"
  | "ZOHO_CPAAS_API_URL"
  | "ZOHO_CPAAS_TOKEN"
  | "EMAIL_FROM"
  | "EMAIL_ALLOWED_RECIPIENTS"
  | "MAILPIT_URL";
/** Carries fixed diagnostics only; never include the rejected value or a cause. */
export class EmailConfigError extends Error {
  constructor(
    readonly setting: EmailSetting,
    readonly reason: "config_invalid" | "token_has_prefix" = "config_invalid",
  ) {
    super("Email configuration is invalid");
  }
}
const address = z.email().max(254);
export function normalizedEmail(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  return address.safeParse(normalized).success ? normalized : undefined;
}
/** No values in configuration errors: these variables contain private inboxes and credentials. */
export function mailpitOrigin(raw: string = "http://127.0.0.1:8025"): string {
  try {
    const url = new URL(raw);
    if (
      !["localhost", "127.0.0.1", "mailpit"].includes(url.hostname) ||
      url.protocol !== "http:" ||
      url.username ||
      url.password
    )
      throw new Error();
    return url.toString();
  } catch {
    throw new EmailConfigError("MAILPIT_URL");
  }
}
export function emailConfig(
  env: Record<string, string | undefined> = process.env,
): EmailOptions {
  const staging = env.WHR_ENV === "staging";
  const production =
    env.WHR_ENV === "production" ||
    (!env.WHR_ENV && env.NODE_ENV === "production");
  if (production && env.EMAIL_ALLOWED_RECIPIENTS !== undefined)
    throw new EmailConfigError("EMAIL_ALLOWED_RECIPIENTS");
  const provider =
    env.EMAIL_PROVIDER ?? (staging || production ? "noop" : "mailpit");
  if (!["noop", "mailpit", "zoho_cpaas"].includes(provider))
    throw new EmailConfigError("EMAIL_PROVIDER");
  if (provider === "noop") return { adapter: "noop", staging };
  if (provider === "mailpit") {
    if (staging || production) throw new EmailConfigError("EMAIL_PROVIDER");
    return {
      adapter: "mailpit",
      mailpitUrl: env.MAILPIT_URL ?? "http://127.0.0.1:8025",
    };
  }
  if (!staging) throw new EmailConfigError("WHR_ENV");
  if (
    ![
      "https://cpaas.zoho.com/v1.1/email",
      "https://cpaas.zoho.eu/v1.1/email",
    ].includes(env.ZOHO_CPAAS_API_URL ?? "")
  )
    throw new EmailConfigError("ZOHO_CPAAS_API_URL");
  const token = env.ZOHO_CPAAS_TOKEN;
  if (token?.trimStart().toLowerCase().startsWith("zoho-enczapikey"))
    throw new EmailConfigError("ZOHO_CPAAS_TOKEN", "token_has_prefix");
  if (!token || /\s/.test(token))
    throw new EmailConfigError("ZOHO_CPAAS_TOKEN");
  const from = normalizedEmail(env.EMAIL_FROM ?? "");
  if (!from) throw new EmailConfigError("EMAIL_FROM");
  const allowedRecipients = (env.EMAIL_ALLOWED_RECIPIENTS ?? "")
    .split(",")
    .map(normalizedEmail);
  if (allowedRecipients.some((item) => !item))
    throw new EmailConfigError("EMAIL_ALLOWED_RECIPIENTS");
  return {
    adapter: "zoho_cpaas",
    staging,
    apiUrl: env.ZOHO_CPAAS_API_URL,
    token,
    from,
    allowedRecipients: allowedRecipients as string[],
  };
}

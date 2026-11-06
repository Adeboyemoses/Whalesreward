import { logger } from "../lib/logger";
import {
  emailConfig,
  EmailConfigError,
  normalizedEmail,
  type EmailOptions,
  type EmailSetting,
} from "./email-config";
export type { EmailOptions } from "./email-config";
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};
const TEST_NOTICE = "This is a test message from the staging environment.";
const TIMEOUT_MS = 10000;
type FailureReason =
  | "config_invalid"
  | "network"
  | "timeout"
  | "http_status"
  | "provider_error"
  | "response_invalid";
const safeAdapter = (value: unknown) =>
  value === "noop" || value === "mailpit" || value === "zoho_cpaas"
    ? value
    : "unknown";
class InvalidResponse extends Error {}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function providerCode(body: unknown): string | undefined {
  if (!record(body)) return;
  const candidates = [
    body,
    ...(Array.isArray(body.data) ? body.data : [body.data]),
  ];
  for (const candidate of candidates) {
    if (!record(candidate) || typeof candidate.error_code !== "string")
      continue;
    const code = candidate.error_code;
    // Equality rejects the trailing newline that JavaScript's $ otherwise permits.
    if (/^[A-Z]{2,5}_[0-9]{1,5}$/.exec(code)?.[0] === code) return code;
  }
}
async function responseBody(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new InvalidResponse();
  let abort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    let content = "",
      bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16384) throw new InvalidResponse();
      content += decoder.decode(chunk.value, { stream: true });
    }
    try {
      return JSON.parse(content + decoder.decode()) as unknown;
    } catch {
      throw new InvalidResponse();
    }
  } finally {
    signal.removeEventListener("abort", abort);
    // Cancellation must not extend the bounded delivery attempt.
    void reader.cancel().catch(() => {});
  }
}
/** A single bounded attempt. Never retry an uncertain send of a single-use recovery link. */
export async function sendEmail(
  message: EmailMessage,
  supplied?: EmailOptions,
) {
  let adapter = safeAdapter(supplied?.adapter ?? process.env.EMAIL_PROVIDER);
  const failed = (
    reason: FailureReason,
    details: {
      status?: number;
      error_code?: string;
      setting?: EmailSetting;
    } = {},
  ) => {
    logger.warn({ event: "email.send_failed", adapter, reason, ...details });
    return {
      delivered: false,
      adapter,
      failure: "delivery_unavailable",
    } as const;
  };
  let options: EmailOptions;
  try {
    options = supplied ?? emailConfig();
  } catch (error) {
    return failed(
      "config_invalid",
      error instanceof EmailConfigError
        ? { setting: error.setting }
        : { setting: "EMAIL_PROVIDER" },
    );
  }
  adapter = safeAdapter(options.adapter);
  if (adapter === "unknown")
    return failed("config_invalid", { setting: "EMAIL_PROVIDER" });
  if (adapter === "noop") return { delivered: false, adapter } as const;
  let url: string;
  let body: unknown;
  let headers: Record<string, string> = { "content-type": "application/json" };
  if (adapter === "zoho_cpaas") {
    let config: EmailOptions;
    try {
      config = emailConfig({
        WHR_ENV: options.staging ? "staging" : "production",
        EMAIL_PROVIDER: adapter,
        ZOHO_CPAAS_API_URL: options.apiUrl,
        ZOHO_CPAAS_TOKEN: options.token,
        EMAIL_FROM: options.from,
        EMAIL_ALLOWED_RECIPIENTS: options.allowedRecipients?.join(","),
      });
    } catch (error) {
      return failed("config_invalid", {
        setting:
          error instanceof EmailConfigError ? error.setting : "EMAIL_PROVIDER",
      });
    }
    const to = normalizedEmail(message.to);
    if (!to || !config.allowedRecipients!.includes(to))
      return failed("config_invalid", { setting: "EMAIL_ALLOWED_RECIPIENTS" });
    url = config.apiUrl!;
    headers = {
      ...headers,
      accept: "application/json",
      authorization: `Zoho-enczapikey ${config.token}`,
    };
    body = {
      from: { address: config.from },
      to: [{ email_address: { address: to } }],
      subject: `[Staging] ${message.subject}`,
      textbody: `${TEST_NOTICE}\n\n${message.text}`,
      ...(message.html === undefined
        ? {}
        : { htmlbody: `<p>${TEST_NOTICE}</p>${message.html}` }),
      track_clicks: false,
      track_opens: false,
    };
  } else {
    try {
      const base = new URL(options.mailpitUrl ?? "http://127.0.0.1:8025");
      if (
        !["localhost", "127.0.0.1", "mailpit"].includes(base.hostname) ||
        base.protocol !== "http:" ||
        base.username ||
        base.password
      )
        throw new EmailConfigError("MAILPIT_URL");
      url = new URL("/api/v1/send", base).toString();
    } catch {
      return failed("config_invalid", { setting: "MAILPIT_URL" });
    }
    body = {
      From: { Email: "whales@example.com", Name: "Whales Rewards" },
      To: [{ Email: message.to }],
      Subject: message.subject,
      Text: message.text,
      HTML: message.html,
    };
  }
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let status: number | undefined;
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    status = response.status;
    if (adapter === "mailpit") {
      void response.body?.cancel().catch(() => {});
      return response.ok
        ? ({ delivered: true, adapter } as const)
        : failed("http_status", { status });
    }
    const acceptedStatus = status === 200 || status === 201;
    let payload: unknown;
    try {
      payload = await responseBody(response, signal);
    } catch (error) {
      if (error instanceof InvalidResponse)
        return failed(acceptedStatus ? "response_invalid" : "http_status", {
          status,
        });
      throw error;
    }
    const code = providerCode(payload);
    const details = { status, ...(code ? { error_code: code } : {}) };
    if (!acceptedStatus) return failed("http_status", details);
    if (code) return failed("provider_error", details);
    if (
      !record(payload) ||
      !Array.isArray(payload.data) ||
      !payload.data.some((item) => record(item) && item.code === "EM_104")
    )
      return failed("response_invalid", { status });
    return { delivered: true, adapter } as const;
  } catch (error) {
    const timeout =
      signal.aborted ||
      (error instanceof Error && error.name === "TimeoutError");
    return failed(
      timeout ? "timeout" : "network",
      status === undefined ? {} : { status },
    );
  }
}

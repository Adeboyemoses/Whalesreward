import { logger } from "../lib/logger";
import {
  emailConfig,
  normalizedEmail,
  type EmailOptions,
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

/** A single bounded attempt. Never retry an uncertain send of a single-use recovery link. */
export async function sendEmail(
  message: EmailMessage,
  options: EmailOptions = emailConfig(),
) {
  const adapter = options.adapter;
  const unavailable = {
    delivered: false,
    adapter,
    failure: "delivery_unavailable",
  } as const;
  if (adapter === "noop") return { delivered: false, adapter } as const;
  if (adapter === "zoho_cpaas") {
    // Revalidate explicit options too: tests and callers cannot disable staging safeguards.
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
    } catch {
      return unavailable;
    }
    const to = normalizedEmail(message.to);
    if (!to || !config.allowedRecipients!.includes(to)) {
      logger.warn({ event: "email.recipient_refused", adapter });
      return unavailable;
    }
    try {
      const response = await fetch(config.apiUrl!, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Zoho-enczapikey ${config.token}`,
        },
        body: JSON.stringify({
          from: { address: config.from },
          to: [{ email_address: { address: to } }],
          subject: `[Staging] ${message.subject}`,
          textbody: `${TEST_NOTICE}\n\n${message.text}`,
          ...(message.html === undefined
            ? {}
            : { htmlbody: `<p>${TEST_NOTICE}</p>${message.html}` }),
          track_clicks: false,
          track_opens: false,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      // The send endpoint documents 200 + EM_104 as accepted. Never log its response body.
      if (response.status !== 200) {
        await response.body?.cancel();
        return unavailable;
      }
      const reader = response.body?.getReader();
      if (!reader) return unavailable;
      let content = "";
      let bytes = 0;
      const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 16384) {
          await reader.cancel();
          return unavailable;
        }
        content += decoder.decode(chunk.value, { stream: true });
      }
      const body: unknown = JSON.parse(content + decoder.decode());
      if (
        !body ||
        typeof body !== "object" ||
        !("data" in body) ||
        !Array.isArray(body.data) ||
        !body.data.some(
          (item: unknown) =>
            item &&
            typeof item === "object" &&
            "code" in item &&
            item.code === "EM_104",
        )
      )
        return unavailable;
      return { delivered: true, adapter } as const;
    } catch {
      return unavailable;
    }
  }
  const url = new URL(options.mailpitUrl ?? "http://127.0.0.1:8025");
  if (
    !["localhost", "127.0.0.1", "mailpit"].includes(url.hostname) ||
    url.protocol !== "http:" ||
    url.username ||
    url.password
  )
    throw new Error("Local mail adapter configuration is invalid");
  try {
    const response = await fetch(new URL("/api/v1/send", url), {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        From: { Email: "whales@example.com", Name: "Whales Rewards" },
        To: [{ Email: message.to }],
        Subject: message.subject,
        Text: message.text,
        HTML: message.html,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await response.body?.cancel();
    return { delivered: response.ok, adapter } as const;
  } catch {
    return unavailable;
  }
}

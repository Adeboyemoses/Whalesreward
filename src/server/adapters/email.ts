export type EmailMessage = { to: string; subject: string; text: string };
export type EmailOptions = { adapter: "noop" | "mailpit"; mailpitUrl?: string };
/** Mailpit is local only. No provider SDK or real delivery activation exists. */
export async function sendEmail(
  message: EmailMessage,
  options: EmailOptions = { adapter: "noop" },
) {
  if (options.adapter === "noop")
    return { delivered: false, adapter: "noop" } as const;
  const url = new URL(options.mailpitUrl ?? "http://127.0.0.1:8025");
  if (
    !["localhost", "127.0.0.1", "mailpit"].includes(url.hostname) ||
    url.protocol !== "http:" ||
    url.username ||
    url.password
  )
    throw new Error("Local mail adapter configuration is invalid");
  const response = await fetch(new URL("/api/v1/send", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      From: { Email: "whales@example.com", Name: "Whales Rewards" },
      To: [{ Email: message.to }],
      Subject: message.subject,
      Text: message.text,
    }),
    signal: AbortSignal.timeout(10000),
  });
  return { delivered: response.ok, adapter: "mailpit" } as const;
}

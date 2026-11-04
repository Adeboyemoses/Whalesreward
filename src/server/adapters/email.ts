export type EmailMessage = { to: string; subject: string; text: string };

/** Deliberately no transport until WO-core-5 configures a provider. Never log mail. */
export async function sendEmail(_message: EmailMessage) {
  void _message;
  return { delivered: false, adapter: "noop" } as const;
}

import type { EmailMessage } from "../../adapters/email";
import { ADMIN_POLICY } from "./config";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** M01/M02: table layout, inline brand colours, system fonts, identical text part. */
export function accessEmail(input: {
  purpose: string;
  email: string;
  origin: string;
  token?: string;
}): EmailMessage {
  const verify = input.purpose === "verify_email",
    notice = input.purpose === "reset_notice";
  const title = notice
    ? "Your password was changed"
    : verify
      ? "Verify your email address"
      : "Reset your password";
  const subject = notice
    ? "Your Whales Rewards admin password was changed"
    : verify
      ? "Verify your email address for the Whales Rewards admin portal"
      : "Reset your Whales Rewards admin password";
  const minutes =
    (verify ? ADMIN_POLICY.verificationMs : ADMIN_POLICY.resetMs) / 60000;
  const duration =
    minutes % 60 === 0 ? `${minutes / 60} hours` : `${minutes} minutes`;
  const url = `${input.origin}/admin/${verify ? "verify-email" : "reset-password"}#token=${input.token ?? ""}`;
  const paragraphs = notice
    ? [
        "Your Whales Rewards admin password was changed. Existing sessions have been signed out.",
        "If you did not make this change, contact the portal owner.",
      ]
    : verify
      ? [
          "An admin added this address as your recovery email for the Whales Rewards admin portal.",
          "Confirm that this address is yours. Until it is verified, password recovery stays unavailable for your account.",
          `The link can be used once and expires in ${duration}. Verifying does not sign you in; you will still sign in with your username and password.`,
          "If you did not expect this email, you can ignore it. Nothing changes until you confirm your email address.",
        ]
      : [
          "Someone asked to reset the password for your Whales Rewards admin account. If that was you, choose a new password with the link below.",
          `The link can be used once and expires in ${duration}. Resetting signs you out of every other session and is recorded in the audit history.`,
          "If you did not request this, you can ignore it. Your password has not changed. If this keeps happening, tell the portal owner.",
        ];
  const button = verify ? "Verify email address" : "Choose a new password";
  const footer = [
    "Whales Rewards is the loyalty programme of Whales Energy, a Whales Empire brand.",
    notice
      ? "This is a security notification for your admin account."
      : verify
        ? "This link is personal to this address; do not forward it."
        : "Sent to the verified email on this account only. Whales Rewards never asks for your password by email.",
    "This is an automated message from the admin portal. Replies to this address are not read.",
  ];
  const text = [
    title,
    ...paragraphs,
    ...(notice
      ? []
      : [
          button,
          url,
          "If the button does not work, copy this link into your browser:",
          url,
        ]),
    ...footer,
  ].join("\n\n");
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#17202a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #dce3eb"><tr><td style="background:#102a43;padding:20px 32px;color:#ffffff;font-size:20px;font-weight:bold"><img src="${escape(input.origin)}/design-system/mark.svg" alt="Whales Rewards" width="32" height="32" style="vertical-align:middle;border:0"> Whales Rewards</td></tr><tr><td style="padding:32px"><h1 style="font-size:24px;line-height:30px;margin:0 0 20px">${escape(title)}</h1>${paragraphs.map((p) => `<p style="font-size:16px;line-height:24px;margin:0 0 16px">${escape(p)}</p>`).join("")}${notice ? "" : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#0f4c81;padding:14px 28px"><a href="${escape(url)}" style="color:#ffffff;text-decoration:none;font-weight:bold">${button}</a></td></tr></table><p style="font-size:13px;line-height:20px">If the button does not work, copy this link into your browser:</p><p style="word-break:break-all;font-size:13px"><a href="${escape(url)}" style="color:#0f4c81">${escape(url)}</a></p>`}</td></tr><tr><td style="background:#f8fafc;padding:16px 32px;font-size:12px;line-height:18px;color:#52606d">${footer.map((p) => `<p style="margin:0 0 6px">${escape(p)}</p>`).join("")}</td></tr></table></td></tr></table></body></html>`;
  return { to: input.email, subject, text, html };
}

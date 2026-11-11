import { v7 } from "uuid";
export const adminOperationId = () => v7();
const messages: Record<string, string> = {
  unavailable:
    "The service is unavailable. Retry the same request; do not assume it failed.",
  auth_policy_unconfigured:
    "Sign-in isn't set up on this server yet. Contact your system administrator.",
  delegation_policy_unconfigured:
    "Access settings aren't set up on this server, so roles can't be changed. Contact your system administrator.",
  export_failed: "File preparation failed. Prepare a new export.",
  last_owner: "At least one active Owner must remain.",
  delegation_denied:
    "You cannot grant or change access beyond your own authority.",
  permission_denied: "You no longer have permission for this action.",
  version_conflict:
    "This record changed. Reload and review the latest version.",
  protected_owner: "The Owner role cannot be edited.",
  invalid_credentials: "The username or password is incorrect.",
  link_unavailable: "This link is unavailable.",
  password_policy: "Use at least 12 characters for your password.",
  password_mismatch: "The passwords do not match.",
  password_unchanged: "Choose a different password.",
  username_in_use: "This username is already in use.",
  email_in_use: "This email is already in use.",
  delivery_unconfigured:
    "Email delivery is unavailable. The address remains unverified.",
  verification_not_available: "Verification is unavailable for this account.",
  rate_limited: "Too many requests. Wait before trying again.",
};
export class AdminError extends Error {
  constructor(
    public code: string,
    public status = 0,
  ) {
    super(
      messages[code] ??
        (status === 0
          ? "Connection interrupted. The result is uncertain. Reconnect and reload before making another change."
          : "This request could not be completed. Reload and try again."),
    );
  }
}
export async function adminRequest<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  key?: string,
): Promise<T> {
  let r: Response;
  try {
    r = await fetch("/api/admin/" + path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new AdminError("network");
  }
  if (r.status === 204) return undefined as T;
  let data;
  try {
    data = await r.json();
  } catch {
    throw new AdminError(r.ok ? "invalid_response" : "unavailable", r.status);
  }
  if (!r.ok)
    throw new AdminError(
      typeof data?.error?.code === "string" ? data.error.code : "unavailable",
      r.status,
    );
  if (!data || typeof data !== "object" || !("data" in data))
    throw new AdminError("invalid_response", r.status);
  return data.data as T;
}

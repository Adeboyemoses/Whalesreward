import { isIP } from "node:net";
import {
  authId,
  signInSchema,
  signOutSchema,
} from "../../../shared/contracts/auth";
import { newId } from "../../lib/ids";
import { database } from "../../lib/db";
import { authConfig } from "./config";
import { AuthError } from "./errors";
import { getSession, signIn, signOut } from "./service";

export const COOKIE = "__Host-whr-session";
export function enforceOrigin(request: Request, origin: string) {
  if (
    request.headers.get("origin") !== origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AuthError("origin_rejected", 403);
}
/** Only configure a header overwritten by the final trusted proxy. Unconfigured
 * deployments share a conservative bucket; arbitrary forwarded IPs are ignored. */
export function clientIp(request: Request, trustedHeader?: string): string {
  if (!trustedHeader) return "unattributed";
  const ip = request.headers.get(trustedHeader)?.trim();
  return ip && isIP(ip) ? ip : "unattributed";
}
function cookieToken(request: Request): string | undefined {
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(`${COOKIE}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0]!.slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}
function cookie(value: string, expiry?: string) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; ${expiry ? `Expires=${new Date(expiry).toUTCString()}` : "Max-Age=0"}`;
}
async function body(request: Request): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/json"
  )
    throw new AuthError("invalid_request", 400);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError("invalid_request", 400);
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > 8192) {
        await reader.cancel();
        throw new AuthError("invalid_request", 400);
      }
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError("invalid_request", 400);
  } finally {
    reader.releaseLock();
  }
}
const messages: Record<string, string> = {
  invalid_credentials: "The username or password is incorrect.",
  unauthenticated: "Sign in to continue.",
  assignment_unavailable:
    "Your assignment is unavailable. Contact your administrator.",
  operation_conflict: "Start a new sign-in attempt.",
  sign_in_retry_expired: "Start a new sign-in attempt.",
  invalid_request: "Check your request and try again.",
  origin_rejected: "This request is not allowed.",
  rate_limited: "Please wait before trying again.",
  temporarily_unavailable: "The service is temporarily unavailable.",
};
export async function handleAuth(
  request: Request,
  action: "sign-in" | "sign-out" | "session",
): Promise<Response> {
  const headers = new Headers({ "Cache-Control": "no-store" });
  const requestId = newId();
  try {
    const config = authConfig();
    const pool = database();
    const ip = clientIp(request, config.trustedIpHeader);
    if (new URL(request.url).search)
      throw new AuthError("invalid_request", 400);
    if (action === "session") {
      const session = await getSession(pool, config, cookieToken(request), ip);
      return Response.json(
        { data: session, serverTime: session.serverTime, requestId },
        { headers },
      );
    }
    enforceOrigin(request, config.origin);
    const key = authId.safeParse(request.headers.get("idempotency-key"));
    if (!key.success) throw new AuthError("invalid_request", 400);
    const input = await body(request);
    if (action === "sign-out") {
      if (!signOutSchema.safeParse(input).success)
        throw new AuthError("invalid_request", 400);
      await signOut(pool, config, cookieToken(request), ip);
      headers.set("Set-Cookie", cookie(""));
      return new Response(null, { status: 204, headers });
    }
    const parsed = signInSchema.safeParse(input);
    if (!parsed.success) throw new AuthError("invalid_request", 400);
    const result = await signIn(pool, config, parsed.data, key.data, ip);
    headers.set(
      "Set-Cookie",
      cookie(result.token, result.session.sessionExpiresAt),
    );
    return Response.json(
      {
        data: result.session,
        serverTime: result.session.serverTime,
        requestId,
      },
      { headers },
    );
  } catch (error) {
    const failure =
      error instanceof AuthError
        ? error
        : new AuthError("temporarily_unavailable", 503);
    if (failure.retryAfter)
      headers.set("Retry-After", String(failure.retryAfter));
    return Response.json(
      {
        error: {
          code: failure.code,
          message:
            messages[failure.code] ?? "This request could not be completed.",
          retryable: [429, 503].includes(failure.status),
        },
        serverTime: new Date().toISOString(),
        requestId,
      },
      { status: failure.status, headers },
    );
  }
}

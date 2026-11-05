import { z } from "zod";
import { authId } from "../../../shared/contracts/auth";
import {
  adminSignInSchema,
  firstPasswordSchema,
  resetRequestSchema,
  tokenSchema,
  resetConfirmSchema,
  roleInputSchema,
  roleEditSchema,
  createUserSchema,
  accessSchema,
  verifyRequestSchema,
  pageSchema,
  searchUsersSchema,
  historySchema,
} from "../../../shared/contracts/admin";
import { database } from "../../lib/db";
import { newId } from "../../lib/ids";
import { requireAdminSession, securityLock } from "../../lib/authz";
import { enforceOrigin, clientIp } from "../auth/http";
import { digest } from "../auth/crypto";
import { AuthError } from "../auth/errors";
import { consumeLimits } from "../auth/rate-limit";
import { adminConfig } from "./config";
import { transaction } from "./repo";
import {
  signIn,
  getSession,
  signOut,
  firstPassword,
  adminRead,
  adminWrite,
} from "./service";
import { requestReset, inspectToken, confirmToken } from "./mail";
export const COOKIE = "__Host-whr-admin-session";
export function cookieToken(request: Request) {
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith(COOKIE + "="));
  if (matches.length !== 1) return undefined;
  const token = matches[0]!.slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}
const cookie = (token: string, expires?: string) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; ${expires ? `Expires=${new Date(expires).toUTCString()}` : "Max-Age=0"}`;
async function body(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0]?.trim() !==
    "application/json"
  )
    throw new AuthError("invalid_request", 400);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError("invalid_request", 400);
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > 32768) {
        await reader.cancel();
        throw new AuthError("request_too_large", 413);
      }
      chunks.push(next.value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } catch {
      throw new AuthError("invalid_request", 400);
    }
  } finally {
    reader.releaseLock();
  }
}
const readActions = [
  "permissions",
  "users-search",
  "users-get",
  "roles-list",
  "roles-get",
  "assignable-roles",
  "access-history",
];
export async function handleAdmin(
  request: Request,
  action: string,
  targetId?: string,
): Promise<Response> {
  const headers = new Headers({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    }),
    requestId = newId();
  try {
    const config = adminConfig(),
      pool = database(),
      ip = clientIp(request, config.trustedIpHeader),
      token = cookieToken(request);
    const url = new URL(request.url);
    if (targetId && !authId.safeParse(targetId).success)
      throw new AuthError("invalid_request", 400);
    let data: unknown,
      status = 200;
    if (request.method !== "GET") enforceOrigin(request, config.origin);
    if (
      url.search &&
      !["roles-list", "assignable-roles", "access-history"].includes(action)
    )
      throw new AuthError("invalid_request", 400);
    if (action === "session") data = await getSession(pool, config, token, ip);
    else if (
      action === "sign-in" ||
      action === "sign-out" ||
      action === "password-reset-requests"
    ) {
      const key = authId.parse(request.headers.get("idempotency-key"));
      const input = await body(request);
      if (action === "sign-in") {
        const result = await signIn(
          pool,
          config,
          adminSignInSchema.parse(input),
          key,
          ip,
        );
        headers.set(
          "Set-Cookie",
          cookie(result.token, result.session.expiresAt),
        );
        data = result.session;
      } else if (action === "sign-out") {
        z.object({}).strict().parse(input);
        await signOut(pool, config, token, ip);
        headers.set("Set-Cookie", cookie(""));
        return new Response(null, { status: 204, headers });
      } else {
        data = await requestReset(
          pool,
          config,
          resetRequestSchema.parse(input).email,
          key,
          ip,
        );
        status = 202;
      }
    } else if (
      action.startsWith("password-reset-") ||
      action.startsWith("email-verification-")
    ) {
      const input =
        action === "password-reset-confirm"
          ? resetConfirmSchema.parse(await body(request))
          : tokenSchema.parse(await body(request));
      await consumeLimits(pool, config.secret, [
        { key: `admin-token-ip:${ip}`, capacity: 30 },
        { key: `admin-token:${digest(input.token)}`, capacity: 10 },
      ]);
      const purpose = action.startsWith("password-reset-")
        ? "reset_password"
        : "verify_email";
      data = action.endsWith("-inspect")
        ? await inspectToken(pool, config, input.token, purpose)
        : await confirmToken(
            pool,
            config,
            input.token,
            purpose,
            action === "password-reset-confirm"
              ? resetConfirmSchema.parse(input)
              : undefined,
          );
    } else {
      const isRead = readActions.includes(action);
      const actor = await transaction(pool, async (db) => {
        await securityLock(db);
        return requireAdminSession(db, token, action === "first-password");
      });
      const capacity =
        action === "first-password"
          ? 5
          : action === "verification-requests"
            ? 10
            : isRead
              ? 60
              : 20;
      await consumeLimits(pool, config.secret, [
        {
          key: `admin-${isRead ? "read" : "write"}-ip:${ip}`,
          capacity: isRead
            ? 180
            : action === "first-password" || action === "verification-requests"
              ? 30
              : 60,
        },
        {
          key: `admin-${action === "first-password" ? "password" : action === "verification-requests" ? "verify" : isRead ? "read" : "write"}-account:${actor.user_id}`,
          capacity,
        },
        ...(action === "verification-requests"
          ? [{ key: `admin-verify-target:${targetId}`, capacity: 3 }]
          : []),
      ]);
      if (action === "first-password") {
        const result = await firstPassword(
          pool,
          config,
          token,
          firstPasswordSchema.parse(await body(request)),
        );
        headers.set(
          "Set-Cookie",
          cookie(result.token, result.session.expiresAt),
        );
        data = result.session;
      } else if (isRead) {
        let input: Record<string, unknown> = {};
        if (action === "users-search")
          input = searchUsersSchema.parse(await body(request));
        else if (
          ["roles-list", "assignable-roles", "access-history"].includes(action)
        ) {
          const query: Record<string, unknown> = {};
          for (const [k, v] of url.searchParams) {
            if (k in query) throw new AuthError("invalid_request", 400);
            query[k] = k === "limit" ? Number(v) : v;
          }
          input = (
            action === "access-history" ? historySchema : pageSchema
          ).parse(query);
        }
        data = await adminRead(pool, config, token, action, input, targetId);
      } else {
        const schemas: Record<string, z.ZodType> = {
          "users-create": createUserSchema,
          "users-access": accessSchema,
          "roles-create": roleInputSchema,
          "roles-edit": roleEditSchema,
          "verification-requests": verifyRequestSchema,
        };
        const schema = schemas[action];
        if (!schema) throw new AuthError("not_found", 404);
        data = await adminWrite(
          pool,
          config,
          token,
          action,
          schema.parse(await body(request)),
          targetId,
        );
        status =
          action === "verification-requests"
            ? 202
            : action.endsWith("-create")
              ? 201
              : 200;
      }
    }
    return Response.json(
      { data, serverTime: new Date().toISOString(), requestId },
      { status, headers },
    );
  } catch (e) {
    const failure =
      e instanceof AuthError
        ? e
        : e instanceof z.ZodError
          ? new AuthError("invalid_request", 400)
          : new AuthError("temporarily_unavailable", 503);
    if (failure.retryAfter)
      headers.set("Retry-After", String(failure.retryAfter));
    return Response.json(
      {
        error: {
          code: failure.code,
          message:
            failure.code === "invalid_credentials"
              ? "The username or password is incorrect."
              : "This request could not be completed.",
          retryable: [429, 503].includes(failure.status),
        },
        serverTime: new Date().toISOString(),
        requestId,
      },
      { status: failure.status, headers },
    );
  }
}

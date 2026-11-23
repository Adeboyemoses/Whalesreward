import {
  monitoringSchema,
  deployCheckSchema,
} from "../../../shared/contracts/monitoring";
import type pg from "pg";
import { database } from "../../lib/db";
import { cookieToken } from "../admin-access/http";
import { AuthError } from "../auth/errors";
import { readMonitoring } from "./service";
export async function monitoringResponse(
  request: Request,
  deployCheck = false,
  pool?: pg.Pool,
) {
  const headers = {
    "Cache-Control": "no-store",
    Vary: "Cookie",
    "Referrer-Policy": "no-referrer",
  };
  try {
    if (request.method !== "GET" || new URL(request.url).search)
      throw new AuthError("invalid_request", 400);
    const data = await readMonitoring(
      pool ?? database(),
      cookieToken(request),
      deployCheck,
    );
    return Response.json(
      {
        data: (deployCheck ? deployCheckSchema : monitoringSchema).parse(data),
      },
      { headers },
    );
  } catch (error) {
    const e =
      error instanceof AuthError
        ? error
        : new AuthError("temporarily_unavailable", 503);
    return Response.json(
      {
        error: {
          code: e.code,
          message: "This request could not be completed.",
          retryable: e.status === 503,
        },
      },
      { status: e.status, headers },
    );
  }
}

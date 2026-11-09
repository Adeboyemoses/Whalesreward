import { z } from "zod";
import { adminRequest, AdminError, adminOperationId } from "./admin-api";
import {
  assertMoney,
  parseNaira,
  parseKobo,
  formatNaira,
} from "../shared/money";
export const priceInput = (value: string) =>
  assertMoney(parseNaira(value), true).toString();
export const priceDisplay = (value: string) => formatNaira(parseKobo(value));
export const priceEditorValue = (value: string) => {
  const kobo = parseKobo(value);
  return `${kobo / 100n}.${(kobo % 100n).toString().padStart(2, "0")}`;
};
export type FrozenChange<T extends object = Record<string, unknown>> = {
  path: string;
  body: Readonly<T & { operationId: string }>;
};
export function freezeChange<T extends object>(
  path: string,
  body: T,
): FrozenChange<T> {
  return Object.freeze({
    path,
    body: Object.freeze({
      ...structuredClone(body),
      operationId: adminOperationId(),
    }),
  });
}
export class StationApi {
  constructor(private request: typeof adminRequest = adminRequest) {}
  async read<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const value = await this.request<unknown>(path, body);
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new AdminError("invalid_response");
    return parsed.data;
  }
  async commit<T>(
    change: FrozenChange<object>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const result = await this.read(change.path, schema, change.body);
    if (
      result &&
      typeof result === "object" &&
      "operationId" in result &&
      result.operationId !== change.body.operationId
    )
      throw new AdminError("invalid_response");
    return result;
  }
  async all<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: Record<string, unknown>,
  ): Promise<T[]> {
    const page = z.strictObject({
      items: z.array(schema),
      nextCursor: z.string().nullable(),
    });
    const result: T[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let pages = 0; pages < 256; pages++) {
      const query = new URLSearchParams();
      if (cursor) query.set("cursor", cursor);
      query.set("limit", "100");
      const current: { items: T[]; nextCursor: string | null } =
        await this.read(
          body === undefined
            ? `${path}${path.includes("?") ? "&" : "?"}${query}`
            : path,
          page,
          body === undefined
            ? undefined
            : { ...body, ...(cursor ? { cursor } : {}), limit: 100 },
        );
      result.push(...current.items);
      cursor = current.nextCursor;
      if (cursor === null) return result;
      if (seen.has(cursor)) throw new AdminError("invalid_response");
      seen.add(cursor);
    }
    throw new AdminError("invalid_response");
  }
}
const messages: Record<string, string> = {
  pump_name_in_use: "A pump already uses this name. Choose a unique name.",
  pump_unavailable:
    "This pump is unavailable. Reload and review the current pumps.",
  product_unavailable: "This product is unavailable. Reload and try again.",
  attendant_unavailable:
    "This attendant is unavailable. Reload and review the current record.",
  no_change:
    "Nothing changed. Reload the current record before reviewing again.",
  rate_invalid: "Enter a positive price with at most two decimal places.",
  precision_invalid: "Choose quantity decimal places from 0 to 6.",
  currency_unsupported: "This currency is unavailable for price activation.",
  operation_conflict:
    "This confirmation no longer matches its original request. Reload and review again.",
  invalid_response:
    "The result could not be verified. Retry the same confirmation or reload the current record; do not assume it failed.",
};
export const stationMessage = (error: unknown) =>
  error instanceof AdminError
    ? (messages[error.code] ?? error.message)
    : "This request could not be completed. Check your connection and try again.";

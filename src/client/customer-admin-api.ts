import { z } from "zod";
import { adminRequest, AdminError, adminOperationId } from "./admin-api";
export type CustomerChange<T extends object = Record<string, unknown>> =
  Readonly<{ path: string; body: Readonly<T & { operationId: string }> }>;
export function freezeCustomerChange<T extends object>(
  path: string,
  body: T,
): CustomerChange<T> {
  return Object.freeze({
    path,
    body: Object.freeze({
      ...structuredClone(body),
      operationId: adminOperationId(),
    }),
  });
}
/** A malformed success can follow a commit; retain the frozen operation for replay. */
export const customerChangeIsUncertain = (error: unknown): boolean =>
  error instanceof AdminError &&
  (error.code === "invalid_response" ||
    error.status === 0 ||
    (error.status >= 500 && error.code !== "print_layout_unconfigured"));
export const pageOf = <T>(schema: z.ZodType<T>) =>
  z.strictObject({
    items: z.array(schema).max(100),
    nextCursor: z.string().nullable(),
  });
export function pageQuery(
  path: string,
  filters: Record<string, string | undefined> = {},
) {
  const query = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  query.set("limit", "25");
  return `${path}?${query}`;
}
export class CustomerAdminApi {
  constructor(private request: typeof adminRequest = adminRequest) {}
  async read<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const value = await this.request<unknown>(path, body);
    const result = schema.safeParse(value);
    if (!result.success) throw new AdminError("invalid_response");
    return result.data;
  }
  async commit<T>(change: CustomerChange<object>, schema: z.ZodType<T>) {
    const result = await this.read(change.path, schema, change.body);
    const body = change.body as Record<string, unknown>;
    const segments = change.path.split("/");
    if (result && typeof result === "object") {
      const receipt = result as Record<string, unknown>;
      if (
        "batchId" in receipt &&
        (receipt.batchId !== segments[1] ||
          receipt.format !== body.format ||
          receipt.batchVersion !== body.expectedVersion)
      )
        throw new AdminError("invalid_response");
      if ("batchCode" in receipt) {
        if (segments.length === 1) {
          if (
            receipt.name !== body.name ||
            receipt.total !== String(body.count) ||
            receipt.status !== "generated"
          )
            throw new AdminError("invalid_response");
        } else if (
          receipt.id !== segments[1] ||
          receipt.version !== (body.expectedVersion as number) + 1 ||
          receipt.status !==
            (segments[2] === "mark-printed" ? "printed" : "active")
        )
          throw new AdminError("invalid_response");
      }
    }
    return result;
  }
}
const mime = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
/** Return bytes only after the final live account/permission/route check. Never returns a storage URL. */
export async function customerFile(
  batchId: string,
  exportId: string,
  format: keyof typeof mime,
  live: () => boolean,
): Promise<Blob> {
  if (!live()) throw new AdminError("obsolete");
  let response: Response;
  try {
    response = await fetch(
      `/api/admin/card-batches/${encodeURIComponent(batchId)}/exports/${encodeURIComponent(exportId)}/file`,
      {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      },
    );
  } catch {
    throw new AdminError("network");
  }
  if (!live()) throw new AdminError("obsolete");
  if (!response.ok) {
    let code = "unavailable";
    try {
      const value = await response.json();
      if (typeof value?.error?.code === "string") code = value.error.code;
    } catch {}
    throw new AdminError(code, response.status);
  }
  if (
    response.headers.get("content-type")?.split(";")[0]?.trim() !== mime[format]
  )
    throw new AdminError("invalid_response");
  const blob = await response.blob();
  const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  const valid =
    format === "pdf"
      ? String.fromCharCode(...signature).startsWith("%PDF-")
      : signature[0] === 80 &&
        signature[1] === 75 &&
        signature[2] === 3 &&
        signature[3] === 4;
  if (!valid) throw new AdminError("invalid_response");
  if (!live()) throw new AdminError("obsolete");
  return blob;
}
const messages: Record<string, string> = {
  print_layout_unconfigured:
    "The print layout is not configured. PDF preparation is unavailable. Excel register remains available.",
  no_printable_cards: "There are no unassigned cards to print in this batch.",
  export_not_ready: "This export is still being prepared.",
  export_expired: "This file has expired. Prepare a new export.",
  export_failed:
    "File preparation failed. Retry the same preparation or prepare a new export.",
  version_conflict:
    "This batch changed. Reload the batch and review a new change.",
  invalid_transition:
    "This status change is no longer available. Reload the batch.",
  invalid_response:
    "The result could not be verified. Retry the same request; do not assume it failed.",
  batch_size_invalid: "Enter a whole number from 1 to 1000.",
  obsolete: "This request is no longer current.",
};
export const customerMessage = (error: unknown) =>
  error instanceof AdminError
    ? (messages[error.code] ?? error.message)
    : "This request could not be completed. Check your connection and try again.";

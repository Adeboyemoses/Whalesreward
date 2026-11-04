import { v7 as uuidv7 } from "uuid";
import type { AttendantApi } from "../api";
import {
  ClientError,
  saleStatusSchema,
  uploadPermissionSchema,
  type OutboxRow,
  type Session,
  type SyncResult,
} from "../types";
import { CaptureDatabase } from "./db";
import { authoritativeStatus } from "./sync-status";

const LEASE_MS = 60000;
type Bookkeeping = Pick<
  OutboxRow,
  | "state"
  | "purchaseId"
  | "serverVersion"
  | "serverStatus"
  | "uploadOperationId"
  | "uploadId"
  | "finalizeRequest"
  | "attempts"
  | "nextAttemptAt"
  | "lastErrorCode"
  | "syncLease"
>;
type Dependencies = {
  api: AttendantApi;
  db: CaptureDatabase;
  now: () => number;
  authorize: (readOnly: boolean) => Promise<Session>;
  lock: (session: Session) => Promise<void>;
  changed: () => void;
};
/** Every state mutation is scoped to the account, context and still-owned lease. */
export class SaleSynchronizer {
  private active: Promise<void> | null = null;
  private controllers = new Set<AbortController>();
  constructor(private d: Dependencies) {}
  stop() {
    for (const controller of this.controllers) controller.abort();
  }
  run(operationId?: string, readOnly = false): Promise<void> {
    if (this.active) return this.active;
    this.active = this.pass(operationId, readOnly).finally(() => {
      this.active = null;
    });
    return this.active;
  }
  private async pass(operationId?: string, readOnly = false) {
    let session: Session;
    try {
      session = await this.d.authorize(readOnly);
    } catch {
      return;
    }
    const rows = await this.d.db.outbox
      .where("[originatingAccountId+operationId]")
      .between([session.account.id, ""], [session.account.id, "\uffff"])
      .toArray();
    for (const row of rows) {
      if (operationId && row.operationId !== operationId) continue;
      if (row.nextAttemptAt && Date.parse(row.nextAttemptAt) > this.d.now())
        continue;
      const status = authoritativeStatus(row);
      if (
        !readOnly &&
        (status?.state === "credited" ||
          status?.state === "cancelled" ||
          row.state === "needs_attention")
      )
        continue;
      const controller = new AbortController();
      this.controllers.add(controller);
      try {
        await this.syncOne(session, row, controller.signal, readOnly);
      } finally {
        this.controllers.delete(controller);
      }
    }
  }
  private async syncOne(
    session: Session,
    originalRow: OutboxRow,
    signal: AbortSignal,
    readOnly: boolean,
  ) {
    const { db, api } = this.d;
    const key: [string, string] = [session.account.id, originalRow.operationId];
    const owner = uuidv7();
    let row = originalRow;
    const guard = async () => {
      if (signal.aborted)
        throw new ClientError("sync_paused", "Uploads paused.");
      const current = await this.d.authorize(readOnly);
      if (
        current.account.id !== session.account.id ||
        current.captureContextId !== session.captureContextId
      )
        throw new ClientError("account_changed", "Account changed.");
    };
    const inContext = async () => {
      const meta = await db.meta.get("installation");
      const window = await db.windows.get(session.account.id);
      return (
        !signal.aborted &&
        meta?.activeAccountId === session.account.id &&
        !meta.logoutPending &&
        !meta.signInAttempt &&
        !!window &&
        !window.logoutPending &&
        (readOnly || !window.locked) &&
        window.captureContextId === session.captureContextId
      );
    };
    const patch = async (changes: Partial<Bookkeeping>) => {
      await guard();
      row = await db.transaction(
        "rw",
        db.meta,
        db.windows,
        db.outbox,
        async () => {
          const stored = await db.outbox.get(key);
          if (
            !(await inContext()) ||
            !stored ||
            stored.syncLease?.owner !== owner ||
            Date.parse(stored.syncLease.expiresAt) <= this.d.now()
          )
            throw new ClientError("sync_paused", "Uploads paused.");
          const next = {
            ...stored,
            ...changes,
            syncLease: {
              owner,
              expiresAt: new Date(this.d.now() + LEASE_MS).toISOString(),
            },
          };
          await db.outbox.put(next);
          return next;
        },
      );
      this.d.changed();
    };
    const request = async <T>(call: () => Promise<T>): Promise<T> => {
      await patch({}); // Revalidate authority and extend the owned lease before each network call.
      const value = await call();
      await guard();
      return value;
    };
    const accept = async (result: SyncResult) => {
      const parsed = saleStatusSchema.safeParse(result.status);
      if (
        !parsed.success ||
        parsed.data.operationId !== row.operationId ||
        (row.purchaseId && parsed.data.purchaseId !== row.purchaseId) ||
        (row.serverVersion && parsed.data.version < row.serverVersion)
      )
        throw new ClientError(
          "invalid_response",
          "The service returned an invalid sale status.",
        );
      const status = parsed.data;
      const terminal = ["credited", "held", "cancelled"].includes(status.state);
      // The immutable finalize body is deliberately never derived from this mutable version again.
      await patch({
        serverStatus: status,
        purchaseId: status.purchaseId,
        serverVersion: status.version,
        state: status.state === "received" ? "submitting" : status.state,
        lastErrorCode: null,
        attempts: 0,
        nextAttemptAt: terminal
          ? status.state === "held"
            ? new Date(this.d.now() + 30000).toISOString()
            : null
          : result.retryAfterMs
            ? new Date(this.d.now() + result.retryAfterMs).toISOString()
            : null,
      });
      return (
        terminal || (result.retryAfterMs !== null && result.retryAfterMs > 0)
      );
    };
    try {
      await guard();
      const claimed = await db.transaction(
        "rw",
        db.meta,
        db.windows,
        db.outbox,
        async () => {
          if (!(await inContext())) return false;
          const stored = await db.outbox.get(key);
          if (
            !stored ||
            (stored.syncLease &&
              Date.parse(stored.syncLease.expiresAt) > this.d.now()) ||
            (stored.nextAttemptAt &&
              Date.parse(stored.nextAttemptAt) > this.d.now())
          )
            return false;
          row = {
            ...stored,
            syncLease: {
              owner,
              expiresAt: new Date(this.d.now() + LEASE_MS).toISOString(),
            },
          };
          await db.outbox.put(row);
          return true;
        },
      );
      if (!claimed) return;
      // Every interrupted/unknown stage reconciles before sending more bytes or retrying a write.
      if (
        readOnly ||
        row.state !== "saved" ||
        row.purchaseId ||
        row.attempts > 0
      ) {
        try {
          if (
            await accept(
              await request(() => api.saleStatus(row.operationId, signal)),
            )
          )
            return;
          if (readOnly) return;
        } catch (error) {
          if (
            readOnly &&
            error instanceof ClientError &&
            error.code === "sale_not_found" &&
            !row.purchaseId
          )
            return;
          if (!(
            error instanceof ClientError &&
            error.code === "sale_not_found" &&
            !row.purchaseId &&
            !readOnly
          ))
            throw error;
        }
      }
      if (!row.purchaseId) {
        await patch({ state: "submitting" });
        if (
          await accept(
            await request(() => api.submitSale(row.original, signal)),
          )
        )
          return;
      }
      if (
        row.serverStatus?.state === "received" ||
        row.serverStatus?.state === "finalizing"
      ) {
        await patch({
          nextAttemptAt: new Date(
            this.d.now() +
              Math.max(
                1000,
                row.serverStatus.state === "finalizing" ? 6000 : 1000,
              ),
          ).toISOString(),
        });
        return;
      }
      if (!row.purchaseId || row.serverVersion === null) return;
      if (!row.finalizeRequest) {
        await patch({
          state: "photo_pending",
          uploadOperationId: row.uploadOperationId ?? uuidv7(),
        });
        let permission;
        try {
          permission = uploadPermissionSchema.parse(
            await request(() =>
              api.uploadPermission(
                row.purchaseId!,
                {
                  operationId: row.uploadOperationId!,
                  sha256: row.original.photo.sha256,
                  bytes: row.original.photo.bytes,
                  mediaType: "image/jpeg",
                },
                signal,
              ),
            ),
          );
        } catch (error) {
          if (
            error instanceof ClientError &&
            error.code === "upload_permission_expired"
          ) {
            // Do not change the sale identity or photo; only an expired permission gets a new key.
            await patch({ uploadOperationId: uuidv7(), uploadId: null });
          }
          throw error;
        }
        if (
          row.photoBlob.size !== row.original.photo.bytes ||
          permission.maxBytes < row.photoBlob.size
        )
          throw new ClientError(
            "photo_metadata_invalid",
            "Saved photo does not match its metadata.",
            422,
          );
        await patch({ state: "uploading", uploadId: permission.uploadId });
        await request(() => api.uploadPhoto(permission, row.photoBlob, signal));
        // Persist before first finalize, so a reload always replays this exact body and key.
        await patch({
          state: "finalizing",
          finalizeRequest: {
            operationId: uuidv7(),
            uploadId: permission.uploadId,
            expectedVersion: row.serverVersion!,
          },
        });
      }
      try {
        if (
          !(await accept(
            await request(() =>
              api.finalizeSale(row.purchaseId!, row.finalizeRequest!, signal),
            ),
          ))
        )
          await patch({
            nextAttemptAt: new Date(this.d.now() + 6000).toISOString(),
          });
      } catch (error) {
        if (error instanceof ClientError && error.code === "stale_version") {
          // A definitive rejection permits a new finalize key, but only after authoritative reconciliation.
          if (
            await accept(
              await request(() => api.saleStatus(row.operationId, signal)),
            )
          )
            return;
          if (row.serverStatus?.state === "photo_pending")
            await patch({
              finalizeRequest: {
                ...row.finalizeRequest!,
                operationId: uuidv7(),
                expectedVersion: row.serverVersion!,
              },
            });
        }
        throw error;
      }
    } catch (error) {
      const failure =
        error instanceof ClientError
          ? error
          : new ClientError(
              "invalid_response",
              "Could not verify the service response.",
            );
      if (
        failure.status === 401 ||
        failure.status === 403 ||
        [
          "unauthenticated",
          "permission_denied",
          "online_sign_in_required",
        ].includes(failure.code)
      ) {
        await this.d.lock(session);
        return;
      }
      if (
        [
          "sync_paused",
          "account_changed",
          "access_expired",
          "offline",
        ].includes(failure.code) ||
        signal.aborted
      )
        return;
      try {
        const permanent =
          failure.status === 422 ||
          (failure.status === 409 &&
            ![
              "upload_permission_expired",
              "stale_version",
              "sale_not_uploadable",
            ].includes(failure.code)) ||
          [
            "operation_conflict",
            "photo_invalid",
            "photo_metadata_invalid",
            "policy_review_required",
          ].includes(failure.code);
        const attempts = row.attempts + 1;
        const backoff =
          Math.min(60000, 1000 * 2 ** Math.min(attempts - 1, 6)) *
          (1 + Math.random() * 0.2);
        const delay = Math.max(
          Math.min(60000, backoff),
          failure.retryAfterMs ?? 0,
          row.purchaseId ? 6000 : 1000,
        );
        await patch({
          state: permanent ? "needs_attention" : row.state,
          attempts,
          lastErrorCode: failure.code,
          nextAttemptAt: permanent
            ? null
            : new Date(this.d.now() + delay).toISOString(),
        });
      } catch {
        /* Handover, lease loss or storage failure preserves the last durable stage. */
      }
    } finally {
      // Releasing our lease is safe after sign-out; no receipt/stage can be changed here.
      await db.transaction("rw", db.outbox, async () => {
        const stored = await db.outbox.get(key);
        if (stored?.syncLease?.owner === owner)
          await db.outbox.update(key, { syncLease: null });
      });
      this.d.changed();
    }
  }
}

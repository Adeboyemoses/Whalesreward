import { v7 } from "uuid";
import { ClientError, type Session } from "../types";
import type { AttendantSalesApi } from "../sales-api";
import {
  attendantCorrectionSchema,
  correctionSubmissionSchema,
} from "../../shared/contracts/sales";
import { CaptureDatabase } from "./db";
import { numericCorrection, valuesDigest } from "./correction-values";
import type { CorrectionOutboxRow } from "./correction-types";
const LEASE_MS = 60000;
type Dependencies = {
  api: AttendantSalesApi;
  db: CaptureDatabase;
  now: () => number;
  authorize: () => Promise<Session>;
  lock: (session: Session, code: string) => Promise<void>;
  changed: () => void;
};
type Mutable = Pick<
  CorrectionOutboxRow,
  | "purchaseId"
  | "basedOnRevisionId"
  | "evidenceAssetId"
  | "submission"
  | "serverCorrection"
  | "state"
  | "attempts"
  | "nextAttemptAt"
  | "lastErrorCode"
>;
/** Original-first, same-account, lease-fenced transport. The frozen request is never rebased. */
export class CorrectionSynchronizer {
  private active: Promise<void> | null = null;
  private controllers = new Set<AbortController>();
  constructor(private d: Dependencies) {}
  stop() {
    for (const c of this.controllers) c.abort();
  }
  run(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.pass().finally(() => {
      this.active = null;
    });
    return this.active;
  }
  private async pass() {
    let session: Session;
    try {
      session = await this.d.authorize();
    } catch {
      return;
    }
    const rows = await this.d.db.corrections
      .where("[originatingAccountId+operationId]")
      .between([session.account.id, ""], [session.account.id, "\uffff"])
      .toArray();
    for (const row of rows) {
      if (
        ["accepted", "rejected", "needs_attention"].includes(row.state) ||
        (row.nextAttemptAt && Date.parse(row.nextAttemptAt) > this.d.now())
      )
        continue;
      const controller = new AbortController();
      this.controllers.add(controller);
      try {
        await this.syncOne(session, row, controller.signal);
      } finally {
        this.controllers.delete(controller);
      }
    }
  }
  private async syncOne(
    session: Session,
    initial: CorrectionOutboxRow,
    signal: AbortSignal,
  ) {
    const { db, api } = this.d;
    const key: [string, string] = [session.account.id, initial.operationId];
    const owner = v7();
    let row = initial;
    const guard = async () => {
      if (signal.aborted)
        throw new ClientError("sync_paused", "Uploads paused.");
      const active = await this.d.authorize();
      if (
        active.account.id !== session.account.id ||
        active.captureContextId !== session.captureContextId
      )
        throw new ClientError("account_changed", "Account changed.");
    };
    const context = async () => {
      const m = await db.meta.get("installation");
      const w = await db.windows.get(session.account.id);
      return (
        !signal.aborted &&
        m?.activeAccountId === session.account.id &&
        !m.logoutPending &&
        !m.signInAttempt &&
        !!w &&
        !w.locked &&
        !w.logoutPending &&
        w.captureContextId === session.captureContextId
      );
    };
    const patch = async (changes: Partial<Mutable>) => {
      await guard();
      row = await db.transaction(
        "rw",
        db.meta,
        db.windows,
        db.corrections,
        async () => {
          const old = await db.corrections.get(key);
          if (
            !(await context()) ||
            !old ||
            old.syncLease?.owner !== owner ||
            Date.parse(old.syncLease.expiresAt) <= this.d.now()
          )
            throw new ClientError("sync_paused", "Uploads paused.");
          // No caller can replace the request after the first durable binding.
          if (
            old.submission &&
            changes.submission &&
            JSON.stringify(old.submission) !==
              JSON.stringify(changes.submission)
          )
            throw new ClientError(
              "operation_conflict",
              "Correction request changed.",
            );
          const next = {
            ...old,
            ...changes,
            syncLease: {
              owner,
              expiresAt: new Date(this.d.now() + LEASE_MS).toISOString(),
            },
          };
          await db.corrections.put(next);
          return next;
        },
      );
      this.d.changed();
    };
    const request = async <T>(call: () => Promise<T>) => {
      await patch({});
      const r = await call();
      await guard();
      return r;
    };
    const accept = async (value: unknown) => {
      const result = attendantCorrectionSchema.safeParse(value);
      if (
        !result.success ||
        !row.submission ||
        result.data.purchaseId !== row.purchaseId ||
        result.data.operationId !== row.operationId ||
        result.data.basedOnRevisionId !== row.submission.basedOnRevisionId ||
        result.data.reason !== row.reason ||
        (row.serverCorrection &&
          result.data.version < row.serverCorrection.version)
      )
        throw new ClientError(
          "invalid_response",
          "Could not verify the correction receipt.",
        );
      const response = result.data;
      const proposed = numericCorrection(
        row.baseValues,
        row.edit.basis === "amount"
          ? `${BigInt(row.edit.enteredAmountKobo) / 100n}.${(BigInt(row.edit.enteredAmountKobo) % 100n).toString().padStart(2, "0")}`
          : row.edit.enteredQuantity,
      ).values;
      if (
        (await valuesDigest(response.proposed)) !==
        (await valuesDigest(proposed))
      )
        throw new ClientError(
          "invalid_response",
          "The correction receipt does not match the saved values.",
        );
      await patch({
        serverCorrection: response,
        state: response.state,
        attempts: 0,
        lastErrorCode: null,
        nextAttemptAt: ["accepted", "rejected"].includes(response.state)
          ? null
          : new Date(
              this.d.now() +
                (response.state === "pending_validation" ? 2000 : 30000),
            ).toISOString(),
      });
    };
    try {
      await guard();
      const claimed = await db.transaction(
        "rw",
        db.meta,
        db.windows,
        db.corrections,
        async () => {
          const old = await db.corrections.get(key);
          if (
            !(await context()) ||
            !old ||
            (old.syncLease &&
              Date.parse(old.syncLease.expiresAt) > this.d.now()) ||
            (old.nextAttemptAt && Date.parse(old.nextAttemptAt) > this.d.now())
          )
            return false;
          row = {
            ...old,
            syncLease: {
              owner,
              expiresAt: new Date(this.d.now() + LEASE_MS).toISOString(),
            },
          };
          await db.corrections.put(row);
          return true;
        },
      );
      if (!claimed) return;
      if (!row.purchaseId) {
        const original = await db.outbox.get([
          session.account.id,
          row.originalOperationId,
        ]);
        if (
          !original?.purchaseId ||
          !original.serverStatus?.currentRevisionId
        ) {
          await patch({
            state: "waiting_original",
            nextAttemptAt: new Date(this.d.now() + 2000).toISOString(),
          });
          return;
        }
        await patch({ purchaseId: original.purchaseId });
      }
      // Reconcile before first send as well as retries. No sale version check precedes replay.
      try {
        await accept(
          await request(() =>
            api.correction(row.purchaseId!, row.operationId, signal),
          ),
        );
        return;
      } catch (error) {
        if (!(
          error instanceof ClientError &&
          error.code === "not_found" &&
          error.status === 404 &&
          !row.serverCorrection
        ))
          throw error;
      }
      if (!row.submission) {
        const detail = await request(() => api.detail(row.purchaseId!, signal));
        if (
          detail.id !== row.purchaseId ||
          detail.operationId !== row.originalOperationId ||
          detail.seller.attendantId !== session.account.id
        )
          throw new ClientError(
            "invalid_response",
            "Could not verify the original sale.",
          );
        if (!detail.currentRevisionId) {
          await patch({
            state: "waiting_original",
            nextAttemptAt: new Date(this.d.now() + 2000).toISOString(),
          });
          return;
        }
        if (
          detail.displayedValues.calculation !== "captured_rate" ||
          detail.state === "cancelled"
        )
          throw new ClientError(
            "sale_not_correctable",
            "This sale cannot be corrected here.",
            409,
          );
        if (
          (await valuesDigest(detail.displayedValues)) !== row.baseValuesDigest
        )
          throw new ClientError(
            "base_revision_changed",
            "The accepted original changed. Review it again.",
            409,
          );
        if (detail.correctionPending)
          throw new ClientError(
            "correction_pending",
            "Another correction is already pending.",
            409,
          );
        if (
          detail.evidence.state !== "validated" ||
          !detail.evidence.assetId ||
          detail.evidence.sha256 !== row.photoDigest
        )
          throw new ClientError(
            "evidence_unavailable",
            "The retained original photo is unavailable.",
            422,
          );
        const submission = correctionSubmissionSchema.parse({
          operationId: row.operationId,
          expectedVersion: detail.version,
          basedOnRevisionId: detail.currentRevisionId,
          edit: row.edit,
          evidenceAssetId: detail.evidence.assetId,
          reason: row.reason,
        });
        await patch({
          basedOnRevisionId: detail.currentRevisionId,
          evidenceAssetId: detail.evidence.assetId,
          submission,
        });
      }
      await patch({ state: "submitting", attempts: row.attempts + 1 });
      await accept(
        await request(() =>
          api.submitCorrection(row.purchaseId!, row.submission!, signal),
        ),
      );
    } catch (error) {
      const e =
        error instanceof ClientError
          ? error
          : new ClientError(
              "invalid_response",
              "Could not verify the service response.",
            );
      if (
        e.status === 401 ||
        e.status === 403 ||
        [
          "unauthenticated",
          "permission_denied",
          "online_sign_in_required",
        ].includes(e.code)
      ) {
        await this.d.lock(session, e.code);
        return;
      }
      if (
        signal.aborted ||
        [
          "sync_paused",
          "account_changed",
          "access_expired",
          "offline",
        ].includes(e.code)
      )
        return;
      try {
        const permanent =
          (e.status === 409 || e.status === 422) && !e.retryable;
        const attempts = row.attempts + 1;
        await patch({
          state: permanent ? "needs_attention" : row.state,
          attempts,
          lastErrorCode: e.code,
          nextAttemptAt: permanent
            ? null
            : new Date(
                this.d.now() +
                  Math.max(
                    e.retryAfterMs ?? 0,
                    Math.min(60000, 1000 * 2 ** Math.min(attempts, 6)),
                  ),
              ).toISOString(),
        });
      } catch {
        /* Account change or storage failure preserves the last durable state. */
      }
    } finally {
      await db.transaction("rw", db.corrections, async () => {
        const old = await db.corrections.get(key);
        if (old?.syncLease?.owner === owner)
          await db.corrections.update(key, { syncLease: null });
      });
      this.d.changed();
    }
  }
}

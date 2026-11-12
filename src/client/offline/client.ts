import { v7 as uuidv7 } from "uuid";
import { HttpAttendantApi, type AttendantApi } from "../api";
import {
  ClientError,
  normalizeCardCode,
  sessionSchema,
  authSessionSchema,
  lookupResponseSchema,
  isRestricted,
  type RestrictedSession,
  type FirstPasswordInput,
  type ConfiguredAssignment,
  type Session,
  type Lookup,
  type PriceRefresh,
  type OutboxRow,
  type OfflineWindow,
  type ClientState,
  type CaptureDraft,
  type CaptureInput,
} from "../types";
import { CaptureDatabase, type Installation } from "./db";
import { SaleSynchronizer } from "./sync";
import { needsUpload } from "./sync-status";
import { CorrectionSynchronizer } from "./corrections";
import { HttpAttendantSalesApi, type AttendantSalesApi } from "../sales-api";
import {
  attendantSaleDetailSchema,
  correctionSubmissionSchema,
} from "../../shared/contracts/sales";
import {
  localValues,
  numericCorrection,
  valuesDigest,
} from "./correction-values";
import {
  pendingCorrection,
  correctionNeedsUpload,
  type CorrectionOutboxRow,
  type SaveCorrectionInput,
} from "./correction-types";
export type {
  CorrectionOutboxRow,
  SaveCorrectionInput,
} from "./correction-types";
import { connection } from "./connection";
import {
  advanceWindow,
  requestDuration,
  type ClockSample,
  type MonotonicBaseline,
} from "./window";
import { parseNaira, parseKobo } from "../../shared/money";
import {
  amountToQuantity,
  quantityToAmount,
  parseQuantity,
  QUANTITY_SCALE,
} from "../../shared/quantity";
export type {
  ClientState,
  CaptureDraft,
  CapturedPhoto,
  Session,
  Lookup,
  OutboxRow,
  CaptureInput,
  Medium,
} from "../types";
export { ClientError } from "../types";
export class AttendantClient {
  private state: ClientState = {
    session: null,
    access: "signed_out",
    logoutPending: false,
  };
  private listeners = new Set<() => void>();
  private runtimeId = uuidv7();
  private baselines = new Map<string, MonotonicBaseline>();
  private channel: BroadcastChannel | null = null;
  private checking: Promise<ClientState> | null = null;
  private authEpoch = 0;
  private restricted: {
    session: RestrictedSession;
    attempt: string;
    started: ClockSample;
    duration: number;
  } | null = null;
  private accessNotice: string | null = null;
  private salesListeners = new Set<() => void>();
  private foregroundCleanup: (() => void) | null = null;
  private synchronizer: SaleSynchronizer;
  private correctionSynchronizer: CorrectionSynchronizer;

  constructor(
    private api: AttendantApi = new HttpAttendantApi(),
    private db = new CaptureDatabase(),
    private clock: () => ClockSample = () => ({
      wall: Date.now(),
      mono: performance.now(),
      runtimeId: this.runtimeId,
    }),
    private online: () => boolean = () =>
      typeof navigator === "undefined" || navigator.onLine,
    private reachable: () => boolean = online,
    private salesApi: AttendantSalesApi = new HttpAttendantSalesApi(),
  ) {
    this.synchronizer = new SaleSynchronizer({
      api,
      db,
      now: () => this.clock().wall,
      authorize: async (readOnly) => {
        if (!this.reachable())
          throw new ClientError("offline", "Uploads pause while offline.");
        const state = await this.checkAccess();
        if (!state.session || (!readOnly && state.access !== "active"))
          throw new ClientError(
            "access_expired",
            "Sign in online again to upload.",
          );
        const window = await this.db.windows.get(state.session.account.id);
        if (
          !window ||
          Date.parse(window.lastOnlineSignInAt) +
            window.elapsedAtCheckpointMs >=
            Date.parse(state.session.sessionExpiresAt)
        ) {
          await this.lockContext(state.session);
          throw new ClientError(
            "access_expired",
            "Sign in online again to upload.",
          );
        }
        return state.session;
      },
      lock: async (session, code) => {
        await this.lockContext(session, code !== "online_sign_in_required");
      },
      changed: () => this.salesChanged(),
    });
    this.correctionSynchronizer = new CorrectionSynchronizer({
      api: this.salesApi,
      db,
      now: () => this.clock().wall,
      authorize: () => this.authorizeCorrectionSync(),
      lock: async (session, code) => {
        await this.lockContext(session, code !== "online_sign_in_required");
      },
      changed: () => this.salesChanged(),
    });
    if (
      typeof window !== "undefined" &&
      typeof BroadcastChannel !== "undefined"
    ) {
      this.channel = new BroadcastChannel("whales-capture-state");
      this.channel.onmessage = () => {
        for (const listener of this.salesListeners) listener();
        void this.checkAccess().catch(() =>
          this.publish({
            session: null,
            access: "signed_out",
            logoutPending: true,
          }),
        );
      };
    }
  }
  getState = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(state: ClientState) {
    this.state =
      state.access === "signed_out" && this.accessNotice
        ? { ...state, notice: this.accessNotice }
        : state;
    for (const listener of this.listeners) listener();
  }
  subscribeSales = (listener: () => void) => {
    this.salesListeners.add(listener);
    return () => {
      this.salesListeners.delete(listener);
    };
  };
  private salesChanged() {
    for (const listener of this.salesListeners) listener();
    this.signal();
  }
  async retryUploads() {
    await this.synchronizer.run();
    await this.correctionSynchronizer.run();
  }
  private async authorizeCorrectionSync(): Promise<Session> {
    if (!this.reachable())
      throw new ClientError("offline", "Uploads pause while offline.");
    const session = await this.active();
    const window = await this.db.windows.get(session.account.id);
    if (
      !window ||
      Date.parse(window.lastOnlineSignInAt) + window.elapsedAtCheckpointMs >=
        Date.parse(session.sessionExpiresAt)
    ) {
      await this.lockContext(session);
      throw new ClientError(
        "access_expired",
        "Sign in online again to upload.",
      );
    }
    return session;
  }
  refreshSale(operationId: string) {
    return this.synchronizer.run(operationId, true);
  }
  startForegroundSync(): () => void {
    if (this.foregroundCleanup) return this.foregroundCleanup;
    const run = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      )
        return;
      void this.retryUploads().catch(() => {
        /* Durable row survives storage/service interruption. */
      });
    };
    const pause = () => {
      this.synchronizer.stop();
      this.correctionSynchronizer.stop();
    };
    const interval = setInterval(run, 1000);
    if (typeof window !== "undefined") {
      window.addEventListener("online", run);
      window.addEventListener("offline", pause);
      window.addEventListener("focus", run);
      document.addEventListener("visibilitychange", run);
    }
    run();
    this.foregroundCleanup = () => {
      clearInterval(interval);
      pause();
      if (typeof window !== "undefined") {
        window.removeEventListener("online", run);
        window.removeEventListener("offline", pause);
        window.removeEventListener("focus", run);
        document.removeEventListener("visibilitychange", run);
      }
      this.foregroundCleanup = null;
    };
    return this.foregroundCleanup;
  }
  private signal() {
    this.channel?.postMessage("changed");
  }
  private async installation(signInAttempt?: string): Promise<Installation> {
    return this.db.transaction(
      "rw",
      this.db.meta,
      this.db.windows,
      async () => {
        const found = await this.db.meta.get("installation");
        if (found) {
          if (signInAttempt === undefined) return found;
          if (found.activeAccountId)
            await this.db.windows.update(found.activeAccountId, {
              locked: true,
            });
          const claimed = {
            ...found,
            activeAccountId: null,
            signInAttempt,
            authGeneration: signInAttempt,
          };
          await this.db.meta.put(claimed);
          return claimed;
        }
        const row: Installation = {
          key: "installation",
          deviceId: uuidv7(),
          activeAccountId: null,
          logoutPending: false,
          logoutOperationId: null,
          signInAttempt: signInAttempt ?? null,
          authGeneration: signInAttempt ?? uuidv7(),
        };
        await this.db.meta.add(row);
        return row;
      },
    );
  }
  async initialize() {
    await this.installation();
    return this.checkAccess();
  }
  async checkAccess(): Promise<ClientState> {
    if (this.checking) return this.checking;
    this.checking = this.readAccess();
    try {
      return await this.checking;
    } finally {
      this.checking = null;
    }
  }
  private async readAccess(): Promise<ClientState> {
    const epoch = this.authEpoch;
    const result = await this.db.transaction(
      "rw",
      this.db.meta,
      this.db.windows,
      async () => {
        const meta = await this.db.meta.get("installation");
        if (
          this.restricted &&
          meta?.signInAttempt === this.restricted.attempt &&
          !meta.activeAccountId &&
          !meta.logoutPending
        ) {
          const elapsed = requestDuration(
            this.restricted.started,
            this.clock(),
          );
          if (elapsed !== null && elapsed < this.restricted.duration)
            return {
              session: null,
              access: "password_change_required" as const,
              logoutPending: false,
              restrictedSession: this.restricted.session,
              restrictionId: this.restricted.attempt,
            };
          this.restricted = null;
          this.accessNotice =
            "Your password-change session ended. Sign in online again.";
          await this.db.meta.update("installation", { signInAttempt: null });
        } else if (this.restricted) this.restricted = null;
        if (!meta?.activeAccountId || meta.logoutPending)
          return {
            session: null,
            access: "signed_out" as const,
            logoutPending: meta?.logoutPending ?? false,
          };
        const row = await this.db.windows.get(meta.activeAccountId);
        if (!row || row.logoutPending)
          return {
            session: null,
            access: "signed_out" as const,
            logoutPending: row?.logoutPending ?? false,
          };
        const now = this.clock();
        const next = this.advance(row, now);
        await this.db.windows.put(next);
        return {
          session: next.session,
          access: next.locked ? ("expired" as const) : ("active" as const),
          logoutPending: false,
        };
      },
    );
    if (epoch !== this.authEpoch) return this.state;
    this.publish(result);
    return this.state;
  }
  private advance(row: OfflineWindow, now: ClockSample): OfflineWindow {
    const next = advanceWindow(
      row,
      now,
      this.baselines.get(row.originatingAccountId),
    );
    this.baselines.set(row.originatingAccountId, {
      captureContextId: row.captureContextId,
      runtimeId: now.runtimeId,
      mono: now.mono,
      elapsedMs: next.elapsedAtCheckpointMs,
    });
    return next;
  }
  private requireOnline() {
    if (!this.online())
      throw new ClientError(
        "offline",
        "Internet is required to sign in or switch accounts.",
      );
  }
  private async revokePending() {
    const meta = await this.installation();
    if (!meta.logoutPending) return;
    await this.api.signOut(meta.logoutOperationId ?? uuidv7());
    await this.db.transaction("rw", this.db.meta, async () => {
      const current = await this.db.meta.get("installation");
      if (current?.logoutOperationId === meta.logoutOperationId)
        await this.db.meta.update("installation", {
          logoutPending: false,
          logoutOperationId: null,
        });
    });
  }
  async signIn(username: string, password: string): Promise<ClientState> {
    this.requireOnline();
    this.synchronizer.stop();
    this.correctionSynchronizer.stop();
    const epoch = ++this.authEpoch;
    const attempt = uuidv7();
    // Claim the attempt in the first transaction, before any revocation/network wait.
    // Handover can invalidate this claim but this invocation never writes it again.
    const meta = await this.installation(attempt);
    if (epoch !== this.authEpoch) throw this.accountChanged();
    this.restricted = null;
    this.accessNotice = null;
    this.publish({
      session: null,
      access: "signed_out",
      logoutPending: meta.logoutPending,
    });
    await this.revokePending();
    const current = await this.db.meta.get("installation");
    if (
      epoch !== this.authEpoch ||
      current?.signInAttempt !== attempt ||
      current.logoutPending
    )
      throw this.accountChanged();
    // Explicit sign-in is the only operation that creates or unlocks an offline window.
    const requestStarted = this.clock();
    let response;
    try {
      response = authSessionSchema.parse(
        await this.api.signIn(
          { username: username.trim(), password, deviceId: meta.deviceId },
          attempt,
        ),
      );
    } catch (error) {
      if (
        epoch === this.authEpoch &&
        error instanceof ClientError &&
        [
          "assignment_unavailable",
          "unauthenticated",
          "permission_denied",
        ].includes(error.code)
      ) {
        const previous = this.state.session;
        if (previous) await this.lockContext(previous, true);
        else if (this.restricted) await this.clearRestricted();
        this.accessNotice =
          error.code === "assignment_unavailable"
            ? "Sign-in is unavailable. Ask a station manager for help."
            : "Your session ended. Sign in online again.";
        await this.checkAccess();
      }
      throw error;
    }
    if (isRestricted(response)) {
      await this.adoptRestricted(response, epoch, current, requestStarted);
      return this.checkAccess();
    }
    const session = response;
    const now = this.clock();
    const transit = requestDuration(requestStarted, now);
    const elapsed =
      Date.parse(session.serverTime) -
      Date.parse(session.lastOnlineSignInAt) +
      (transit ?? 0);
    const row: OfflineWindow = {
      schemaVersion: 1,
      originatingAccountId: session.account.id,
      deviceId: meta.deviceId,
      captureContextId: session.captureContextId,
      lastOnlineSignInAt: session.lastOnlineSignInAt,
      offlineExpiresAt: session.offlineExpiresAt,
      lastTrustedServerTime: session.serverTime,
      elapsedAtCheckpointMs: elapsed,
      wallTimeAtCheckpoint: new Date(now.wall).toISOString(),
      runtimeId: now.runtimeId,
      locked: transit === null || elapsed >= 86400000,
      logoutPending: false,
      session,
    };
    try {
      await this.db.transaction(
        "rw",
        this.db.meta,
        this.db.windows,
        async () => {
          const current = await this.db.meta.get("installation");
          if (
            epoch !== this.authEpoch ||
            current?.signInAttempt !== attempt ||
            current.logoutPending
          )
            throw new ClientError(
              "account_changed",
              "Another sign-in or sign-out occurred. Sign in again.",
            );
          if (
            current?.activeAccountId &&
            current.activeAccountId !== session.account.id
          )
            await this.db.windows.update(current.activeAccountId, {
              locked: true,
            });
          await this.db.windows.put(row);
          await this.db.meta.put({
            ...meta,
            activeAccountId: session.account.id,
            logoutPending: false,
            logoutOperationId: null,
            signInAttempt: null,
          });
        },
      );
    } catch (error) {
      // A delayed sign-in response may have set a cookie after a newer handover.
      // Revoke it and require fresh sign-in rather than restoring either view.
      if (error instanceof ClientError && error.code === "account_changed")
        await this.signOut();
      throw error;
    }
    if (epoch !== this.authEpoch) throw this.accountChanged();
    ++this.authEpoch;
    this.restricted = null;
    this.accessNotice = null;
    this.publish({
      session,
      access: row.locked ? "expired" : "active",
      logoutPending: false,
    });
    this.baselines.set(session.account.id, {
      captureContextId: session.captureContextId,
      runtimeId: now.runtimeId,
      mono: now.mono,
      elapsedMs: elapsed,
    });
    await this.requestPersistence();
    this.signal();
    return this.checkAccess();
  }
  private async adoptRestricted(
    session: RestrictedSession,
    epoch: number,
    expected: Installation,
    started: ClockSample,
  ) {
    const attempt = expected.signInAttempt ?? uuidv7();
    const elapsed = requestDuration(started, this.clock());
    const duration =
      Date.parse(session.sessionExpiresAt) -
      Date.parse(session.serverTime) -
      (elapsed ?? Infinity);
    if (duration <= 0)
      throw new ClientError(
        "unauthenticated",
        "Your password-change session ended. Sign in again.",
      );
    await this.db.transaction("rw", this.db.meta, this.db.windows, async () => {
      const meta = await this.db.meta.get("installation");
      if (
        epoch !== this.authEpoch ||
        !meta ||
        meta.logoutPending ||
        meta.activeAccountId !== expected.activeAccountId ||
        meta.signInAttempt !== expected.signInAttempt
      )
        throw this.accountChanged();
      if (meta.activeAccountId)
        await this.db.windows.update(meta.activeAccountId, { locked: true });
      await this.db.meta.update("installation", {
        activeAccountId: null,
        signInAttempt: attempt,
      });
    });
    if (epoch !== this.authEpoch) throw this.accountChanged();
    this.restricted = { session, attempt, started: this.clock(), duration };
    ++this.authEpoch;
    this.accessNotice = null;
    this.publish({
      session: null,
      access: "password_change_required",
      logoutPending: false,
      restrictedSession: session,
      restrictionId: attempt,
    });
    this.signal();
  }
  private async clearRestricted() {
    const restricted = this.restricted;
    if (!restricted) return false;
    return this.db.transaction("rw", this.db.meta, async () => {
      const meta = await this.db.meta.get("installation");
      if (
        this.restricted !== restricted ||
        meta?.signInAttempt !== restricted.attempt ||
        meta.activeAccountId
      )
        return false;
      await this.db.meta.update("installation", { signInAttempt: null });
      this.restricted = null;
      ++this.authEpoch;
      return true;
    });
  }
  async completeFirstPassword(input: FirstPasswordInput): Promise<ClientState> {
    this.requireOnline();
    const before = await this.checkAccess();
    const restricted = this.restricted;
    if (before.access !== "password_change_required" || !restricted)
      throw new ClientError(
        "unauthenticated",
        "Sign in online again to change your first password.",
      );
    const epoch = this.authEpoch;
    const invalid = /[\u0000-\u001f\u007f]/;
    if (
      !input.currentPassword ||
      input.currentPassword.length > 1024 ||
      invalid.test(input.currentPassword) ||
      input.newPassword.length < 12 ||
      input.newPassword.length > 1024 ||
      invalid.test(input.newPassword) ||
      input.newPassword === input.currentPassword
    )
      throw new ClientError(
        "password_policy",
        "Use a different password with 12 to 1024 characters and no control characters.",
      );
    if (input.newPassword !== input.confirmPassword)
      throw new ClientError("password_mismatch", "The passwords do not match.");
    try {
      await this.api.completeFirstPassword(input);
    } catch (error) {
      if (epoch !== this.authEpoch || this.restricted !== restricted)
        throw this.accountChanged();
      if (
        error instanceof ClientError &&
        [
          "unauthenticated",
          "permission_denied",
          "assignment_unavailable",
        ].includes(error.code)
      ) {
        await this.clearRestricted();
        this.accessNotice =
          "Your password-change session ended. Sign in online again.";
        await this.checkAccess();
      }
      throw error;
    }
    if (epoch !== this.authEpoch || this.restricted !== restricted)
      throw this.accountChanged();
    const cleared = await this.clearRestricted();
    if (!cleared || this.authEpoch !== epoch + 1 || this.restricted)
      throw this.accountChanged();
    this.accessNotice =
      "Password changed. Sign in online again before recording sales.";
    this.signal();
    return this.checkAccess();
  }
  async configuredAssignment(): Promise<ConfiguredAssignment> {
    const session = await this.active();
    const epoch = this.authEpoch;
    this.requireOnline();
    let result: ConfiguredAssignment;
    try {
      result = await this.api.configuredAssignment();
    } catch (error) {
      if (
        error instanceof ClientError &&
        [
          "unauthenticated",
          "permission_denied",
          "assignment_unavailable",
        ].includes(error.code)
      )
        await this.lockContext(session, true);
      throw error;
    }
    if (epoch !== this.authEpoch) throw this.accountChanged();
    await this.db.transaction("rw", this.db.meta, this.db.windows, async () => {
      if (epoch !== this.authEpoch) throw this.accountChanged();
      await this.assertCurrentContext(session);
      if (result.acknowledgedAssignmentId !== session.assignment.id)
        throw new ClientError(
          "invalid_response",
          "The assignment response changed. Sign in online again.",
        );
      if (result.reassignmentRequiresSignIn) {
        // Retain only the notice; the acknowledged capture context stays intact.
        const row = (await this.db.windows.get(session.account.id))!;
        await this.db.windows.update(session.account.id, {
          session: { ...row.session, reassignmentRequiresSignIn: true },
        });
      }
    });
    if (result.reassignmentRequiresSignIn) {
      this.signal();
      await this.checkAccess();
    }
    return result;
  }
  private accountChanged() {
    return new ClientError(
      "account_changed",
      "Another sign-in or sign-out occurred. Sign in again.",
    );
  }
  async signOut(): Promise<ClientState> {
    this.synchronizer.stop();
    this.correctionSynchronizer.stop();
    ++this.authEpoch;
    this.restricted = null;
    this.accessNotice = null;
    const key = uuidv7();
    await this.db.transaction("rw", this.db.meta, this.db.windows, async () => {
      const meta = await this.db.meta.get("installation");
      if (!meta) return;
      if (meta.activeAccountId)
        await this.db.windows.update(meta.activeAccountId, {
          locked: true,
          logoutPending: true,
        });
      await this.db.meta.put({
        ...meta,
        activeAccountId: null,
        logoutPending: true,
        logoutOperationId: key,
        signInAttempt: null,
        authGeneration: key,
      });
    });
    this.publish({ session: null, access: "signed_out", logoutPending: true });
    this.signal();
    if (this.online()) {
      try {
        await this.revokePending();
      } catch {
        /* Local lock survives failed or unknown server revocation. */
      }
    }
    return this.checkAccess();
  }
  async refresh(): Promise<ClientState> {
    const epoch = this.authEpoch;
    const before = await this.checkAccess();
    if (!this.online() || before.logoutPending) return before;
    const meta = await this.installation();
    if (epoch !== this.authEpoch) return this.state;
    const account = before.session?.account.id;
    const context = before.session?.captureContextId;
    const requestStarted = this.clock();
    try {
      const raw = await this.api.session();
      if (epoch !== this.authEpoch) return this.state;
      const parsed = authSessionSchema.safeParse(raw);
      if (!parsed.success) throw invalidPriceResponse();
      const response = parsed.data;
      if (epoch !== this.authEpoch) return this.state;
      if (isRestricted(response)) {
        if (
          this.restricted &&
          this.restricted.session.account.id === response.account.id &&
          this.restricted.session.sessionExpiresAt === response.sessionExpiresAt
        )
          return this.checkAccess();
        await this.adoptRestricted(response, epoch, meta, requestStarted);
        return this.checkAccess();
      }
      if (!before.session) {
        // A cookie alone cannot create an offline anchor. Only explicit sign-in can.
        if (this.restricted) await this.clearRestricted();
        return this.checkAccess();
      }
      const fresh = sessionSchema.parse(response);
      if (!sameCaptureContext(before.session, fresh)) {
        await this.lockContext(before.session, true, {
          epoch,
          generation: meta.authGeneration ?? null,
        });
        return this.checkAccess();
      }
      await this.db.transaction(
        "rw",
        this.db.meta,
        this.db.windows,
        async () => {
          if (epoch !== this.authEpoch) return;
          const current = await this.db.meta.get("installation");
          const row = await this.db.windows.get(account!);
          if (
            !current ||
            current.activeAccountId !== account ||
            current.logoutPending ||
            (current.authGeneration ?? null) !==
              (meta.authGeneration ?? null) ||
            !row ||
            row.captureContextId !== context ||
            row.logoutPending ||
            !sameCaptureContext(row.session, fresh)
          )
            return;
          if (
            fresh.lastOnlineSignInAt !== row.lastOnlineSignInAt ||
            fresh.offlineExpiresAt !== row.offlineExpiresAt
          ) {
            await this.db.windows.update(account!, { locked: true });
            return;
          }
          // Reconcile at this transaction's clock sample. Neither a slow response
          // nor another tab's checkpoint can move the existing anchor or elapsed time back.
          const now = this.clock();
          const transit = requestDuration(requestStarted, now);
          const advanced = this.advance(row, now);
          const trustedTime =
            Date.parse(fresh.serverTime) > Date.parse(row.lastTrustedServerTime)
              ? fresh.serverTime
              : row.lastTrustedServerTime;
          let next = this.advance(
            {
              ...advanced,
              session: {
                ...row.session,
                serverTime: trustedTime,
                // A same-context response may predate the configured-target read.
                // Only explicit sign-in acknowledges a new assignment.
                reassignmentRequiresSignIn:
                  row.session.reassignmentRequiresSignIn ||
                  fresh.reassignmentRequiresSignIn,
              },
              lastTrustedServerTime: trustedTime,
              elapsedAtCheckpointMs: Math.max(
                advanced.elapsedAtCheckpointMs,
                Date.parse(fresh.serverTime) -
                  Date.parse(row.lastOnlineSignInAt) +
                  (transit ?? 0),
              ),
              locked: advanced.locked || transit === null,
            },
            now,
          );
          if (!next.locked)
            next = {
              ...next,
              session: {
                ...next.session,
                price: adoptPrice(row.session.price, fresh.price),
              },
            };
          await this.db.windows.put(next);
        },
      );
      this.signal();
    } catch (error) {
      if (
        error instanceof ClientError &&
        [
          "unauthenticated",
          "permission_denied",
          "assignment_unavailable",
        ].includes(error.code)
      ) {
        if (epoch !== this.authEpoch) return this.state;
        if (before.session)
          await this.lockContext(before.session, true, {
            epoch,
            generation: meta.authGeneration ?? null,
          });
        else if (this.restricted) await this.clearRestricted();
      } else if (
        error instanceof ClientError &&
        ["invalid_response", "app_update_required"].includes(error.code)
      )
        throw error;
    }
    return this.checkAccess();
  }
  // Online modules report a denial against the context which issued the request.
  // The existing lock fences stale responses and retains every original/blob.
  async observeAuthorityError(error: unknown, session: Session): Promise<void> {
    if (
      error instanceof ClientError &&
      [
        "unauthenticated",
        "permission_denied",
        "assignment_unavailable",
        "online_sign_in_required",
        "password_change_required",
      ].includes(error.code)
    )
      await this.lockContext(session, true);
  }
  private async lockContext(
    session: Session,
    clearVisible = false,
    expected?: { epoch: number; generation: string | null },
  ) {
    const locked = await this.db.transaction(
      "rw",
      this.db.meta,
      this.db.windows,
      async () => {
        const meta = await this.db.meta.get("installation");
        const row = await this.db.windows.get(session.account.id);
        // An old response can revoke only the context that issued its request.
        if (
          meta?.activeAccountId === session.account.id &&
          row?.captureContextId === session.captureContextId &&
          (!expected ||
            (expected.epoch === this.authEpoch &&
              expected.generation === (meta.authGeneration ?? null)))
        ) {
          await this.db.windows.update(session.account.id, { locked: true });
          if (clearVisible) {
            await this.db.meta.update("installation", {
              activeAccountId: null,
              signInAttempt: null,
            });
            ++this.authEpoch;
            this.restricted = null;
            this.accessNotice =
              "Your session ended. Sign in online again. Pending sales and photos stay on this phone.";
            this.synchronizer.stop();
            this.correctionSynchronizer.stop();
          }
          return true;
        }
        return false;
      },
    );
    this.signal();
    await this.checkAccess();
    return locked;
  }
  private async active(): Promise<Session> {
    const state = await this.checkAccess();
    if (state.access !== "active" || !state.session)
      throw new ClientError(
        "access_expired",
        "Reconnect and sign in with the same account to continue.",
      );
    return state.session;
  }
  lookup(
    value: string,
    source: "code" | "qr" = "code",
  ): Promise<Lookup | null> {
    return this.resolveLookup(value, source, false);
  }
  /** Registration/replay handoffs must revalidate online, even during an inferred outage. */
  async lookupCurrent(value: string): Promise<Lookup> {
    const found = await this.resolveLookup(value, "code", true);
    // The online path never returns a cache miss; keep that guarantee explicit.
    if (!found)
      throw new ClientError(
        "network_unavailable",
        "Connect and look up this card again.",
      );
    return found;
  }
  private async resolveLookup(
    value: string,
    source: "code" | "qr",
    requireOnline: boolean,
  ): Promise<Lookup | null> {
    const epoch = this.authEpoch;
    const session = await this.active();
    const generation = (await this.installation()).authGeneration ?? null;
    if (epoch !== this.authEpoch) throw this.accountChanged();
    const code = normalizeCardCode(value);
    if (requireOnline && !this.online())
      throw new ClientError(
        "network_unavailable",
        "Connect and look up this card again.",
      );
    if (!requireOnline && !this.reachable()) {
      return this.db.transaction(
        "r",
        this.db.meta,
        this.db.windows,
        this.db.customers,
        async () => {
          await this.assertCurrentContext(session, epoch, generation);
          const cached = await this.db.customers.get([
            session.account.id,
            code,
          ]);
          if (!cached) return null;
          return {
            cardCode: cached.cardCode,
            customer: cached.customer,
            lookedUpAt: cached.lookedUpAt,
            lookupReceipt:
              cached.captureContextId === session.captureContextId
                ? (cached.lookupReceipt ?? null)
                : null,
          };
        },
      );
    }
    let found: ReturnType<typeof lookupResponseSchema.parse>;
    try {
      const response = await this.api.lookup(
        source === "qr" ? { source: "qr", qr: code } : { source: "code", code },
      );
      const parsed = lookupResponseSchema.safeParse(response);
      if (!parsed.success) throw invalidPriceResponse();
      found = parsed.data;
    } catch (error) {
      if (
        error instanceof ClientError &&
        [
          "unauthenticated",
          "permission_denied",
          "assignment_unavailable",
        ].includes(error.code)
      ) {
        const locked = await this.lockContext(session, true, {
          epoch,
          generation,
        });
        // A stale authority denial must not be handed back as a current denial:
        // callers also observe errors, and could otherwise revoke the new context.
        if (!locked) throw this.accountChanged();
      }
      throw error;
    }
    if (found.cardCode !== code)
      throw new ClientError(
        "invalid_response",
        "The card response did not match. Try again.",
      );
    await this.db.transaction(
      "rw",
      this.db.meta,
      this.db.windows,
      this.db.customers,
      async () => {
        const row = await this.assertCurrentContext(session, epoch, generation);
        if (found.priceRefresh) {
          if (!matchesRefresh(row.session, found.priceRefresh))
            throw invalidPriceResponse();
          const price = adoptPrice(row.session.price, found.priceRefresh.price);
          await this.db.windows.put({
            ...row,
            session: { ...row.session, price },
          });
        }
        await this.db.customers.put({
          cardCode: found.cardCode,
          customer: {
            id: found.customer.id,
            name: found.customer.name,
            category: found.customer.category,
          },
          lookedUpAt: found.lookedUpAt,
          lookupReceipt: found.lookupReceipt ?? null,
          originatingAccountId: session.account.id,
          captureContextId: session.captureContextId,
        });
      },
    );
    this.signal();
    await this.checkAccess();
    if (epoch !== this.authEpoch) throw this.accountChanged();
    return minimalLookup(found);
  }
  private async assertCurrentContext(
    session: Session,
    epoch?: number,
    generation?: string | null,
    preserveExpiredCheckpoint = false,
  ): Promise<OfflineWindow> {
    const meta = await this.db.meta.get("installation");
    const row = await this.db.windows.get(session.account.id);
    if (
      meta?.activeAccountId !== session.account.id ||
      meta.logoutPending ||
      (epoch !== undefined && epoch !== this.authEpoch) ||
      (generation !== undefined &&
        generation !== (meta.authGeneration ?? null)) ||
      row?.captureContextId !== session.captureContextId ||
      !sameCaptureContext(row.session, session) ||
      row.logoutPending ||
      row.locked
    )
      throw new ClientError("account_changed", "Sign in again to continue.");
    const advanced = this.advance(row, this.clock());
    if (advanced.locked && !preserveExpiredCheckpoint)
      throw new ClientError("access_expired", "Sign in again to continue.");
    return advanced;
  }
  /** Only evidence already available at composition can become original evidence. */
  selectLookup(
    draft: CaptureDraft,
    value: string,
    lookup: Lookup | null,
    options: { receiptAtComposition?: boolean } = {},
  ): CaptureDraft {
    const cardCode = normalizeCardCode(value);
    if (lookup && lookup.cardCode !== cardCode)
      throw new ClientError("lookup_required", "Look up this card again.");
    const selected = draft.selectedLookup;
    const lookupReceipt = selected
      ? selected.cardCode === cardCode
        ? selected.lookupReceipt
        : null
      : options.receiptAtComposition
        ? (lookup?.lookupReceipt ?? null)
        : null;
    const customer = lookup
      ? { ...minimalLookup(lookup), lookupReceipt }
      : null;
    return {
      ...draft,
      selectedLookup: {
        cardCode,
        lookupReceipt,
        customer,
      },
    };
  }
  async beginCapture(): Promise<CaptureDraft> {
    const epoch = this.authEpoch;
    const session = this.state.session;
    if (this.state.access !== "active" || !session)
      throw new ClientError("access_expired", "Sign in again to continue.");
    // Reserve the snapshot transaction synchronously with composition intent.
    // Preliminary asynchronous reads let a later lookup/session response overtake
    // this input and reprice it. Read all persisted authority and price facts here.
    const draft = await this.db.transaction(
      "rw",
      this.db.meta,
      this.db.windows,
      async () => {
        const generation =
          (await this.db.meta.get("installation"))?.authGeneration ?? null;
        const row = await this.assertCurrentContext(
          session,
          epoch,
          generation,
          true,
        );
        await this.db.windows.put(row);
        // Commit the elapsed checkpoint and durable expiry even when capture fails.
        if (row.locked) return null;
        return {
          operationId: uuidv7(),
          appCapturedAt: new Date(this.clock().wall).toISOString(),
          session: structuredClone(row.session),
        };
      },
    );
    await this.checkAccess();
    if (!draft)
      throw new ClientError("access_expired", "Sign in again to continue.");
    if (
      epoch !== this.authEpoch ||
      this.state.access !== "active" ||
      !this.state.session ||
      !sameCaptureContext(draft.session, this.state.session)
    )
      throw this.accountChanged();
    return draft;
  }
  async saveCapture(
    draft: CaptureDraft,
    input: CaptureInput,
  ): Promise<OutboxRow> {
    const session = await this.active();
    if (
      session.account.id !== draft.session.account.id ||
      session.captureContextId !== draft.session.captureContextId
    )
      throw new ClientError(
        "account_changed",
        "Your sign-in changed. Start a new sale.",
      );
    const code = normalizeCardCode(input.cardCode);
    if (
      this.reachable() &&
      (!input.customerCache || input.customerCache.cardCode !== code)
    )
      throw new ClientError(
        "lookup_required",
        "Resolve the customer to continue.",
      );
    if (input.customerCache && input.customerCache.cardCode !== code)
      throw new ClientError("lookup_required", "Look up this card again.");
    if (
      (draft.session.product.code === "cooking_gas" &&
        input.medium !== "cylinder") ||
      (draft.session.product.code !== "cooking_gas" &&
        !["vehicle", "keg", "three_wheeler", "bike"].includes(input.medium))
    )
      throw new ClientError(
        "medium_required",
        "Choose what the fuel was bought into.",
      );
    // Keep the online check live: lookup consumes any late authority denial and
    // locks its originating context. Capture persists the displayed hint without
    // waiting for transport; only sync's server response decides card acceptance.
    if (this.online())
      void this.lookup(code).catch(() => {
        /* Lookup handles authority denials; the saved row remains retryable. */
      });
    if (draft.selectedLookup && draft.selectedLookup.cardCode !== code)
      throw new ClientError("lookup_required", "Look up this card again.");
    const customer = draft.selectedLookup?.customer ?? input.customerCache;
    const p = draft.session.price;
    const rate = parseKobo(p.rateKobo);
    const amount =
      input.basis === "amount"
        ? parseNaira(input.value)
        : quantityToAmount(input.value, rate, p.quantityPrecision);
    const quantity =
      input.basis === "amount"
        ? amountToQuantity(amount, rate, p.quantityPrecision)
        : canonicalQuantity(input.value, p.quantityPrecision);
    const photo = input.photo;
    if (
      photo.blob.type !== "image/jpeg" ||
      photo.blob.size <= 0 ||
      photo.blob.size > 8 * 1024 * 1024 ||
      photo.bytes !== photo.blob.size ||
      photo.mediaType !== "image/jpeg"
    )
      throw new ClientError("photo_invalid", "Take a fresh meter photo.");
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", await photo.blob.arrayBuffer()),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    if (digest !== photo.sha256)
      throw new ClientError(
        "photo_invalid",
        "The photo could not be verified. Retake it.",
      );
    const row: OutboxRow = {
      schemaVersion: 1,
      originatingAccountId: session.account.id,
      operationId: draft.operationId,
      original: {
        ...(draft.selectedLookup
          ? { lookupReceipt: draft.selectedLookup.lookupReceipt }
          : {}),
        operationId: draft.operationId,
        captureContextId: draft.session.captureContextId,
        assignmentId: draft.session.assignment.id,
        cardCode: code,
        appCapturedAt: draft.appCapturedAt,
        priceVersionId: p.priceVersionId,
        rateKobo: p.rateKobo,
        currency: p.currency,
        quantityPrecision: p.quantityPrecision,
        unit: draft.session.product.unit,
        medium: input.medium,
        entry:
          input.basis === "amount"
            ? {
                basis: "amount",
                enteredAmountKobo: amount.toString(),
                amountKobo: amount.toString(),
                quantity,
              }
            : {
                basis: "quantity",
                enteredQuantity: quantity,
                amountKobo: amount.toString(),
                quantity,
              },
        photo: { sha256: digest, bytes: photo.bytes, mediaType: "image/jpeg" },
      },
      captureDisplay: {
        sellerName: draft.session.account.name,
        sellerUsername: draft.session.account.username,
        staffCode: draft.session.account.staffCode,
        stationId: draft.session.station.id,
        stationCode: draft.session.station.code,
        pumpId: draft.session.pump.id,
        pumpCode: draft.session.pump.code,
        product: draft.session.product.code,
      },
      customerCache: customer ? minimalLookup(customer) : null,
      photoBlob: photo.blob,
      photoDigest: digest,
      state: "saved",
      purchaseId: null,
      serverVersion: null,
      serverStatus: null,
      uploadOperationId: null,
      uploadId: null,
      finalizeRequest: null,
      attempts: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      localSavedAt: new Date(this.clock().wall).toISOString(),
      syncLease: null,
    };
    // Recheck after hashing and inside the same atomic transaction as photo + original.
    await this.checkAccess();
    try {
      const saved = await this.db.transaction(
        "rw",
        this.db.meta,
        this.db.windows,
        this.db.outbox,
        async () => {
          const meta = await this.db.meta.get("installation");
          const window = await this.db.windows.get(session.account.id);
          const now = this.clock();
          if (
            meta?.activeAccountId !== session.account.id ||
            meta.logoutPending ||
            !window ||
            window.captureContextId !== draft.session.captureContextId ||
            this.advance(window, now).locked
          )
            throw new ClientError(
              "access_expired",
              "Reconnect and sign in with the same account to continue.",
            );
          const existing = await this.db.outbox.get([
            session.account.id,
            draft.operationId,
          ]);
          if (existing) {
            if (
              JSON.stringify(existing.original) !== JSON.stringify(row.original)
            )
              throw new ClientError(
                "operation_conflict",
                "This sale was already saved. Start the next sale.",
              );
            return existing;
          }
          await this.db.outbox.add(row);
          return row;
        },
      );
      this.salesChanged();
      return saved;
    } catch (error) {
      if (error instanceof ClientError) throw error;
      throw new ClientError(
        "storage_failed",
        "Sale was not saved. Storage may be full. Keep this screen open and try again.",
      );
    }
  }
  /** Save a separate immutable operation. No server receipt or credit is implied. */
  async saveCorrection(
    input: SaveCorrectionInput,
  ): Promise<CorrectionOutboxRow> {
    const session = await this.active();
    const epoch = this.authEpoch;
    let baseValues,
      purchaseId: string | null = null,
      basedOnRevisionId: string | null = null;
    let evidenceAssetId: string | null = null,
      photoDigest: string,
      originalOperationId: string;
    let submission: CorrectionOutboxRow["submission"] = null;
    let expectedVersion: number | null = null;
    const operationId = uuidv7();
    const reason = correctionSubmissionSchema.shape.reason.safeParse(
      input.reason,
    );
    if (!reason.success)
      throw new ClientError(
        "invalid_request",
        "Enter a reason with 1 to 1000 characters.",
      );
    if (input.source.kind === "server") {
      const detail = attendantSaleDetailSchema.parse(input.source.detail);
      if (
        detail.seller.attendantId !== session.account.id ||
        detail.station.id !== session.station.id
      )
        throw new ClientError(
          "permission_denied",
          "This sale belongs to another account.",
        );
      if (
        detail.state === "cancelled" ||
        !detail.currentRevisionId ||
        detail.displayedValues.calculation !== "captured_rate"
      )
        throw new ClientError(
          "sale_not_correctable",
          "This sale cannot be corrected here.",
        );
      if (detail.correctionPending)
        throw new ClientError(
          "correction_pending",
          "A correction is already pending for this sale.",
        );
      if (
        detail.evidence.state !== "validated" ||
        !detail.evidence.assetId ||
        !detail.evidence.sha256
      )
        throw new ClientError(
          "evidence_unavailable",
          "This correction needs the retained validated meter photo.",
        );
      expectedVersion = detail.version;
      baseValues = detail.displayedValues;
      purchaseId = detail.id;
      basedOnRevisionId = detail.currentRevisionId;
      evidenceAssetId = detail.evidence.assetId;
      photoDigest = detail.evidence.sha256;
      originalOperationId = detail.operationId;
    } else {
      const original = await this.ownSale(input.source.operationId);
      if (!original)
        throw new ClientError("not_found", "This saved sale is unavailable.");
      if (original.state === "cancelled")
        throw new ClientError(
          "sale_not_correctable",
          "This sale cannot be corrected here.",
        );
      baseValues = localValues(original);
      photoDigest = original.photoDigest;
      originalOperationId = original.operationId;
      purchaseId = original.purchaseId;
    }
    let calculated;
    try {
      calculated = numericCorrection(baseValues, input.value);
    } catch {
      throw new ClientError(
        "calculation_invalid",
        "Enter a positive value within the sale's recorded precision.",
      );
    }
    const baseValuesDigest = await valuesDigest(baseValues);
    if ((await valuesDigest(calculated.values)) === baseValuesDigest)
      throw new ClientError(
        "no_change",
        "Change the recorded value before saving a correction.",
      );
    if (input.source.kind === "server")
      submission = correctionSubmissionSchema.parse({
        operationId,
        expectedVersion,
        basedOnRevisionId,
        edit: calculated.edit,
        evidenceAssetId,
        reason: reason.data,
      });
    const row: CorrectionOutboxRow = {
      schemaVersion: 1,
      originatingAccountId: session.account.id,
      operationId,
      originalOperationId,
      purchaseId,
      basedOnRevisionId,
      baseValues,
      baseValuesDigest,
      edit: calculated.edit,
      reason: reason.data,
      evidenceAssetId,
      photoDigest,
      submission,
      serverCorrection: null,
      state: submission ? "saved" : "waiting_original",
      localSavedAt: new Date(this.clock().wall).toISOString(),
      attempts: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      syncLease: null,
    };
    await this.active();
    try {
      const saved = await this.db.transaction(
        "rw",
        this.db.meta,
        this.db.windows,
        this.db.corrections,
        async () => {
          const meta = await this.db.meta.get("installation");
          const window = await this.db.windows.get(session.account.id);
          if (
            epoch !== this.authEpoch ||
            meta?.activeAccountId !== session.account.id ||
            meta.logoutPending ||
            meta.signInAttempt ||
            !window ||
            window.locked ||
            window.logoutPending ||
            window.captureContextId !== session.captureContextId
          )
            throw new ClientError(
              "account_changed",
              "Account changed. Sign in again before saving.",
            );
          const existing = await this.db.corrections
            .where("[originatingAccountId+originalOperationId]")
            .equals([session.account.id, originalOperationId])
            .toArray();
          if (existing.some(pendingCorrection))
            throw new ClientError(
              "correction_pending",
              "A correction is already waiting for this sale.",
            );
          await this.db.corrections.add(row);
          return row;
        },
      );
      this.salesChanged();
      return saved;
    } catch (error) {
      if (error instanceof ClientError) throw error;
      throw new ClientError(
        "storage_failed",
        "Correction was not saved. Storage may be full. Keep this screen open and try again.",
      );
    }
  }
  async ownCorrections(): Promise<CorrectionOutboxRow[]> {
    const state = await this.checkAccess();
    if (!state.session) return [];
    return this.db.transaction(
      "r",
      this.db.meta,
      this.db.corrections,
      async () => {
        const meta = await this.db.meta.get("installation");
        if (
          meta?.activeAccountId !== state.session!.account.id ||
          meta.logoutPending ||
          meta.signInAttempt
        )
          return [];
        return this.db.corrections
          .where("[originatingAccountId+operationId]")
          .between([meta.activeAccountId, ""], [meta.activeAccountId, "\uffff"])
          .toArray();
      },
    );
  }
  /** One account/context snapshot for upload-first and handover decisions. */
  async ownPendingUploads(): Promise<{ sales: number; corrections: number }> {
    const epoch = this.authEpoch;
    const state = await this.checkAccess();
    const session = state.session;
    const empty = { sales: 0, corrections: 0 };
    if (!session || epoch !== this.authEpoch) return empty;
    const snapshot = await this.db.transaction(
      "r",
      this.db.meta,
      this.db.windows,
      this.db.outbox,
      this.db.corrections,
      async () => {
        const meta = await this.db.meta.get("installation");
        const window = await this.db.windows.get(session.account.id);
        if (
          epoch !== this.authEpoch ||
          meta?.activeAccountId !== session.account.id ||
          meta.logoutPending ||
          meta.signInAttempt ||
          !window ||
          window.logoutPending ||
          window.captureContextId !== session.captureContextId
        )
          return empty;
        // Earlier captures keep their original context; partition by originating account.
        const sales = await this.db.outbox
          .where("[originatingAccountId+operationId]")
          .between([session.account.id, ""], [session.account.id, "\uffff"])
          .toArray();
        const corrections = await this.db.corrections
          .where("[originatingAccountId+operationId]")
          .between([session.account.id, ""], [session.account.id, "\uffff"])
          .toArray();
        return {
          sales: sales.filter(needsUpload).length,
          corrections: corrections.filter(correctionNeedsUpload).length,
        };
      },
    );
    return epoch === this.authEpoch ? snapshot : empty;
  }
  async ownSales(): Promise<OutboxRow[]> {
    const state = await this.checkAccess();
    if (!state.session) return [];
    return this.db.transaction("r", this.db.meta, this.db.outbox, async () => {
      const meta = await this.db.meta.get("installation");
      if (
        meta?.activeAccountId !== state.session!.account.id ||
        meta.logoutPending
      )
        return [];
      return this.db.outbox
        .where("[originatingAccountId+operationId]")
        .between([meta.activeAccountId, ""], [meta.activeAccountId, "\uffff"])
        .toArray();
    });
  }
  async ownSale(operationId: string): Promise<OutboxRow | undefined> {
    return (await this.ownSales()).find(
      (row) => row.operationId === operationId,
    );
  }
  private async requestPersistence() {
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* A denied persistence request must not prevent capture. */
    }
  }
  async storageStatus(): Promise<{ persisted: boolean; nearFull: boolean }> {
    try {
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      const estimate = await navigator.storage?.estimate?.();
      return {
        persisted,
        nearFull:
          !!estimate?.quota && (estimate.usage ?? 0) / estimate.quota >= 0.9,
      };
    } catch {
      return { persisted: false, nearFull: false };
    }
  }
  close() {
    this.foregroundCleanup?.();
    this.synchronizer.stop();
    this.correctionSynchronizer.stop();
    this.channel?.close();
    this.db.close();
  }
}
function invalidPriceResponse() {
  return new ClientError(
    "invalid_response",
    "The service returned an invalid response. Try again.",
  );
}
function sameCaptureContext(left: Session, right: Session) {
  return (
    left.account.id === right.account.id &&
    left.captureContextId === right.captureContextId &&
    left.station.id === right.station.id &&
    left.assignment.id === right.assignment.id &&
    left.pump.id === right.pump.id &&
    left.product.id === right.product.id
  );
}
function matchesRefresh(session: Session, candidate: PriceRefresh) {
  return (
    candidate.originatingAccountId === session.account.id &&
    candidate.captureContextId === session.captureContextId &&
    candidate.stationId === session.station.id &&
    candidate.assignmentId === session.assignment.id &&
    candidate.pumpId === session.pump.id &&
    candidate.productId === session.product.id
  );
}
/** Compare persisted versions, never response timing or the direction of the rate change. */
function adoptPrice(
  known: Session["price"],
  candidate: Session["price"],
): Session["price"] {
  if (candidate.version < known.version) return known;
  if (candidate.version === known.version) {
    for (const field of [
      "priceVersionId",
      "rateKobo",
      "currency",
      "quantityPrecision",
      "effectiveFrom",
    ] as const) {
      if (known[field] !== candidate[field]) throw invalidPriceResponse();
    }
    return known;
  }
  return structuredClone(candidate);
}
/** Wire refresh metadata belongs only to the current window, never a customer hint. */
function minimalLookup(lookup: Lookup): Lookup {
  return {
    cardCode: lookup.cardCode,
    customer: {
      id: lookup.customer.id,
      name: lookup.customer.name,
      category: lookup.customer.category,
    },
    lookedUpAt: lookup.lookedUpAt,
    ...(lookup.lookupReceipt !== undefined
      ? { lookupReceipt: lookup.lookupReceipt }
      : {}),
  };
}
function canonicalQuantity(value: string, precision: number) {
  const scaled = parseQuantity(value, precision);
  const fraction = (scaled % QUANTITY_SCALE)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${scaled / QUANTITY_SCALE}${fraction ? "." + fraction : ""}`;
}
let singleton: AttendantClient | undefined;
export function getAttendantClient() {
  return (singleton ??= new AttendantClient(
    undefined,
    undefined,
    undefined,
    connection.browserOnline,
    connection.isOnline,
  ));
}

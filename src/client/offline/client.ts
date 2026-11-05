import { v7 as uuidv7 } from "uuid";
import { HttpAttendantApi, type AttendantApi } from "../api";
import {
  ClientError,
  normalizeCardCode,
  sessionSchema,
  type Session,
  type Lookup,
  type OutboxRow,
  type OfflineWindow,
  type ClientState,
  type CaptureDraft,
  type CaptureInput,
} from "../types";
import { CaptureDatabase, type Installation } from "./db";
import { SaleSynchronizer } from "./sync";
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
  private salesListeners = new Set<() => void>();
  private foregroundCleanup: (() => void) | null = null;
  private synchronizer: SaleSynchronizer;

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
      lock: (session) => this.lockContext(session),
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
    this.state = state;
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
  retryUploads() {
    return this.synchronizer.run();
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
    const pause = () => this.synchronizer.stop();
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
    return this.db.transaction("rw", this.db.meta, async () => {
      const found = await this.db.meta.get("installation");
      if (found) {
        if (signInAttempt === undefined) return found;
        const claimed = { ...found, signInAttempt };
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
      };
      await this.db.meta.add(row);
      return row;
    });
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
    const result = await this.db.transaction(
      "rw",
      this.db.meta,
      this.db.windows,
      async () => {
        const meta = await this.db.meta.get("installation");
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
    this.publish(result);
    return result;
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
    const epoch = ++this.authEpoch;
    const attempt = uuidv7();
    // Claim the attempt in the first transaction, before any revocation/network wait.
    // Handover can invalidate this claim but this invocation never writes it again.
    const meta = await this.installation(attempt);
    if (epoch !== this.authEpoch) throw this.accountChanged();
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
    const session = sessionSchema.parse(
      await this.api.signIn(
        { username: username.trim(), password, deviceId: meta.deviceId },
        attempt,
      ),
    );
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
  private accountChanged() {
    return new ClientError(
      "account_changed",
      "Another sign-in or sign-out occurred. Sign in again.",
    );
  }
  async signOut(): Promise<ClientState> {
    this.synchronizer.stop();
    ++this.authEpoch;
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
    const before = await this.checkAccess();
    if (!before.session || !this.online()) return before;
    const account = before.session.account.id;
    const context = before.session.captureContextId;
    const requestStarted = this.clock();
    try {
      const fresh = sessionSchema.parse(await this.api.session());
      if (fresh.account.id !== account || fresh.captureContextId !== context) {
        await this.lockContext(before.session);
        return this.checkAccess();
      }
      await this.db.transaction(
        "rw",
        this.db.meta,
        this.db.windows,
        async () => {
          const meta = await this.db.meta.get("installation");
          const row = await this.db.windows.get(account);
          if (
            meta?.activeAccountId !== account ||
            meta.logoutPending ||
            !row ||
            row.captureContextId !== context ||
            row.logoutPending
          )
            return;
          if (
            fresh.lastOnlineSignInAt !== row.lastOnlineSignInAt ||
            fresh.offlineExpiresAt !== row.offlineExpiresAt
          ) {
            await this.db.windows.update(account, { locked: true });
            return;
          }
          // Reconcile at this transaction's clock sample. Neither a slow response
          // nor another tab's checkpoint can move the existing anchor or elapsed time back.
          const now = this.clock();
          const transit = requestDuration(requestStarted, now);
          const advanced = this.advance(row, now);
          const next = {
            ...advanced,
            session: fresh,
            lastTrustedServerTime: fresh.serverTime,
            elapsedAtCheckpointMs: Math.max(
              advanced.elapsedAtCheckpointMs,
              Date.parse(fresh.serverTime) -
                Date.parse(row.lastOnlineSignInAt) +
                (transit ?? 0),
            ),
            locked: advanced.locked || transit === null,
          };
          await this.db.windows.put(this.advance(next, now));
        },
      );
    } catch (error) {
      if (
        error instanceof ClientError &&
        [
          "unauthenticated",
          "permission_denied",
          "assignment_unavailable",
        ].includes(error.code)
      )
        await this.lockContext(before.session);
    }
    return this.checkAccess();
  }
  private async lockContext(session: Session) {
    await this.db.transaction("rw", this.db.meta, this.db.windows, async () => {
      const meta = await this.db.meta.get("installation");
      const row = await this.db.windows.get(session.account.id);
      // An old response can revoke only the context that issued its request.
      if (
        meta?.activeAccountId === session.account.id &&
        row?.captureContextId === session.captureContextId
      )
        await this.db.windows.update(session.account.id, { locked: true });
    });
    this.signal();
    await this.checkAccess();
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
  async lookup(
    value: string,
    source: "code" | "qr" = "code",
  ): Promise<Lookup | null> {
    const session = await this.active();
    const code = normalizeCardCode(value);
    if (!this.reachable()) {
      return this.db.transaction(
        "r",
        this.db.meta,
        this.db.windows,
        this.db.customers,
        async () => {
          await this.assertCurrentContext(session);
          const cached = await this.db.customers.get([
            session.account.id,
            code,
          ]);
          if (!cached) return null;
          return {
            cardCode: cached.cardCode,
            customer: cached.customer,
            lookedUpAt: cached.lookedUpAt,
          };
        },
      );
    }
    let found: Lookup;
    try {
      found = await this.api.lookup(
        source === "qr" ? { source: "qr", qr: code } : { source: "code", code },
      );
    } catch (error) {
      if (
        error instanceof ClientError &&
        [
          "unauthenticated",
          "permission_denied",
          "assignment_unavailable",
        ].includes(error.code)
      )
        await this.lockContext(session);
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
        await this.assertCurrentContext(session);
        await this.db.customers.put({
          ...found,
          originatingAccountId: session.account.id,
        });
      },
    );
    return found;
  }
  private async assertCurrentContext(session: Session) {
    const meta = await this.db.meta.get("installation");
    const row = await this.db.windows.get(session.account.id);
    if (
      meta?.activeAccountId !== session.account.id ||
      meta.logoutPending ||
      row?.captureContextId !== session.captureContextId ||
      row.locked
    )
      throw new ClientError("account_changed", "Sign in again to continue.");
  }
  async beginCapture(): Promise<CaptureDraft> {
    const session = await this.active();
    return {
      operationId: uuidv7(),
      appCapturedAt: new Date(this.clock().wall).toISOString(),
      session: structuredClone(session),
    };
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
    // Revalidate online at save as well: reconnecting must not promote an offline cache hint.
    const customer = this.online()
      ? await this.lookup(code)
      : input.customerCache;
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
      customerCache: customer ? structuredClone(customer) : null,
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
    this.channel?.close();
    this.db.close();
  }
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

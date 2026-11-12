import Dexie, { type Table } from "dexie";
import type { CorrectionOutboxRow } from "./correction-types";
import type { Lookup, OfflineWindow, OutboxRow } from "../types";
export type Installation = {
  key: "installation";
  deviceId: string;
  activeAccountId: string | null;
  logoutPending: boolean;
  logoutOperationId: string | null;
  signInAttempt?: string | null;
  /** Optional for existing installations; fences reads across same-context sign-in replays. */
  authGeneration?: string;
};
/** Storage access is internal; the public client only exposes the active partition. */
export class CaptureDatabase extends Dexie {
  outbox!: Table<OutboxRow, [string, string]>;
  corrections!: Table<CorrectionOutboxRow, [string, string]>;
  windows!: Table<OfflineWindow, string>;
  customers!: Table<
    Lookup & { originatingAccountId: string; captureContextId?: string },
    [string, string]
  >;
  meta!: Table<Installation, string>;
  constructor(name = "whales-capture-v1") {
    super(name);
    this.version(1).stores({
      outbox:
        "[originatingAccountId+operationId],[originatingAccountId+state],[originatingAccountId+nextAttemptAt]",
      windows: "originatingAccountId",
      customers: "[originatingAccountId+cardCode]",
      meta: "key",
    });
    this.version(2).stores({
      corrections:
        "[originatingAccountId+operationId],[originatingAccountId+originalOperationId]",
    });
  }
}

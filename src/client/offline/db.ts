import Dexie, { type Table } from "dexie";
import type { Lookup, OfflineWindow, OutboxRow } from "../types";
export type Installation = {
  key: "installation";
  deviceId: string;
  activeAccountId: string | null;
  logoutPending: boolean;
  logoutOperationId: string | null;
  signInAttempt?: string | null;
};
/** Storage access is internal; the public client only exposes the active partition. */
export class CaptureDatabase extends Dexie {
  outbox!: Table<OutboxRow, [string, string]>;
  windows!: Table<OfflineWindow, string>;
  customers!: Table<
    Lookup & { originatingAccountId: string },
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
  }
}

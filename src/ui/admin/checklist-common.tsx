"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  AdminChecklistApi,
  checklistMessage,
  type Pending,
  type View,
} from "@/client/admin-checklist-api";
import { giveawayUncertain } from "@/client/admin-giveaway-api";
import { useAdminSession } from "./session";
import { Button, KeyValueList, Notice } from "@/ui";
import { PageHead, Sheet } from "./station-common";
import { adminTime } from "@/client/admin-display";
import type { Campaign } from "@/client/admin-giveaway-schemas";
import { TimingFacts } from "./giveaway-common";
export function useChecklistApi() {
  const { store } = useAdminSession();
  return useMemo(() => new AdminChecklistApi(store.request), [store]);
}
export function useChecklistRead<T>(key: string, load: () => Promise<T>) {
  const { store, epoch } = useAdminSession();
  const [serial, setSerial] = useState(0);
  const [state, set] = useState<{
    key: string;
    data: T | null;
    error: string;
    busy: boolean;
  }>({ key: "", data: null, error: "", busy: true });
  const k = `${key}:${serial}`;
  useEffect(() => {
    let alive = true;
    void load().then(
      (data) => {
        if (alive && store.getSnapshot().epoch === epoch)
          set({ key: k, data, error: "", busy: false });
      },
      (e) => {
        if (alive && store.getSnapshot().epoch === epoch)
          set({ key: k, data: null, error: checklistMessage(e), busy: false });
      },
    );
    return () => {
      alive = false;
    };
  }, [load, k, store, epoch]);
  return {
    ...(state.key === k ? state : { data: null, error: "", busy: true }),
    reload: () => setSerial((x) => x + 1),
  };
}
export function useChecklistDraft<T>(key: string, initial: () => T) {
  const { store, epoch } = useAdminSession();
  const [draft, set] = useState<T>(
    () => (store.lists.get(key) as T | undefined) ?? initial(),
  );
  return [
    draft,
    (next: T) => {
      if (store.getSnapshot().epoch === epoch) {
        store.lists.set(key, next);
        set(next);
      }
    },
  ] as const;
}
type Change = {
  request: Pending;
  review: ReactNode;
  title: string;
  confirm: string;
  success: string;
};
type MemoryState = {
  change: Change | null;
  phase: "idle" | "review" | "pending";
  busy: boolean;
  error: string;
  message: string;
  serial: number;
  stopped: boolean;
};
class Memory {
  state: MemoryState = {
    change: null,
    phase: "idle",
    busy: false,
    error: "",
    message: "",
    serial: 0,
    stopped: false,
  };
  listeners = new Set<() => void>();
  get = () => this.state;
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  set(p: Partial<MemoryState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((f) => f());
  }
}
export function useChecklistMutation() {
  const { store, epoch } = useAdminSession();
  const api = useChecklistApi();
  const memory = useMemo(() => {
    const old = store.lists.get(`checklist:mutation:${epoch}`) as
      Memory | undefined;
    if (old) return old;
    const m = new Memory();
    store.lists.set(`checklist:mutation:${epoch}`, m);
    return m;
  }, [store, epoch]);
  const state = useSyncExternalStore(memory.subscribe, memory.get, memory.get);
  const valid = () => store.getSnapshot().epoch === epoch;
  return {
    ...state,
    locked: state.phase !== "idle" || state.stopped,
    review: (build: () => Change) => {
      if (!valid() || memory.state.phase !== "idle" || memory.state.stopped)
        return;
      if (
        (store.lists.get("giveaway:draft") as { pending?: unknown } | undefined)
          ?.pending
      ) {
        memory.set({
          error:
            "The result of this request is uncertain. Retry the same request before starting another change.",
        });
        return;
      }
      try {
        memory.set({
          change: build(),
          phase: "review",
          error: "",
          message: "",
        });
      } catch (e) {
        memory.set({ error: checklistMessage(e) });
      }
    },
    cancel: () => {
      if (memory.state.phase === "review")
        memory.set({ change: null, phase: "idle", error: "" });
    },
    refresh: () => {
      if (memory.state.phase === "idle")
        memory.set({
          error: "",
          message: "",
          stopped: false,
          serial: memory.state.serial + 1,
        });
    },
    confirm: async () => {
      const c = memory.state.change;
      if (!valid() || !c || memory.state.busy) return;
      memory.set({ phase: "pending", busy: true, error: "", message: "" });
      try {
        await api.send(c.request);
        if (valid())
          memory.set({
            change: null,
            phase: "idle",
            message:
              c.success +
              " This is the recorded receipt; refresh and review current evidence separately.",
            serial: memory.state.serial + 1,
          });
      } catch (e) {
        if (valid())
          memory.set({
            phase: giveawayUncertain(e) ? "pending" : "idle",
            stopped: !giveawayUncertain(e),
            change: giveawayUncertain(e) ? c : null,
            error: giveawayUncertain(e)
              ? "The result of this request is uncertain. Retry the same request before starting another change."
              : checklistMessage(e),
          });
      } finally {
        if (valid()) memory.set({ busy: false });
      }
    },
  };
}
export function ChecklistPending() {
  const m = useChecklistMutation();
  const error = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (m.error) error.current?.focus();
  }, [m.error]);
  return (
    <>
      {m.message && <Notice role="status">{m.message}</Notice>}
      {m.error && (
        <div ref={error} tabIndex={-1}>
          <Notice tone="danger" role="alert">
            {m.error}
          </Notice>
        </div>
      )}
      {m.stopped && (
        <Button variant="secondary" onClick={m.refresh}>
          Refresh checks and review again
        </Button>
      )}
      {m.change && (
        <Sheet title={m.change.title}>
          {m.change.review}
          {m.phase === "pending" && (
            <Notice tone="warning">
              The result of this request is uncertain. Retry the same request
              before starting another change.
            </Notice>
          )}
          <div className="wr-row wr-checklist-actions">
            <Button loading={m.busy} onClick={() => void m.confirm()}>
              {m.phase === "pending" ? "Retry same request" : m.change.confirm}
            </Button>
            {m.phase === "review" && (
              <>
                <Button variant="secondary" onClick={m.cancel}>
                  Keep reviewing
                </Button>
                <Button variant="ghost" onClick={m.cancel}>
                  Cancel
                </Button>
              </>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
export const basePath = "/admin/leaderboards/finalize";
export function ChecklistFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="wr-checklist">
      <PageHead
        title={title}
        eyebrow="Leaderboards / Giveaway"
        back={{ href: basePath, label: "Back to finalization checks" }}
      />
      <ChecklistPending />
      {children}
    </div>
  );
}
export function EvidenceContext({
  campaign,
  view,
}: {
  campaign: Campaign;
  view: View;
}) {
  return (
    <Sheet title="Campaign context">
      <KeyValueList
        items={[
          { label: "Campaign", value: campaign.name },
          {
            label: "Campaign action",
            value:
              view.kind === "initial" ? "Initial result" : "Audited revision",
          },
          {
            label: "Previous snapshot",
            value: view.guard.expectedPreviousSnapshotId ?? "None",
            mono: true,
          },
          { label: "Census version", value: String(view.censusVersion) },
          {
            label: "Manager designation",
            value: view.designationId ?? "Not designated",
            mono: true,
          },
          { label: "Server as of", value: adminTime(view.asOf) },
        ]}
      />
      <TimingFacts timing={campaign.timing} asOf={view.asOf} />
    </Sheet>
  );
}
export function ReadState({
  busy,
  error,
  reload,
}: {
  busy: boolean;
  error: string;
  reload: () => void;
}) {
  const r = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) r.current?.focus();
  }, [error]);
  return (
    <>
      {busy && <p role="status">Loading finalization evidence…</p>}
      {error && (
        <div ref={r} tabIndex={-1}>
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
          <Button variant="secondary" onClick={reload}>
            Refresh complete evidence
          </Button>
        </div>
      )}
    </>
  );
}
export function Id({ children }: { children: ReactNode }) {
  return <span className="wr-mono wr-checklist-id">{children}</span>;
}
export function BackToPhones() {
  return (
    <Link className="wr-btn wr-btn-secondary" href={basePath + "/phones"}>
      Back to phone census
    </Link>
  );
}
export const campaignGuard = (v: View) => ({
  ...v.guard,
  kind: v.kind,
  expectedCensusVersion: v.censusVersion,
});
export const useStableLoad = useCallback;

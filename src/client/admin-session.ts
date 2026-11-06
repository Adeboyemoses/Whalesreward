import { adminRequest, AdminError } from "./admin-api";
import type { RoleSummary, PermissionCode } from "@/shared/contracts/admin";
export type AdminSession = {
  state: string;
  account: { id: string; name: string; username: string };
  permissions?: PermissionCode[];
  role?: RoleSummary;
  station?: { name: string };
};
export type AdminState = {
  session: AdminSession | null;
  checked: boolean;
  refreshing: boolean;
  error: string;
  epoch: number;
  transitionTo: "/admin/sign-in" | "/admin/signed-out" | null;
};
export class AdminSessionStore {
  private state: AdminState = {
    session: null,
    checked: false,
    refreshing: false,
    error: "",
    epoch: 0,
    transitionTo: null,
  };
  private listeners = new Set<() => void>();
  private refreshId = 0;
  private inFlight: Promise<void> | null = null;
  readonly lists = new Map<string, unknown>();
  constructor(private transport: typeof adminRequest = adminRequest) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private publish(patch: Partial<AdminState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  clear(
    message = "Your session ended. Sign in again.",
    transitionTo: AdminState["transitionTo"] = null,
  ) {
    this.refreshId++;
    this.inFlight = null;
    this.lists.clear();
    this.publish({
      session: null,
      checked: true,
      refreshing: false,
      error: message,
      transitionTo,
      epoch: this.state.epoch + 1,
    });
  }
  adopt(session: AdminSession) {
    this.refreshId++;
    this.inFlight = null;
    this.lists.clear();
    this.publish({
      session,
      checked: true,
      refreshing: false,
      error: "",
      transitionTo: null,
      epoch: this.state.epoch + 1,
    });
  }
  finishTransition(path: string) {
    if (this.state.transitionTo === path) this.publish({ transitionTo: null });
  }
  private authority(s: AdminSession | null) {
    return s
      ? JSON.stringify([
          s.account.id,
          s.state,
          s.role?.id,
          [...(s.permissions ?? [])].sort(),
        ])
      : "";
  }
  refresh = () => {
    if (this.inFlight) return this.inFlight;
    const id = ++this.refreshId,
      epoch = this.state.epoch;
    this.publish({ refreshing: true });
    const task = this.transport<AdminSession>("session")
      .then(
        (session) => {
          if (id !== this.refreshId || epoch !== this.state.epoch) return;
          const changed =
            this.state.session &&
            this.authority(session) !== this.authority(this.state.session);
          if (changed) this.lists.clear();
          this.publish({
            session,
            checked: true,
            refreshing: false,
            error: changed
              ? "Your account or permissions changed. Review the current access before continuing."
              : "",
            epoch: changed ? epoch + 1 : epoch,
          });
        },
        (error) => {
          if (id !== this.refreshId || epoch !== this.state.epoch) return;
          if (error instanceof AdminError && [401, 403].includes(error.status))
            this.clear("Your session ended or access changed. Sign in again.");
          else
            this.publish({
              checked: true,
              refreshing: false,
              error:
                "Access could not be refreshed. Check your connection and try again.",
            });
        },
      )
      .finally(() => {
        if (id === this.refreshId) this.inFlight = null;
      });
    this.inFlight = task;
    return task;
  };
  request: typeof adminRequest = async <T>(
    path: string,
    body?: unknown,
    method?: string,
    key?: string,
  ): Promise<T> => {
    const epoch = this.state.epoch;
    try {
      const value = await this.transport<T>(path, body, method, key);
      if (epoch !== this.state.epoch) throw new AdminError("obsolete");
      return value;
    } catch (error) {
      if (epoch !== this.state.epoch) throw new AdminError("obsolete");
      if (epoch === this.state.epoch && error instanceof AdminError) {
        if (error.status === 401 || error.code === "password_change_required")
          this.clear("Your session ended. Sign in again.");
        else if (error.code === "permission_denied") {
          this.clear("Your permissions changed. Sign in again.");
        }
      }
      throw error;
    }
  };
}

/** Reachability is a UI/capture hint, never authorization or a renewed session. */
export class ConnectionMonitor {
  private reachable = true;
  private sequence = 0;
  private lastOutcome = 0;
  private listeners = new Set<() => void>();

  constructor(private browserAvailable: () => boolean) {}

  browserOnline = () => this.browserAvailable();
  isOnline = () => this.browserAvailable() && this.reachable;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(reachable: boolean) {
    const changed = this.reachable !== reachable;
    this.reachable = reachable;
    if (changed) for (const listener of this.listeners) listener();
  }
  browserChanged() {
    // A browser event supersedes every request that began before that event.
    this.lastOutcome = ++this.sequence;
    this.publish(this.browserAvailable());
  }
  beginRequest = () => {
    const sequence = ++this.sequence;
    return (reachable: boolean) => {
      if (sequence < this.lastOutcome) return;
      this.lastOutcome = sequence;
      this.publish(this.browserAvailable() && reachable);
    };
  };
}

export const connection = new ConnectionMonitor(
  () => typeof navigator === "undefined" || navigator.onLine,
);

/** Only recovers the connectivity hint; no cookies, session refresh or persistence. */
export async function probeConnection() {
  if (!connection.browserOnline() || connection.isOnline()) return;
  const outcome = connection.beginRequest();
  try {
    await fetch("/api/health", {
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2000),
    });
    outcome(true);
  } catch {
    outcome(false);
  }
}

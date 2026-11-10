import { CaptureDatabase } from "../offline/db";
import { UPDATE_MESSAGE } from "./build-id";
import {
  hasPendingSales,
  isCaptureActive,
  setUpdateFrozen,
  isUpdateFrozen,
  markCaptureStarted,
} from "./update-safety";

/** Mounted once by the generic attendant provider. No API responses are cached. */
export async function registerAttendantWorker(
  notify: (message: string | null) => void = () => {},
): Promise<() => void> {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator))
    return () => {};
  const sw = navigator.serviceWorker;
  const db = new CaptureDatabase();
  let stopped = false;
  let prepared: string | null = null;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let reloading = false;
  let hadController = !!sw.controller;
  let controllerNeedsReload = false;
  const unfreeze = () => {
    prepared = null;
    setUpdateFrozen(false);
    document.documentElement.inert = false;
    clearTimeout(releaseTimer);
  };
  const safeRoute = () =>
    /^\/attendant\/(sign-in|sale(?:\/[^/]+\/recorded)?|uploads|account)\/?$/.test(
      location.pathname,
    );
  const stillPrepared = (token: string) =>
    !stopped &&
    prepared === token &&
    isUpdateFrozen() &&
    document.documentElement.inert &&
    safeRoute() &&
    !isCaptureActive();
  const safe = async (token: string) => {
    if (!stillPrepared(token)) return false;
    const pending = await hasPendingSales(db);
    return !pending && stillPrepared(token);
  };
  const freeze = () => {
    setUpdateFrozen(true);
    document.documentElement.inert = true;
    releaseTimer = setTimeout(unfreeze, 5000);
  };
  const onInteraction = (event: Event) => {
    if (isUpdateFrozen()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    } else if (location.pathname === "/attendant/sale") {
      markCaptureStarted();
    }
  };
  // Capture phase runs before React handlers, so a camera/input/save click cannot
  // start a capture between the synchronous freeze and the IndexedDB check.
  for (const name of ["pointerdown", "keydown", "input", "submit", "click"])
    document.addEventListener(name, onInteraction, true);
  const registration = await sw.register("/attendant/sw.js", {
    scope: "/attendant/",
    updateViaCache: "none",
  });
  const attempt = () => {
    if (stopped || !navigator.onLine) return;
    if (controllerNeedsReload && registration.active) {
      registration.active.postMessage({ type: "WHR_REQUEST_RELOAD" });
    } else if (registration.waiting && sw.controller) {
      notify(UPDATE_MESSAGE);
      registration.waiting.postMessage({ type: "WHR_REQUEST_UPDATE" });
    }
  };
  const check = () => {
    void registration.update().then(attempt, () => {});
  };
  const message = (event: MessageEvent) => {
    if (
      event.source !== registration.waiting &&
      event.source !== registration.active &&
      event.source !== sw.controller
    )
      return;
    if (event.data?.type === "WHR_PREPARE_UPDATE" && event.ports[0]) {
      if (prepared || isCaptureActive() || !safeRoute()) {
        event.ports[0].postMessage(false);
        return;
      }
      const port = event.ports[0];
      const token = event.data.token;
      prepared = token;
      freeze();
      void safe(token).then(
        (ready) => {
          const accepted = ready && stillPrepared(token);
          port.postMessage(accepted);
          if (!accepted && prepared === token) unfreeze();
        },
        () => {
          port.postMessage(false);
          if (prepared === token) unfreeze();
        },
      );
    } else if (
      event.data?.type === "WHR_COMMIT_UPDATE" &&
      event.data.token === prepared
    ) {
      reloadPrepared();
    } else if (
      event.data?.type === "WHR_RELEASE_UPDATE" &&
      event.data.token === prepared
    ) {
      if (!event.data.committed) unfreeze();
      // Keep the freeze until controllerchange or the bounded fallback timeout.
      // skipWaiting resolves before activate/controllerchange has completed.
    }
  };
  const reloadPrepared = () => {
    // A new/unknown tab did not participate, so it cannot be reloaded here.
    if (!prepared || reloading) return;
    const token = prepared;
    void safe(token).then(
      (ready) => {
        if (ready && stillPrepared(token)) {
          reloading = true;
          location.reload();
        } else if (prepared === token) unfreeze();
      },
      () => {
        if (prepared === token) unfreeze();
      },
    );
  };
  const changed = () => {
    if (!hadController) {
      hadController = true;
      // First installation claims an already current page without a reload.
      // Release a preparation initiated by another controlled tab, if any.
      unfreeze();
      return;
    }
    controllerNeedsReload = true;
    reloadPrepared();
  };
  const found = () => {
    const worker = registration.installing;
    if (worker) worker.addEventListener("statechange", attempt);
  };
  sw.addEventListener("message", message);
  sw.addEventListener("controllerchange", changed);
  registration.addEventListener("updatefound", found);
  const mismatch = () => {
    notify(UPDATE_MESSAGE);
    check();
  };
  window.addEventListener("whr-build-changed", mismatch);
  window.addEventListener("whr-request-update", check);
  window.addEventListener("online", check);
  document.addEventListener("visibilitychange", check);
  const timer = setInterval(attempt, 5000);
  found();
  attempt();
  check();
  return () => {
    stopped = true;
    unfreeze();
    clearInterval(timer);
    sw.removeEventListener("message", message);
    sw.removeEventListener("controllerchange", changed);
    registration.removeEventListener("updatefound", found);
    window.removeEventListener("whr-build-changed", mismatch);
    window.removeEventListener("whr-request-update", check);
    window.removeEventListener("online", check);
    document.removeEventListener("visibilitychange", check);
    for (const name of ["pointerdown", "keydown", "input", "submit", "click"])
      document.removeEventListener(name, onInteraction, true);
    db.close();
  };
}

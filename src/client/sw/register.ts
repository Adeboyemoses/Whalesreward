export async function registerAttendantWorker(): Promise<void> {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator))
    return;
  await navigator.serviceWorker.register("/attendant/sw.js", {
    scope: "/attendant/",
    updateViaCache: "none",
  });
}

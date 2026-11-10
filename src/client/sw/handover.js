// A waiting worker never activates merely because it installed. Every open
// attendant window must freeze interaction and confirm its local queue is safe.
export function installHandover(scope) {
  let running = false;
  scope.addEventListener("message", (event) => {
    if (
      !["WHR_REQUEST_UPDATE", "WHR_REQUEST_RELOAD"].includes(
        event.data?.type,
      ) ||
      running
    )
      return;
    const source = event.source;
    if (!source?.url || !isAttendant(source.url, scope.location.origin)) return;
    running = true;
    event.waitUntil(
      (async () => {
        const participants = await scope.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        const clients = participants.filter((client) =>
          isAttendant(client.url, scope.location.origin),
        );
        if (!clients.length) return;
        const token = crypto.randomUUID();
        let committed = false;
        try {
          const ready = await Promise.all(
            clients.map(
              (client) =>
                new Promise((resolve) => {
                  const channel = new MessageChannel();
                  const timer = setTimeout(() => {
                    channel.port1.close();
                    resolve(false);
                  }, 2500);
                  channel.port1.onmessage = (reply) => {
                    clearTimeout(timer);
                    channel.port1.close();
                    resolve(reply.data === true);
                  };
                  client.postMessage({ type: "WHR_PREPARE_UPDATE", token }, [
                    channel.port2,
                  ]);
                }),
            ),
          );
          if (!ready.every(Boolean)) return;
          const current = (
            await scope.clients.matchAll({
              type: "window",
              includeUncontrolled: true,
            })
          ).filter((client) => isAttendant(client.url, scope.location.origin));
          if (
            current.length !== clients.length ||
            current.some(
              (client) =>
                !clients.some((prepared) => prepared.id === client.id),
            )
          )
            return;
          // Only this explicit all-window agreement permits the handover.
          committed = true;
          if (event.data.type === "WHR_REQUEST_RELOAD") {
            for (const client of clients)
              client.postMessage({ type: "WHR_COMMIT_UPDATE", token });
          } else await scope.skipWaiting();
        } finally {
          for (const client of clients)
            client.postMessage({
              type: "WHR_RELEASE_UPDATE",
              token,
              committed,
            });
        }
      })().finally(() => {
        running = false;
      }),
    );
  });
  scope.addEventListener("activate", (event) => {
    // Claim does not reload windows. Each page independently rechecks its guard
    // after controllerchange, including pages opened during activation.
    event.waitUntil(scope.clients.claim());
  });
}
function isAttendant(value, origin) {
  const url = new URL(value);
  return url.origin === origin && url.pathname.startsWith("/attendant/");
}

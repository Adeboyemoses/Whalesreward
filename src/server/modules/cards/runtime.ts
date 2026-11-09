import pg from "pg";
import { createMailLoop, type MailLoop } from "../admin-access/mail-loop";
import { createCardArtifactStorage } from "../../adapters/card-artifacts";
import { logger } from "../../lib/logger";
import { cardOptions } from "./config";
import { prepareCardExport } from "./exports";
const runtime = globalThis as typeof globalThis & {
  __whrCardExports?: MailLoop;
};
/** Same web-process bounded scheduler as mail; database leases survive restarts. */
export function startAutomaticCardExports() {
  if (
    process.env.NEXT_PHASE === "phase-production-build" ||
    !process.env.STORAGE_ENDPOINT ||
    !process.env.DATABASE_URL
  )
    return;
  if (runtime.__whrCardExports) return runtime.__whrCardExports;
  const options = { ...cardOptions(), storage: createCardArtifactStorage() };
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 6000,
    idleTimeoutMillis: 10000,
    idle_in_transaction_session_timeout: 60000,
    allowExitOnIdle: true,
  });
  pool.on("error", () => logger.error({ event: "cards.exports_pool_failed" }));
  const loop = createMailLoop({
    processNext: () => prepareCardExport(pool, options),
    close: () => pool.end(),
    batchSize: 2,
    batchBudgetMs: 10000,
    report: (counts) => {
      if (counts.processed || counts.errors)
        logger.info({ event: "cards.exports_batch", ...counts });
    },
  });
  runtime.__whrCardExports = loop;
  // Preserve the existing mail/Next handlers and drain exports before forwarding signals.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    const listeners = process.rawListeners(signal);
    for (const listener of listeners)
      process.removeListener(signal, listener as NodeJS.SignalsListener);
    let draining = false;
    process.on(signal, () => {
      if (draining) return;
      draining = true;
      const deadline = setTimeout(() => process.exit(1), 60000);
      void loop
        .stop()
        .then(() => {
          clearTimeout(deadline);
          if (!listeners.length) process.exit(signal === "SIGTERM" ? 143 : 130);
          for (const listener of listeners)
            Reflect.apply(listener, process, [signal]);
        })
        .catch(() => process.exit(1));
    });
  }
  return loop;
}

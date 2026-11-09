import pg from "pg";
import { createMailLoop, type MailLoop } from "../admin-access/mail-loop";
import {
  createStorage,
  storageConfig,
  type EvidenceStorage,
} from "../../adapters/storage";
import { logger } from "../../lib/logger";
import { createCorrectionsService } from "./service";
const runtime = globalThis as typeof globalThis & {
  __whrCorrections?: MailLoop;
};
/** Start even when storage configuration is lost: bounded durable attempts must still settle. */
export function startAutomaticCorrections() {
  if (
    process.env.NEXT_PHASE === "phase-production-build" ||
    !process.env.DATABASE_URL
  )
    return;
  if (runtime.__whrCorrections) return runtime.__whrCorrections;
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    query_timeout: 11000,
    idleTimeoutMillis: 10000,
    idle_in_transaction_session_timeout: 60000,
    allowExitOnIdle: true,
  });
  pool.on("error", () => logger.error({ event: "corrections.pool_failed" }));
  const storage: EvidenceStorage = {
    read: (...args) => createStorage(storageConfig()).read(...args),
    signPut: (...args) => createStorage(storageConfig()).signPut(...args),
    writeFinal: (...args) => createStorage(storageConfig()).writeFinal(...args),
  };
  const svc = createCorrectionsService({ pool, storage });
  const loop = createMailLoop({
    processNext: async () => ({ processed: await svc.processNext() }),
    close: () => pool.end(),
    batchSize: 2,
    batchBudgetMs: 10000,
    report: (counts) => {
      if (counts.processed || counts.errors)
        logger.info({ event: "corrections.validation_batch", ...counts });
    },
  });
  runtime.__whrCorrections = loop;
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

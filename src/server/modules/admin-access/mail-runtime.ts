import pg from "pg";
import { logger } from "../../lib/logger";
import { emailConfig } from "../../adapters/email-config";
import { adminConfig } from "./config";
import { processMail } from "./mail";
import { createMailLoop, MAIL_LOOP_POLICY, type MailLoop } from "./mail-loop";

type RuntimeState = { loop: MailLoop; draining: boolean };
const runtime = globalThis as typeof globalThis & {
  __whrAutomaticAdminMail?: RuntimeState;
  __whrAutomaticAdminMailStartupLogged?: boolean;
};

/** Next 16.4.5 installs its native cleanup before instrumentation. Gate those
 * handlers so its process.exit cannot race an in-flight mail acknowledgement. */
function installShutdown(state: RuntimeState) {
  const original = {
    SIGTERM: process.rawListeners("SIGTERM"),
    SIGINT: process.rawListeners("SIGINT"),
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    for (const listener of original[signal])
      process.removeListener(signal, listener as NodeJS.SignalsListener);
    process.on(signal, () => {
      if (state.draining) return;
      state.draining = true;
      const deadline = setTimeout(() => {
        logger.error({ event: "email.loop_shutdown", errors: 1 });
        process.exit(1);
      }, MAIL_LOOP_POLICY.drainMs);
      void state.loop
        .stop()
        .then(() => {
          clearTimeout(deadline);
          logger.info({ event: "email.loop_shutdown", errors: 0 });
          if (original[signal].length === 0)
            process.exit(signal === "SIGTERM" ? 143 : 130);
          // Preserve receiver, original signal argument and raw once wrappers.
          for (const listener of original[signal])
            Reflect.apply(listener, process, [signal]);
        })
        .catch(() => {
          clearTimeout(deadline);
          logger.error({ event: "email.loop_shutdown", errors: 1 });
          process.exit(1);
        });
    });
  }
}

/** Explicit provider opt-in, no work during build and one loop across module reloads. */
export function startAutomaticAdminMail() {
  const disabled =
    process.env.NEXT_PHASE === "phase-production-build"
      ? "build_phase"
      : process.env.WHR_ENV === "production" ||
          (!process.env.WHR_ENV && process.env.NODE_ENV === "production")
        ? "production"
        : !process.env.EMAIL_PROVIDER
          ? "provider_unset"
          : process.env.EMAIL_PROVIDER === "noop"
            ? "noop"
            : undefined;
  if (disabled) {
    if (!runtime.__whrAutomaticAdminMailStartupLogged) {
      runtime.__whrAutomaticAdminMailStartupLogged = true;
      logger.info({ event: "email.loop_disabled", reason: disabled });
    }
    return;
  }
  if (runtime.__whrAutomaticAdminMail)
    return runtime.__whrAutomaticAdminMail.loop;
  emailConfig();
  const config = adminConfig();
  if (!process.env.DATABASE_URL)
    throw new Error("Mail worker configuration is invalid");
  // Separate from both request and health pools; outage cannot exhaust their slots.
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
    query_timeout: 6000,
    idleTimeoutMillis: 10000,
    idle_in_transaction_session_timeout: 10000,
    allowExitOnIdle: true,
  });
  pool.on("error", () => logger.error({ event: "email.loop_pool", errors: 1 }));
  const loop = createMailLoop({
    processNext: () => processMail(pool, config),
    close: () => pool.end(),
    report: (counts) => {
      if (counts.processed || counts.errors)
        logger.info({ event: "email.loop_batch", ...counts });
    },
  });
  const state = { loop, draining: false };
  runtime.__whrAutomaticAdminMail = state;
  installShutdown(state);
  if (!runtime.__whrAutomaticAdminMailStartupLogged) {
    runtime.__whrAutomaticAdminMailStartupLogged = true;
    logger.info({ event: "email.loop_started" });
  }
  return loop;
}

/** Fail startup before serving requests if delivery could escape its approved environment. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { emailConfig, EmailConfigError } =
      await import("./server/adapters/email-config");
    const { logger } = await import("./server/lib/logger");
    try {
      emailConfig();
      const { startAutomaticAdminMail } =
        await import("./server/modules/admin-access/mail-runtime");
      startAutomaticAdminMail();
      const { startAutomaticCardExports } =
        await import("./server/modules/cards/runtime");
      startAutomaticCardExports();
      const { startAutomaticCorrections } =
        await import("./server/modules/corrections/runtime");
      startAutomaticCorrections();
    } catch (error) {
      // Next catches instrumentation exceptions and keeps listening: terminate explicitly.
      logger.error(
        error instanceof EmailConfigError
          ? {
              event: "email.config_invalid",
              reason: error.reason,
              setting: error.setting,
            }
          : { event: "email.startup_failed", reason: "config_invalid" },
      );
      process.exit(1);
    }
  }
}

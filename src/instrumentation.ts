/** Fail startup before serving requests if delivery could escape its approved environment. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { emailConfig } = await import("./server/adapters/email-config");
    try {
      emailConfig();
      if (process.env.NEXT_PHASE !== "phase-production-build") {
        const { startAutomaticAdminMail } =
          await import("./server/modules/admin-access/mail-runtime");
        startAutomaticAdminMail();
      }
    } catch {
      // Next catches instrumentation exceptions and keeps listening. Invalid
      // delivery configuration must terminate the process, not merely reject requests.
      console.error("Email configuration is invalid");
      process.exit(1);
    }
  }
}

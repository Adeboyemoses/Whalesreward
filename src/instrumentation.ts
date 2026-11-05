/** Fail startup before serving requests if delivery could escape its approved environment. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { emailConfig } = await import("./server/adapters/email-config");
    emailConfig();
  }
}

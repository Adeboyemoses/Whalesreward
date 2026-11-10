import { AuthError } from "../modules/auth/errors";

export const CARD_STORAGE_TIMEOUT_MS = 5000;
/** The race also bounds adapters/transports that ignore cancellation. */
export async function cardStorageDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new AuthError("temporarily_unavailable", 503));
      controller.abort();
    }, CARD_STORAGE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => run(controller.signal)),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

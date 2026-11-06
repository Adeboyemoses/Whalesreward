export const MAIL_LOOP_POLICY = Object.freeze({
  intervalMs: 5000,
  batchSize: 10,
  batchBudgetMs: 20000,
  drainMs: 30000,
});
export type MailCounts = {
  processed: number;
  delivered: number;
  failed: number;
  errors: number;
};
export type MailLoop = { stop(): Promise<void> };
/** A process-local timer, not a claim: processMail's database lease owns each message. */
export function createMailLoop(options: {
  processNext: () => Promise<{ processed: boolean; delivered?: boolean }>;
  close: () => Promise<void>;
  report: (counts: MailCounts) => void;
  intervalMs?: number;
  batchSize?: number;
  batchBudgetMs?: number;
  now?: () => number;
}): MailLoop {
  const interval = options.intervalMs ?? MAIL_LOOP_POLICY.intervalMs;
  const size = options.batchSize ?? MAIL_LOOP_POLICY.batchSize;
  const budget = options.batchBudgetMs ?? MAIL_LOOP_POLICY.batchBudgetMs;
  if (
    !Number.isFinite(interval) ||
    interval < 1 ||
    !Number.isInteger(size) ||
    size < 1 ||
    !Number.isFinite(budget) ||
    budget < 1
  )
    throw new Error("Mail loop policy is invalid");
  const now = options.now ?? (() => performance.now());
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<void>;
  let closing: Promise<void> | undefined;
  const report = (counts: MailCounts) => {
    try {
      options.report(counts);
    } catch {
      /* Telemetry cannot take down the service. */
    }
  };
  async function batch() {
    const counts: MailCounts = {
      processed: 0,
      delivered: 0,
      failed: 0,
      errors: 0,
    };
    const started = now();
    try {
      for (
        let step = 0;
        step < size && !stopped && now() - started < budget;
        step++
      ) {
        const result = await options.processNext();
        if (!result.processed) break;
        counts.processed++;
        if (result.delivered === true) counts.delivered++;
        if (result.delivered === false) counts.failed++;
      }
    } catch {
      counts.errors++;
    }
    report(counts);
  }
  function run() {
    active = batch().then(() => {
      if (!stopped) {
        timer = setTimeout(run, interval);
        timer.unref();
      }
    });
  }
  run();
  return {
    stop() {
      if (!closing) {
        stopped = true;
        clearTimeout(timer);
        closing = (async () => {
          await active;
          await options.close();
        })();
      }
      return closing;
    },
  };
}

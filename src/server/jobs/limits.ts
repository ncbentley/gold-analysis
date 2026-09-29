/**
 * Message processing and AI analysis call the chat model (DeepInfra when that key is set).
 * At most this many of those jobs run at once.
 */
export const REVIEW_JOB_CONCURRENCY = 200;

export const REVIEW_JOB_TYPES = ["PROCESS_EVENT", "AI_ANALYZE_SIGNAL", "AI_ANALYZE_SOURCE"] as const;

/**
 * In-flight Telegram calls shared by history pages and live updates.
 *
 * Telegram does not publish a concurrency number for messages.getHistory.
 * What it does publish:
 * - FLOOD_WAIT_X when a method is called too often (https://core.telegram.org/api/errors).
 * - One main MTProto session unless config.tmp_sessions is greater than 1.
 *   More sessions than that can invalidate the auth key
 *   (https://core.telegram.org/api/datacenter).
 * - Short cooldown FLOOD_WAITs of at most 3 seconds when a client bursts queries,
 *   even under a method limit (https://core.telegram.org/api/bots/ai).
 *
 * GramJS 2.26 spaces messages.getHistory by 1 second only after 3000 messages, and
 * by 10 seconds only when fetching more than 300 ids. A normal import is smaller
 * than that, so the library itself does not slow it down.
 *
 * Two is the cap we use: one history page and one live update can be in flight
 * on that single session, and nothing else. We do not open a second session.
 */
export const TELEGRAM_CONCURRENCY = 2;

export function createLimiter(max: number) {
  if (max < 1) throw new Error("concurrency must be at least 1");
  let active = 0;
  const waiting: Array<() => void> = [];
  return {
    get active() {
      return active;
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active >= max) {
        await new Promise<void>((resolve) => waiting.push(resolve));
      } else {
        active += 1;
      }
      try {
        return await task();
      } finally {
        const next = waiting.shift();
        if (next) next();
        else active -= 1;
      }
    },
  };
}

const telegramLimiter = createLimiter(TELEGRAM_CONCURRENCY);

/** Runs one Telegram history page or live update inside the shared cap. */
export function withTelegramSlot<T>(task: () => Promise<T>): Promise<T> {
  return telegramLimiter.run(task);
}

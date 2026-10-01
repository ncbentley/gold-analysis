import type { JobType } from "./queue";

/**
 * Each job type has its own lane. A slow Telegram sync, market pull, or AI
 * analysis cannot occupy a slot that a live PROCESS_EVENT needs.
 *
 * PROCESS_EVENT, AI_ANALYZE_SIGNAL, and AI_ANALYZE_SOURCE all call the chat
 * model. Their caps are separate on purpose, and the sum stays under the
 * provider limit (DeepInfra allows 200). Message processing keeps its slots
 * even when a backlog of signal writeups is waiting.
 */
export const JOB_CONCURRENCY: Record<JobType, number> = {
  PROCESS_EVENT: 16,
  AI_ANALYZE_SIGNAL: 8,
  AI_ANALYZE_SOURCE: 2,
  TELEGRAM_SYNC: 2, // same number as TELEGRAM_CONCURRENCY below
  MARKET_DATA_SYNC: 2,
  MARKET_DATA_BACKFILL: 1,
  RECALC_OUTCOME: 4,
  RECALC_OPEN_SIGNALS: 1,
  RECALC_ALL_SIGNALS: 1,
  REFRESH_SOURCE_STATS: 2,
  REPAIR_QUOTE_PARSES: 1,
  RECONCILE_SUBSCRIPTIONS: 1,
};

/** How soon an idle lane looks again. Enqueue wakes the lane immediately. */
export const LANE_POLL_MS: Record<JobType, number> = {
  PROCESS_EVENT: 200,
  AI_ANALYZE_SIGNAL: 500,
  AI_ANALYZE_SOURCE: 1_000,
  TELEGRAM_SYNC: 1_000,
  MARKET_DATA_SYNC: 1_000,
  MARKET_DATA_BACKFILL: 2_000,
  RECALC_OUTCOME: 500,
  RECALC_OPEN_SIGNALS: 2_000,
  RECALC_ALL_SIGNALS: 2_000,
  REFRESH_SOURCE_STATS: 2_000,
  REPAIR_QUOTE_PARSES: 2_000,
  RECONCILE_SUBSCRIPTIONS: 2_000,
};

/**
 * In-flight Telegram API calls shared by history pages.
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
 * Two is the cap we use: two history pages can be in flight on that single
 * session, and nothing else. Live updates do not take a slot; the message is
 * already in hand. We do not open a second session.
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

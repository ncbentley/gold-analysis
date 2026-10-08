import { startTwelveDataStream } from "@/server/market-data/twelvedata-stream";
import { connectTelegram } from "@/server/telegram";
import { LANE_POLL_MS, TELEGRAM_SCHEDULE_MS } from "./limits";
import { JOB_TYPES, setJobEnqueuedListener, type JobType } from "./queue";
import { processJobs, requeueStaleJobs, scheduleRecurring } from "./runner";

const g = globalThis as unknown as { __gsiWorker?: boolean; __gsiLanes?: boolean };

function enabledTypes(): JobType[] {
  const raw = process.env.WORKER_TYPES?.split(",").map((part) => part.trim()).filter(Boolean);
  if (!raw?.length) return [...JOB_TYPES];
  const known = new Set<string>(JOB_TYPES);
  const unknown = raw.filter((type) => !known.has(type));
  if (unknown.length) throw new Error(`Unknown WORKER_TYPES: ${unknown.join(", ")}`);
  return raw as JobType[];
}

/**
 * One lane per job type, in this process. Telegram stays here too: a second
 * process would open another MTProto session and can invalidate the auth key.
 * JOBS_WORKER=off on the web app so only this process claims jobs.
 */
export function startWorker() {
  if (g.__gsiWorker || process.env.JOBS_WORKER === "off") return;
  g.__gsiWorker = true;

  const types = enabledTypes();
  const enabled = new Set(types);
  setJobEnqueuedListener((type) => {
    if (!enabled.has(type)) return;
    void processJobs(5_000, [type]).catch((err) => console.error(`[worker:${type}]`, (err as Error).message));
  });

  const startLanes = () => {
    if (g.__gsiLanes) return;
    g.__gsiLanes = true;
    for (const type of types) {
      const poll = () => {
        processJobs(5_000, [type])
          .catch((err) => console.error(`[worker:${type}]`, (err as Error).message))
          .finally(() => {
            setTimeout(poll, LANE_POLL_MS[type]).unref();
          });
      };
      poll();
    }
    console.log(`[worker] lanes started: ${types.join(", ")}`);
  };

  const safe = (label: string, fn: () => Promise<unknown>) => () => {
    fn().catch((err) => console.error(`[worker] ${label} failed:`, (err as Error).message));
  };
  const minute = safe("minute", () => scheduleRecurring("minute"));
  const telegram = safe("telegram", () => scheduleRecurring("telegram"));
  const hourly = safe("hourly", () => scheduleRecurring("hourly"));
  const board = safe("board", () => scheduleRecurring("board"));

  safe("startup", async () => {
    await requeueStaleJobs();
    startLanes();
    await scheduleRecurring("minute");
    try {
      await connectTelegram();
    } catch (err) {
      console.error("[worker] telegram connect failed:", (err as Error).message);
    }
    await scheduleRecurring("telegram");
    await scheduleRecurring("hourly");
    await scheduleRecurring("board");
    startTwelveDataStream();
  })();

  setInterval(minute, 60_000).unref();
  setInterval(telegram, TELEGRAM_SCHEDULE_MS).unref();
  setInterval(hourly, 60 * 60_000).unref();
  setInterval(board, 10 * 60_000).unref();
}

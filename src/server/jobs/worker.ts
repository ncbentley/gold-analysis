import { connectTelegram } from "@/server/telegram";
import { processJobs, requeueStaleJobs, scheduleRecurring } from "./runner";

const g = globalThis as unknown as { __gsiWorker?: boolean };

/**
 * In-process scheduler for the single-instance MVP. Jobs themselves are durable rows,
 * so a restart loses nothing; for multiple instances, run this in one dedicated process
 * (JOBS_WORKER=off on the web instances).
 */
export function startWorker() {
  if (g.__gsiWorker || process.env.JOBS_WORKER === "off") return;
  g.__gsiWorker = true;

  const safe = (label: string, fn: () => Promise<unknown>) => () => {
    fn().catch((err) => console.error(`[worker] ${label} failed:`, (err as Error).message));
  };
  const tick = safe("process", () => processJobs(1000));
  const minute = safe("minute", async () => {
    await scheduleRecurring("minute");
    await processJobs(1000);
  });
  const telegram = safe("telegram", async () => {
    await scheduleRecurring("telegram");
    await processJobs(1000);
  });
  const hourly = safe("hourly", () => scheduleRecurring("hourly"));

  safe("startup", async () => {
    await requeueStaleJobs();
    await scheduleRecurring("minute");
    await connectTelegram();
    await scheduleRecurring("telegram");
    await scheduleRecurring("hourly");
    await processJobs(1000);
  })();

  setInterval(tick, 2_000).unref();
  setInterval(minute, 60_000).unref();
  setInterval(telegram, 2 * 60_000).unref();
  setInterval(hourly, 60 * 60_000).unref();
  console.log("[worker] background jobs started");
}

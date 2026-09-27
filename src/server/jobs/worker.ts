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
  const tick = safe("process", () => processJobs(200));
  const minute = safe("minute", async () => {
    await scheduleRecurring("minute");
    await processJobs(200);
  });
  const poll = safe("poll", () => scheduleRecurring("poll"));
  const hourly = safe("hourly", () => scheduleRecurring("hourly"));

  safe("startup", async () => {
    await requeueStaleJobs();
    await scheduleRecurring("minute");
    await scheduleRecurring("poll");
    await scheduleRecurring("hourly");
    await processJobs(200);
  })();

  setInterval(tick, 15_000).unref();
  setInterval(minute, 60_000).unref();
  setInterval(poll, 5 * 60_000).unref();
  setInterval(hourly, 60 * 60_000).unref();
  console.log("[worker] background jobs started");
}

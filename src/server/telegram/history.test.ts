import { describe, expect, it } from "vitest";
import { TELEGRAM_CONCURRENCY, withTelegramSlot } from "@/server/jobs/limits";
import { readHistoryPages } from "./history";

describe("telegram history concurrency", () => {
  it("does not exceed the history and live-update limit", async () => {
    let inFlight = 0;
    let max = 0;
    const pause = () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, 30);
      });
    const history = () =>
      readHistoryPages(async () => {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await pause();
        inFlight -= 1;
        return { items: [1], nextOffset: null };
      }, 1);
    const live = () =>
      withTelegramSlot(async () => {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await pause();
        inFlight -= 1;
      });

    await Promise.all([...Array.from({ length: 4 }, () => history()), ...Array.from({ length: 4 }, () => live())]);

    expect(TELEGRAM_CONCURRENCY).toBe(2);
    expect(max).toBeLessThanOrEqual(TELEGRAM_CONCURRENCY);
    expect(max).toBe(TELEGRAM_CONCURRENCY);
    expect(inFlight).toBe(0);
  });
});

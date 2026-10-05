import { describe, expect, it } from "vitest";
import { JOB_CONCURRENCY, modelCallingLanes } from "./limits";

describe("model calling lanes", () => {
  it("gives signal writeups every request the other model lanes do not reserve", () => {
    for (const cap of [200, 400]) {
      const lanes = modelCallingLanes(cap);
      const sum = lanes.PROCESS_EVENT + lanes.AI_ANALYZE_SIGNAL + lanes.AI_ANALYZE_SOURCE + lanes.MARKET_DIRECTION + lanes.REFRESH_BOARD;
      expect(sum).toBe(cap);
      expect(lanes.PROCESS_EVENT).toBe(16);
      expect(lanes.REFRESH_BOARD).toBe(1);
      expect(lanes.AI_ANALYZE_SIGNAL).toBe(cap - 20);
    }
  });

  it("uses that split for the live lane caps", () => {
    const lanes = modelCallingLanes();
    expect(JOB_CONCURRENCY.AI_ANALYZE_SIGNAL).toBe(lanes.AI_ANALYZE_SIGNAL);
    expect(JOB_CONCURRENCY.PROCESS_EVENT).toBe(lanes.PROCESS_EVENT);
    expect(JOB_CONCURRENCY.REFRESH_BOARD).toBe(lanes.REFRESH_BOARD);
  });
});

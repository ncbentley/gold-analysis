import { describe, expect, it } from "vitest";
import type { EngineBar } from "@/server/outcomes/engine";
import { replayIdea, type IdeaLevels } from "./replay";

const start = Date.UTC(2026, 0, 5, 14, 0, 0);
const idea: IdeaLevels = {
  direction: "LONG",
  entryMin: 2650,
  entryMax: 2650,
  stopLoss: 2640,
  targets: [2660, 2670],
  startedAt: start,
};

function bar(minute: number, o: number, h: number, l: number, c: number): EngineBar {
  return { t: start + minute * 60_000, o, h, l, c };
}

describe("replayIdea", () => {
  it("closes when the idea's own target is traded, without waiting on source trades", () => {
    const bars = [bar(1, 2648, 2649, 2647, 2648), bar(2, 2649, 2652, 2648, 2651), bar(3, 2654, 2662, 2653, 2661)];
    const { phase, outcome } = replayIdea(idea, bars, 2661);
    expect(outcome.entered).toBe(true);
    expect(outcome.targets[0].hitAt).not.toBeNull();
    expect(outcome.targets[1].hitAt).toBeNull();
    expect(phase).toBe("playing-out");
  });

  it("is history once the stop is traded after the fill", () => {
    const bars = [bar(1, 2649, 2651, 2648, 2650), bar(2, 2648, 2649, 2638, 2639)];
    const { phase, outcome } = replayIdea(idea, bars, 2639);
    expect(outcome.stopHitAt).not.toBeNull();
    expect(outcome.exitReason).toBe("STOP");
    expect(phase).toBe("history");
  });

  it("is history when price leaves the entry and the idea never fills", () => {
    const bars = [bar(1, 2660, 2662, 2658, 2659), bar(2, 2644, 2646, 2642, 2643)];
    const { phase, outcome } = replayIdea(idea, bars, 2643);
    expect(outcome.entered).toBe(false);
    expect(phase).toBe("history");
  });

  it("stays available when the only bar is long after the call", () => {
    const bars = [bar(60, 2640, 2642, 2638, 2640)];
    expect(replayIdea(idea, bars, 2640).phase).toBe("available");
  });

  it("stays available while spot can still fill the entry", () => {
    const bars = [bar(1, 2655, 2656, 2654, 2655)];
    expect(replayIdea(idea, bars, 2655).phase).toBe("available");
  });
});
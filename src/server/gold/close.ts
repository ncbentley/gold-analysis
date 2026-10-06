export const CLOSE_HOLD_MS = 2 * 60 * 60 * 1000;

export function exitBar<T extends { t: number }>(bars: T[], calledAt: number): T | null {
  return bars.find((bar) => bar.t > calledAt) ?? null;
}

export function goldSection(
  entry: {
    sectionAtCall: "available" | "active" | null;
    closeCalledAt: number | null;
    phase?: "available" | "playing-out" | "history";
  },
  now: number,
): "available" | "active" | "history" {
  if (entry.closeCalledAt !== null && entry.sectionAtCall) {
    return now < entry.closeCalledAt + CLOSE_HOLD_MS ? entry.sectionAtCall : "history";
  }
  if (entry.phase === "playing-out") return "active";
  if (entry.phase === "history") return "history";
  return "available";
}

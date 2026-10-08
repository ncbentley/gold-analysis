const MINUTE = 60_000;

/** Two hours before the call through ninety minutes after the exit, or through now while it is open. */
export function tradeChartRange(calledAt: number, exitTime: number | null, now: number) {
  const from = calledAt - 120 * MINUTE;
  const to = Math.min(now, (exitTime ?? now) + 90 * MINUTE);
  return { from: new Date(from), to: new Date(to + MINUTE) };
}

/**
 * A sentence when the stored series cannot show this call.
 * One bar is enough to draw. A hole around the call is a separate fact.
 */
export function marketDataNotice(input: { bars: { t: number }[]; calledAt: number; filledAt: number | null }): string | null {
  const { bars, calledAt, filledAt } = input;
  if (!bars.length) return "No XAU/USD bars are stored for this call. Price cannot be replayed.";
  if (filledAt !== null && !bars.some((bar) => Math.abs(bar.t - filledAt) <= 2 * MINUTE)) {
    return "This call filled, but the bars around that fill are not stored.";
  }
  const after = bars.filter((bar) => bar.t >= calledAt);
  if (!after.length) return "Stored bars stop before this call.";
  const first = Math.min(...after.map((bar) => bar.t));
  if (first - calledAt > 20 * MINUTE) return "The first stored bar is after the call. The path in between is missing.";
  return null;
}

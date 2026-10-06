import { exitBar } from "./close";

export function settleClose(
  entry: { sectionAtCall: "available" | "active"; calledAt: number },
  bars: { t: number; o: number }[],
): { exitTime: number; exitPrice: number | null; retired: boolean } | null {
  const bar = exitBar(bars, entry.calledAt);
  if (!bar) return null;
  if (entry.sectionAtCall === "available") return { exitTime: bar.t, exitPrice: null, retired: true };
  return { exitTime: bar.t, exitPrice: bar.o, retired: false };
}

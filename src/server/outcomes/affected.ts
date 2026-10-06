export function barAffectsSignal(
  signal: { status: string; entryMin: number; entryMax: number; entryType: "MARKET" | "LIMIT" | "ZONE" },
  bar: { h: number; l: number },
): boolean {
  if (signal.status === "ACTIVE" || signal.status === "PARTIAL") return true;
  if (signal.status !== "PENDING") return false;
  if (signal.entryType === "MARKET") return true;
  return bar.h >= signal.entryMin && bar.l <= signal.entryMax;
}

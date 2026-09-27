export interface ProviderBar {
  timestamp: Date; // bar open, UTC
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface MarketDataProvider {
  name: string;
  /** Returns 1-minute bars with timestamp in [from, to). */
  fetchMinuteBars(instrument: string, from: Date, to: Date): Promise<ProviderBar[]>;
}

/** Spot gold trades roughly Sunday 22:00 UTC to Friday 21:00 UTC. */
export function isGoldMarketOpen(t: Date) {
  const day = t.getUTCDay();
  const h = t.getUTCHours();
  if (day === 6) return false;
  if (day === 5 && h >= 21) return false;
  if (day === 0 && h < 22) return false;
  return true;
}

export interface NumericBounds {
  min: number | null;
  max: number | null;
}

export interface TopSourceNumericFilter {
  closedTrades: NumericBounds;
  /** Inclusive bounds on the win rate shown in the table, as a whole percent. */
  winRatePercent: NumericBounds;
  expectancy: NumericBounds;
}

const PARTIAL_NUMBER = /^[+-]?(\d+\.?\d*|\.\d*)?$/;

export function interpretBound(raw: string): { value: number | null; invalid: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, invalid: false };
  if (!PARTIAL_NUMBER.test(trimmed)) return { value: null, invalid: true };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { value: null, invalid: false };
  return { value: n, invalid: false };
}

export function displayedWinRatePercent(winRate: number | null) {
  if (winRate === null) return null;
  return Math.round(winRate * 100);
}

export function boundsActive(bounds: NumericBounds) {
  return bounds.min !== null || bounds.max !== null;
}

export function boundsInverted(bounds: NumericBounds) {
  return bounds.min !== null && bounds.max !== null && bounds.min > bounds.max;
}

export function filterActive(filter: TopSourceNumericFilter) {
  return boundsActive(filter.closedTrades) || boundsActive(filter.winRatePercent) || boundsActive(filter.expectancy);
}

function inBounds(value: number | null, bounds: NumericBounds) {
  if (!boundsActive(bounds)) return true;
  if (boundsInverted(bounds)) return false;
  if (value === null) return false;
  if (bounds.min !== null && value < bounds.min) return false;
  if (bounds.max !== null && value > bounds.max) return false;
  return true;
}

export function matchesTopSourceRow(
  row: { closedTrades: number; metrics: { winRate: number | null; expectancy: number | null } | null },
  filter: TopSourceNumericFilter,
) {
  if (!inBounds(row.closedTrades, filter.closedTrades)) return false;
  if (!inBounds(displayedWinRatePercent(row.metrics?.winRate ?? null), filter.winRatePercent)) return false;
  if (!inBounds(row.metrics?.expectancy ?? null, filter.expectancy)) return false;
  return true;
}

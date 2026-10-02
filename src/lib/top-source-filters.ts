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

export type TopSourceSortKey = "rank" | "source" | "closedTrades" | "winRate" | "expectancy";
export type TopSourceSortDir = "asc" | "desc";

export interface TopSourceSort {
  key: TopSourceSortKey;
  dir: TopSourceSortDir;
}

const NUMERIC_SORT = new Set<TopSourceSortKey>(["closedTrades", "winRate", "expectancy"]);

/** A new column starts high-to-low for numbers and A-to-Z for names. Clicking the active column flips direction. */
export function toggleTopSourceSort(current: TopSourceSort, key: TopSourceSortKey): TopSourceSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: NUMERIC_SORT.has(key) ? "desc" : "asc" };
}

export interface RankedTopSource {
  rank: number;
  row: { name: string; closedTrades: number; metrics: { winRate: number | null; expectancy: number | null } | null };
}

function sortValue(item: RankedTopSource, key: TopSourceSortKey): number | null {
  if (key === "closedTrades") return item.row.closedTrades;
  if (key === "winRate") return displayedWinRatePercent(item.row.metrics?.winRate ?? null);
  if (key === "expectancy") return item.row.metrics?.expectancy ?? null;
  return item.rank;
}

/** Missing win rates and expectancy stay at the bottom in either direction. Ties keep the original rank. */
export function sortTopSources<T extends RankedTopSource>(items: readonly T[], sort: TopSourceSort): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    if (sort.key === "source") {
      const names = a.row.name.localeCompare(b.row.name, undefined, { sensitivity: "base" });
      return names === 0 ? a.rank - b.rank : names * sign;
    }
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    if (left === null && right === null) return a.rank - b.rank;
    if (left === null) return 1;
    if (right === null) return -1;
    if (left === right) return a.rank - b.rank;
    return (left - right) * sign;
  });
}

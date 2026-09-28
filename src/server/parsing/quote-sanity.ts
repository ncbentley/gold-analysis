/** Gold quotes more than this far from the traded price are not market fills. */
export const MAX_QUOTE_DISTANCE = 80;

/** Distance from a price to the closed entry interval. Zero when price is inside it. */
export function distanceToQuote(price: number, entryMin: number, entryMax: number) {
  const lo = Math.min(entryMin, entryMax);
  const hi = Math.max(entryMin, entryMax);
  if (price < lo) return lo - price;
  if (price > hi) return price - hi;
  return 0;
}

export function quoteIsPlausible(price: number, entryMin: number, entryMax: number, max = MAX_QUOTE_DISTANCE) {
  return distanceToQuote(price, entryMin, entryMax) <= max;
}

/**
 * "4155-60" means 4155–4160. The second number is the last two digits of the
 * other side of the zone, rolling into the next hundred when it is smaller
 * (4198-02 → 4198–4202). A full gold price on both sides is left to the
 * normal zone matcher.
 */
export function expandShortTail(anchor: number, tail: number): number | null {
  if (!Number.isInteger(tail) || tail < 0 || tail > 99) return null;
  if (anchor < 1000 || anchor > 20_000) return null;
  const hundred = Math.floor(anchor / 100) * 100;
  const lastTwo = anchor % 100;
  const other = hundred + tail + (tail <= lastTwo ? 100 : 0);
  if (other < 1000 || other > 20_000) return null;
  const width = Math.abs(other - anchor);
  if (width < 0.05 || width > 30) return null;
  return other;
}

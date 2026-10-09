const MINUTE = 60_000;

export const PATH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function minuteStart(t: number) {
  return Math.floor(t / MINUTE) * MINUTE;
}

export interface StoredPath {
  minute: number;
  offsets: number[];
  prices: number[];
}

/** Vendor time, then the order the prints were given. Consecutive equal prices keep the earliest. */
export function collapsePrints(minute: number, prints: { t: number; price: number }[]): StoredPath {
  const ordered = [...prints].sort((a, b) => a.t - b.t);
  const offsets: number[] = [];
  const prices: number[] = [];
  for (const print of ordered) {
    if (prices.length && prices[prices.length - 1] === print.price) continue;
    offsets.push(print.t - minute);
    prices.push(print.price);
  }
  return { minute, offsets, prices };
}

/** Insert by vendor time. An equal vendor time stays behind prints already stored. */
export function mergePrint(path: StoredPath, print: { t: number; price: number }): StoredPath {
  const offset = print.t - path.minute;
  const offsets = [...path.offsets];
  const prices = [...path.prices];
  let at = 0;
  while (at < offsets.length && offsets[at] <= offset) at += 1;
  offsets.splice(at, 0, offset);
  prices.splice(at, 0, print.price);
  return collapsePrints(
    path.minute,
    offsets.map((off, index) => ({ t: path.minute + off, price: prices[index] })),
  );
}

export function expandPath(path: StoredPath): { t: number; price: number }[] {
  return path.prices.map((price, index) => ({ t: path.minute + path.offsets[index], price }));
}

export function routePrint(openMinute: number | null, printTime: number): "buffer" | "seal" | "merge" {
  const minute = minuteStart(printTime);
  if (openMinute !== null && minute < openMinute) return "merge";
  if (openMinute !== null && minute > openMinute) return "seal";
  return "buffer";
}

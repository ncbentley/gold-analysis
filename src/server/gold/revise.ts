function cents(price: number) {
  return Math.round(price * 100);
}

/** Same direction and entry. A new target list on that entry is the same call. */
export function sameGoldEntry(
  a: { direction: string; entryMin: number; entryMax: number },
  b: { direction: string; entryMin: number; entryMax: number },
) {
  return a.direction === b.direction && cents(a.entryMin) === cents(b.entryMin) && cents(a.entryMax) === cents(b.entryMax);
}

/**
 * Replaces targets price has not hit. Hit targets stay, in order.
 * An unfilled call takes the new list.
 */
export function reviseOpenTargets(current: number[], next: number[], hit: boolean[]) {
  const clean = next.filter((price) => Number.isFinite(price));
  if (!clean.length) return current;
  const kept = current.filter((_, index) => hit[index] === true);
  if (!kept.length) return clean;
  const keptCents = new Set(kept.map(cents));
  const fresh = clean.filter((price) => !keptCents.has(cents(price)));
  return [...kept, ...fresh];
}

export function targetsEdited(current: number[], revised: number[]) {
  return current.map(cents).join(",") !== revised.map(cents).join(",");
}

/** An unfilled call can take a new stop. A fill keeps the stop it was entered with. */
export function reviseOpenCall(input: {
  entered: boolean;
  stopLoss: number | null;
  nextStop: number | null;
  currentTargets: number[];
  nextTargets: number[];
  hit: boolean[];
}) {
  const targets = reviseOpenTargets(input.currentTargets, input.nextTargets, input.hit);
  const stopLoss = !input.entered && input.nextStop !== null && Number.isFinite(input.nextStop) ? input.nextStop : input.stopLoss;
  const stopChanged = cents(stopLoss ?? 0) !== cents(input.stopLoss ?? 0) || (stopLoss === null) !== (input.stopLoss === null);
  return { stopLoss, targets, edited: stopChanged || targetsEdited(input.currentTargets, targets) };
}

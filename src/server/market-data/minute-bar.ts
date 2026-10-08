export interface MinuteBar {
  /** Open time of the minute, epoch ms. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

const MINUTE = 60_000;

/** Folds one price print into the minute it belongs to. A later minute seals the bar before it. */
export function applyPrint(open: MinuteBar | null, print: { t: number; price: number }): { sealed: MinuteBar | null; open: MinuteBar } {
  const bucket = Math.floor(print.t / MINUTE) * MINUTE;
  if (!open || open.t !== bucket) {
    return { sealed: open, open: { t: bucket, o: print.price, h: print.price, l: print.price, c: print.price } };
  }
  return {
    sealed: null,
    open: {
      t: open.t,
      o: open.o,
      h: Math.max(open.h, print.price),
      l: Math.min(open.l, print.price),
      c: print.price,
    },
  };
}

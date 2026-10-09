import { describe, expect, it } from "vitest";
import { collapsePrints, expandPath, mergePrint, minuteStart, PATH_RETENTION_MS, routePrint } from "./minute-path";

const MINUTE = 60_000;

describe("minute paths", () => {
  it("keeps vendor order and drops a consecutive duplicate", () => {
    const path = collapsePrints(0, [
      { t: 30, price: 101 },
      { t: 10, price: 100 },
      { t: 20, price: 100 },
    ]);
    expect(path).toEqual({ minute: 0, offsets: [10, 30], prices: [100, 101] });
    expect(expandPath(path)).toEqual([
      { t: 10, price: 100 },
      { t: 30, price: 101 },
    ]);
  });

  it("keeps a price that returns after a different price", () => {
    const path = collapsePrints(0, [
      { t: 30, price: 100 },
      { t: 10, price: 100 },
      { t: 20, price: 101 },
    ]);
    expect(path).toEqual({ minute: 0, offsets: [10, 20, 30], prices: [100, 101, 100] });
  });

  it("keeps both prices when two prints share a vendor time", () => {
    const path = collapsePrints(0, [
      { t: 10, price: 100 },
      { t: 10, price: 101 },
    ]);
    expect(path).toEqual({ minute: 0, offsets: [10, 10], prices: [100, 101] });
  });

  it("merges a late print by vendor time", () => {
    const sealed = collapsePrints(MINUTE, [
      { t: MINUTE + 10, price: 100 },
      { t: MINUTE + 40, price: 102 },
    ]);
    expect(mergePrint(sealed, { t: MINUTE + 20, price: 101 })).toEqual({
      minute: MINUTE,
      offsets: [10, 20, 40],
      prices: [100, 101, 102],
    });
  });

  it("keeps the earlier print when the late price matches its neighbor", () => {
    const sealed = collapsePrints(0, [
      { t: 10, price: 100 },
      { t: 40, price: 102 },
    ]);
    expect(mergePrint(sealed, { t: 20, price: 100 }).prices).toEqual([100, 102]);
  });

  it("places an equal vendor time behind prints already stored", () => {
    const sealed = collapsePrints(0, [{ t: 10, price: 100 }]);
    expect(mergePrint(sealed, { t: 10, price: 101 })).toEqual({
      minute: 0,
      offsets: [10, 10],
      prices: [100, 101],
    });
  });

  it("routes a print to the buffer, a seal, or a merge", () => {
    expect(routePrint(null, 5_000)).toBe("buffer");
    expect(routePrint(0, 5_000)).toBe("buffer");
    expect(routePrint(0, MINUTE + 1)).toBe("seal");
    expect(routePrint(MINUTE, 5_000)).toBe("merge");
  });

  it("retains a path for 30 days from the minute open", () => {
    expect(PATH_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(minuteStart(MINUTE + 5)).toBe(MINUTE);
  });
});

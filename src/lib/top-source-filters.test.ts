import { describe, expect, it } from "vitest";
import { interpretBound, matchesTopSourceRow, type TopSourceNumericFilter } from "./top-source-filters";

const open: TopSourceNumericFilter = {
  closedTrades: { min: null, max: null },
  winRatePercent: { min: null, max: null },
  expectancy: { min: null, max: null },
};

const ranked = {
  closedTrades: 40,
  metrics: { winRate: 0.695, expectancy: 0.24 },
};

describe("interpretBound", () => {
  it("treats empty and unfinished input as unset", () => {
    expect(interpretBound("")).toEqual({ value: null, invalid: false });
    expect(interpretBound("  ")).toEqual({ value: null, invalid: false });
    expect(interpretBound("-")).toEqual({ value: null, invalid: false });
    expect(interpretBound(".")).toEqual({ value: null, invalid: false });
  });

  it("parses numbers and rejects other text", () => {
    expect(interpretBound("20")).toEqual({ value: 20, invalid: false });
    expect(interpretBound("-1.5")).toEqual({ value: -1.5, invalid: false });
    expect(interpretBound("1e2")).toEqual({ value: null, invalid: true });
    expect(interpretBound("nope")).toEqual({ value: null, invalid: true });
  });
});

describe("matchesTopSourceRow", () => {
  it("keeps every row when no bound is set, including locked metrics", () => {
    expect(matchesTopSourceRow(ranked, open)).toBe(true);
    expect(matchesTopSourceRow({ closedTrades: 20, metrics: null }, open)).toBe(true);
  });

  it("applies inclusive bounds on each numerical column", () => {
    expect(matchesTopSourceRow(ranked, { ...open, closedTrades: { min: 40, max: 40 } })).toBe(true);
    expect(matchesTopSourceRow(ranked, { ...open, closedTrades: { min: 41, max: null } })).toBe(false);
    expect(matchesTopSourceRow(ranked, { ...open, winRatePercent: { min: 70, max: 70 } })).toBe(true);
    expect(matchesTopSourceRow(ranked, { ...open, winRatePercent: { min: 71, max: null } })).toBe(false);
    expect(matchesTopSourceRow(ranked, { ...open, expectancy: { min: null, max: 0.24 } })).toBe(true);
    expect(matchesTopSourceRow(ranked, { ...open, expectancy: { min: null, max: 0.2 } })).toBe(false);
  });

  it("drops locked rows once win rate or expectancy is bounded", () => {
    const locked = { closedTrades: 80, metrics: null };
    expect(matchesTopSourceRow(locked, { ...open, closedTrades: { min: 50, max: null } })).toBe(true);
    expect(matchesTopSourceRow(locked, { ...open, winRatePercent: { min: 50, max: null } })).toBe(false);
    expect(matchesTopSourceRow(locked, { ...open, expectancy: { min: null, max: 1 } })).toBe(false);
  });

  it("matches nothing when a minimum is above its maximum", () => {
    expect(matchesTopSourceRow(ranked, { ...open, expectancy: { min: 1, max: 0 } })).toBe(false);
  });
});

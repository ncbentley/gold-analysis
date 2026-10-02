import { describe, expect, it } from "vitest";
import { interpretBound, matchesTopSourceRow, sortTopSources, toggleTopSourceSort, type TopSourceNumericFilter, type TopSourceSort } from "./top-source-filters";

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

describe("sortTopSources", () => {
  const rows = [
    { rank: 1, row: { name: "Cedar", closedTrades: 20, metrics: { winRate: 0.4, expectancy: 0.5 } } },
    { rank: 2, row: { name: "alpha", closedTrades: 50, metrics: { winRate: 0.695, expectancy: 0.2 } } },
    { rank: 3, row: { name: "Birch", closedTrades: 30, metrics: null } },
  ];
  const byExpectancy: TopSourceSort = { key: "expectancy", dir: "desc" };

  it("starts a number column high-to-low and flips the active column", () => {
    expect(toggleTopSourceSort(byExpectancy, "winRate")).toEqual({ key: "winRate", dir: "desc" });
    expect(toggleTopSourceSort(byExpectancy, "expectancy")).toEqual({ key: "expectancy", dir: "asc" });
    expect(toggleTopSourceSort(byExpectancy, "source")).toEqual({ key: "source", dir: "asc" });
  });

  it("sorts numbers, keeps locked metrics at the bottom, and breaks ties by rank", () => {
    expect(sortTopSources(rows, { key: "closedTrades", dir: "desc" }).map((item) => item.rank)).toEqual([2, 3, 1]);
    expect(sortTopSources(rows, { key: "winRate", dir: "desc" }).map((item) => item.rank)).toEqual([2, 1, 3]);
    expect(sortTopSources(rows, { key: "winRate", dir: "asc" }).map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(sortTopSources(rows, { key: "expectancy", dir: "asc" }).map((item) => item.rank)).toEqual([2, 1, 3]);
    expect(sortTopSources(rows, { key: "source", dir: "asc" }).map((item) => item.row.name)).toEqual(["alpha", "Birch", "Cedar"]);
  });
});

import { describe, expect, it } from "vitest";
import { groupSignals, type GroupSignal } from "./group";

const t0 = Date.parse("2026-10-02T14:00:00Z");

function sig(p: Partial<GroupSignal> & Pick<GroupSignal, "id" | "sourceId">): GroupSignal {
  return {
    direction: "LONG",
    entryMin: 2650,
    entryMax: 2650,
    stopLoss: 2644,
    targets: [2660],
    signalTime: t0,
    status: "ACTIVE",
    qa: false,
    ...p,
  };
}

describe("groupSignals", () => {
  it("averages two close longs from different sources", () => {
    const [idea] = groupSignals(
      [
        sig({ id: "a", sourceId: "s1", entryMin: 2650, entryMax: 2652, stopLoss: 2644, targets: [2660, 2670] }),
        sig({ id: "b", sourceId: "s2", signalTime: t0 + 10 * 60_000, entryMin: 2651, entryMax: 2651, stopLoss: 2646, targets: [2662] }),
      ],
      t0 + 20 * 60_000,
    );
    expect(idea.signalIds).toEqual(["a", "b"]);
    expect(idea.entryMin).toBe(2650.5);
    expect(idea.entryMax).toBe(2651.5);
    expect(idea.stopLoss).toBe(2645);
    expect(idea.targets).toEqual([2661, 2670]);
    expect(idea.exitSpreadStops).toBe(2);
    expect(idea.frozenAt).toBeNull();
  });

  it("does not merge opposite directions or entries more than $2 apart", () => {
    const ideas = groupSignals(
      [
        sig({ id: "a", sourceId: "s1" }),
        sig({ id: "b", sourceId: "s2", direction: "SHORT" }),
        sig({ id: "c", sourceId: "s3", entryMin: 2660, entryMax: 2660 }),
      ],
      t0,
    );
    expect(ideas).toHaveLength(3);
  });

  it("lets a later post from the same source replace the earlier one", () => {
    const [idea] = groupSignals(
      [
        sig({ id: "a", sourceId: "s1", entryMin: 2650, entryMax: 2650, signalTime: t0 }),
        sig({ id: "b", sourceId: "s1", entryMin: 2652, entryMax: 2652, signalTime: t0 + 5 * 60_000 }),
      ],
      t0 + 10 * 60_000,
    );
    expect(idea.signalIds).toEqual(["b"]);
    expect(idea.replacedSignalIds).toEqual(["a"]);
    expect(idea.entryMin).toBe(2652);
  });

  it("drops invalid, cancelled, QA, and entry-less signals", () => {
    expect(
      groupSignals(
        [
          sig({ id: "a", sourceId: "s1", status: "INVALID" }),
          sig({ id: "b", sourceId: "s2", status: "CANCELLED" }),
          sig({ id: "c", sourceId: "s3", qa: true }),
        ],
        t0,
      ),
    ).toEqual([]);
  });

  it("freezes an idea after 30 quiet minutes", () => {
    const [idea] = groupSignals([sig({ id: "a", sourceId: "s1" })], t0 + 30 * 60_000);
    expect(idea.frozenAt).toBe(t0 + 30 * 60_000);
  });

  it("keeps frozenAt at first quiet boundary, not later now", () => {
    const [idea] = groupSignals([sig({ id: "a", sourceId: "s1" })], t0 + 90 * 60_000);
    expect(idea.frozenAt).toBe(t0 + 30 * 60_000);
  });
});

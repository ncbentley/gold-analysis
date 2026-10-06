import { describe, expect, it } from "vitest";
import { tradeMarkers } from "./trade-markers";

describe("tradeMarkers", () => {
  it("labels the call, the fill, each target, and the stop with a time", () => {
    const markers = tradeMarkers({
      calledAt: Date.UTC(2026, 9, 6, 15, 0),
      timeline: [
        { t: Date.UTC(2026, 9, 6, 15, 2), type: "ENTRY", price: 2650 },
        { t: Date.UTC(2026, 9, 6, 15, 10), type: "TARGET", note: "TP1" },
        { t: Date.UTC(2026, 9, 6, 15, 20), type: "STOP" },
      ],
    });
    expect(markers.map((marker) => marker.label.split(" ")[0] === "TP1" ? "TP1" : marker.label.split(" ")[0])).toEqual(["Called", "Filled", "TP1", "Stop"]);
    expect(markers[1].t).toBe(Date.UTC(2026, 9, 6, 15, 2));
    expect(markers[0].label.startsWith("Called")).toBe(true);
    expect(markers[1].label.startsWith("Filled")).toBe(true);
    expect(markers[2].label.startsWith("TP1")).toBe(true);
    expect(markers[3].label.startsWith("Stop")).toBe(true);
  });

  it("adds a gold close call and its fill", () => {
    const markers = tradeMarkers({
      calledAt: Date.UTC(2026, 9, 6, 15, 0),
      timeline: [],
      goldClose: { calledAt: Date.UTC(2026, 9, 6, 16, 0), exitTime: Date.UTC(2026, 9, 6, 16, 1) },
    });
    expect(markers.map((marker) => marker.label.startsWith("Close"))).toEqual([false, true, true]);
    expect(markers[1].label.startsWith("Close called")).toBe(true);
    expect(markers[2].label.startsWith("Close filled")).toBe(true);
  });
});

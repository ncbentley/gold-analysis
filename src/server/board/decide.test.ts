import { describe, expect, it } from "vitest";
import { decideBoard, type BoardSnapshot } from "./decide";

const live: BoardSnapshot = { signalIds: ["s1"], ideaIds: ["i1"], directionKey: "news-1" };

describe("decideBoard", () => {
  it("clears the board when nothing is available or playing out", () => {
    expect(decideBoard({ signalIds: [], ideaIds: [], directionKey: "news-1" }, live)).toBe("clear");
  });

  it("skips the model when the live set and the news read are unchanged", () => {
    expect(decideBoard(live, live)).toBe("keep");
  });

  it("keeps a playing-out trade on screen when the only change is a label", () => {
    expect(decideBoard({ ...live, signalIds: ["s1"] }, { ...live, signalIds: ["s1", "gone"] })).toBe("keep");
  });

  it("does not call when a setup has only moved out of the live set", () => {
    expect(decideBoard({ signalIds: ["s1"], ideaIds: [], directionKey: "news-1" }, live)).toBe("keep");
  });

  it("calls when a new raw signal is available", () => {
    expect(decideBoard({ ...live, signalIds: ["s1", "s2"] }, live)).toBe("call");
  });

  it("calls when the direction snapshot changes and something is still live", () => {
    expect(decideBoard({ ...live, directionKey: "news-2" }, live)).toBe("call");
  });
});

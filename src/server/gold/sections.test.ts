import { describe, expect, it } from "vitest";
import { byNewest } from "./sections";

describe("byNewest", () => {
  it("puts the newest call first so a history preview is not table order", () => {
    const older = { id: "old", newestSignalAt: "2026-10-06T20:49:21.000Z" };
    const newer = { id: "new", newestSignalAt: "2026-10-09T02:27:07.000Z" };
    const middle = { id: "mid", newestSignalAt: "2026-10-07T12:40:53.000Z" };
    expect(byNewest([older, middle, newer]).map((row) => row.id)).toEqual(["new", "mid", "old"]);
  });
});

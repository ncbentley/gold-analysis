import { describe, expect, it } from "vitest";
import { settleClose } from "./settle";

const calledAt = Date.UTC(2026, 9, 6, 15, 0, 30);
const bars = [
  { t: Date.UTC(2026, 9, 6, 15, 0), o: 2650 },
  { t: Date.UTC(2026, 9, 6, 15, 1), o: 2651.2 },
];

describe("settleClose", () => {
  it("retires an available idea with no price", () => {
    expect(settleClose({ sectionAtCall: "available", calledAt }, bars)).toEqual({
      exitTime: Date.UTC(2026, 9, 6, 15, 1),
      exitPrice: null,
      retired: true,
    });
  });

  it("exits an active idea at the next bar open", () => {
    expect(settleClose({ sectionAtCall: "active", calledAt }, bars)).toEqual({
      exitTime: Date.UTC(2026, 9, 6, 15, 1),
      exitPrice: 2651.2,
      retired: false,
    });
  });

  it("waits when the next bar is missing", () => {
    expect(settleClose({ sectionAtCall: "active", calledAt }, [bars[0]])).toBeNull();
  });
});

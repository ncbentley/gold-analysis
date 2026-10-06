import { describe, expect, it } from "vitest";
import { sourcesRetired } from "./retire";

const expired = { status: "EXPIRED", outcome: { entered: false, exitTime: null, classification: "EXPIRED" } };
const pending = { status: "PENDING", outcome: null };
const filled = { status: "ACTIVE", outcome: { entered: true, exitTime: null, classification: "ACTIVE" } };

describe("sourcesRetired", () => {
  it("closes a call whose sources all expired without a fill", () => {
    expect(sourcesRetired([expired, { status: "CANCELLED", outcome: null }])).toBe(true);
  });

  it("keeps a call that still has a live source", () => {
    expect(sourcesRetired([expired, pending])).toBe(false);
  });

  it("keeps a call that already filled", () => {
    expect(sourcesRetired([filled, expired])).toBe(false);
  });

  it("does not invent a close when the call has no sources", () => {
    expect(sourcesRetired([])).toBe(false);
  });
});

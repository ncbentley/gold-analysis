import { describe, expect, it } from "vitest";
import { scoreDirection } from "./score";

describe("scoreDirection", () => {
  it("leans bid when escalation headlines outnumber de-escalation", () => {
    const scored = scoreDirection({
      change60m: null,
      headlines: [
        { text: "Projectile strike ignites a tanker in the Strait of Hormuz" },
        { text: "US deploys a third carrier and more troops" },
        { text: "Iran says it stays open to talks" },
      ],
    });
    expect(scored).toEqual({ lean: "bid", bid: 2, offer: 1 });
  });

  it("leans offered when talks outnumber escalation and price is not ripping higher", () => {
    const scored = scoreDirection({
      change60m: 1,
      headlines: [{ text: "Iran stays open to talks" }, { text: "Putin hopes the strait reopens" }, { text: "Germany preparing for attacks" }],
    });
    expect(scored).toEqual({ lean: "offered", bid: 1, offer: 2 });
  });

  it("stays defensive when the two sides tie", () => {
    expect(
      scoreDirection({
        change60m: 0,
        headlines: [{ text: "Tanker strike in Hormuz" }, { text: "Iran open to talks" }],
      }).lean,
    ).toBe("defensive");
  });

  it("stays defensive when a falling price cancels an escalation lean", () => {
    expect(
      scoreDirection({
        change60m: -12,
        headlines: [{ text: "Third carrier and more troops" }],
      }).lean,
    ).toBe("defensive");
  });
});

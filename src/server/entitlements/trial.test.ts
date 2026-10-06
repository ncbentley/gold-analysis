import { describe, expect, it } from "vitest";
import { can } from "./access";
import { DEFAULT_TIER_CONFIG } from "./config";
import { accessForMember, showTrialBanner, TRIAL_MS } from "./trial";

const config = DEFAULT_TIER_CONFIG;
const createdAt = new Date("2026-10-01T00:00:00.000Z");
const during = new Date(createdAt.getTime() + TRIAL_MS - 1000);
const after = new Date(createdAt.getTime() + TRIAL_MS + 1000);

describe("trial access", () => {
  it("shows free access during the trial when no plan is chosen", () => {
    const access = accessForMember({ createdAt, now: during, subscription: null, config });
    expect(access.tier).toBeNull();
    expect(can(access, "signals.core")).toBe(true);
    expect(access.historyDays).toBe(7);
  });

  it("locks the book after the trial when no plan is chosen", () => {
    const access = accessForMember({ createdAt, now: after, subscription: null, config });
    expect(can(access, "signals.core")).toBe(false);
  });

  it("grants gold for the rest of the trial when the chosen plan is silver", () => {
    const access = accessForMember({
      createdAt,
      now: during,
      subscription: { tier: "silver" },
      config,
    });
    expect(access.tier).toBe("gold");
    expect(access.historyDays).toBeNull();
  });

  it("uses the chosen plan once the trial has ended", () => {
    const access = accessForMember({
      createdAt,
      now: after,
      subscription: { tier: "silver" },
      config,
    });
    expect(access.tier).toBe("silver");
    expect(access.historyDays).toBe(180);
  });
});

it("shows the banner until a plan is chosen, and only during the trial", () => {
  expect(showTrialBanner({ createdAt, now: during, hasPlan: false })).toBe(true);
  expect(showTrialBanner({ createdAt, now: during, hasPlan: true })).toBe(false);
  expect(showTrialBanner({ createdAt, now: after, hasPlan: false })).toBe(false);
});

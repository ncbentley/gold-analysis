import { describe, expect, it } from "vitest";
import { completeMockCheckout, startCheckout, stopsAtPeriodEnd } from "./service";

describe("startCheckout", () => {
  it("refuses a new Gold subscription before any billing call", async () => {
    await expect(startCheckout({ id: "user", email: "a@example.com" }, "gold", "monthly")).rejects.toThrow("Gold is no longer offered.");
  });

  it("refuses a new Platinum weekly subscription before any billing call", async () => {
    await expect(startCheckout({ id: "user", email: "a@example.com" }, "platinum", "weekly")).rejects.toThrow(
      "Platinum weekly is no longer offered.",
    );
  });
});

describe("completeMockCheckout", () => {
  it("refuses Gold and Platinum weekly before creating a subscription", async () => {
    await expect(completeMockCheckout("user", "gold", "monthly")).rejects.toThrow("Gold is no longer offered.");
    await expect(completeMockCheckout("user", "platinum", "weekly")).rejects.toThrow("Platinum weekly is no longer offered.");
  });
});

describe("stopsAtPeriodEnd", () => {
  it("stops Gold and weekly Platinum when the paid period ends", () => {
    expect(stopsAtPeriodEnd({ tier: "gold", period: "weekly" })).toBe(true);
    expect(stopsAtPeriodEnd({ tier: "gold", period: "monthly" })).toBe(true);
    expect(stopsAtPeriodEnd({ tier: "gold", period: "annual" })).toBe(true);
    expect(stopsAtPeriodEnd({ tier: "platinum", period: "weekly" })).toBe(true);
  });

  it("keeps renewing Silver and Platinum monthly or annual", () => {
    expect(stopsAtPeriodEnd({ tier: "silver", period: "weekly" })).toBe(false);
    expect(stopsAtPeriodEnd({ tier: "silver", period: "monthly" })).toBe(false);
    expect(stopsAtPeriodEnd({ tier: "platinum", period: "monthly" })).toBe(false);
    expect(stopsAtPeriodEnd({ tier: "platinum", period: "annual" })).toBe(false);
  });
});

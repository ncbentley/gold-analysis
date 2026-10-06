import { describe, expect, it } from "vitest";
import { completeMockCheckout, startCheckout, stopsAtPeriodEnd } from "./service";

describe("startCheckout", () => {
  it("refuses a new Gold weekly subscription before any billing call", async () => {
    await expect(startCheckout({ id: "user", email: "a@example.com" }, "gold", "weekly")).rejects.toThrow(
      "Gold weekly is no longer offered.",
    );
  });
});

describe("completeMockCheckout", () => {
  it("refuses Gold weekly before creating a subscription", async () => {
    await expect(completeMockCheckout("user", "gold", "weekly")).rejects.toThrow("Gold weekly is no longer offered.");
  });
});

describe("stopsAtPeriodEnd", () => {
  it("stops weekly Gold when the paid period ends", () => {
    expect(stopsAtPeriodEnd({ tier: "gold", period: "weekly" })).toBe(true);
  });

  it("keeps renewing Silver and Gold monthly or annual", () => {
    expect(stopsAtPeriodEnd({ tier: "silver", period: "weekly" })).toBe(false);
    expect(stopsAtPeriodEnd({ tier: "silver", period: "monthly" })).toBe(false);
    expect(stopsAtPeriodEnd({ tier: "gold", period: "monthly" })).toBe(false);
    expect(stopsAtPeriodEnd({ tier: "gold", period: "annual" })).toBe(false);
  });
});

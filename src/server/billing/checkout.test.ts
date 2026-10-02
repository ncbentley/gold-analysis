import { describe, expect, it } from "vitest";
import { startCheckout } from "./service";

describe("startCheckout", () => {
  it("refuses a new Gold subscription before any billing call", async () => {
    await expect(startCheckout({ id: "user", email: "a@example.com" }, "gold", "monthly")).rejects.toThrow("Gold is no longer offered.");
  });
});

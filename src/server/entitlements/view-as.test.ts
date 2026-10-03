import { describe, expect, it } from "vitest";
import { can } from "./access";
import { DEFAULT_TIER_CONFIG } from "./config";
import { accessForPreview, parseViewAs } from "./view-as";

describe("admin view-as", () => {
  it("keeps full admin access when no preview is set", () => {
    const access = accessForPreview(DEFAULT_TIER_CONFIG, null);
    expect(access.isAdmin).toBe(true);
    expect(can(access, "ai.patterns")).toBe(true);
    expect(access.historyDays).toBeNull();
  });

  it("uses the selected membership and nothing above it", () => {
    const silver = accessForPreview(DEFAULT_TIER_CONFIG, "silver");
    expect(silver.tier).toBe("silver");
    expect(silver.isAdmin).toBe(false);
    expect(can(silver, "signals.core")).toBe(true);
    expect(can(silver, "sources.stats.summary")).toBe(true);
    expect(can(silver, "sources.stats.recent")).toBe(false);
    expect(can(silver, "consensus.grade")).toBe(false);
    expect(can(silver, "consensus.mapping")).toBe(false);
    expect(silver.historyDays).toBe(180);

    const platinum = accessForPreview(DEFAULT_TIER_CONFIG, "platinum");
    expect(can(platinum, "filters.advanced")).toBe(true);
    expect(can(platinum, "ai.patterns")).toBe(false);
    expect(can(platinum, "consensus.mapping")).toBe(false);
    expect(platinum.historyDays).toBeNull();
  });

  it("can preview a signed-in visitor with no plan", () => {
    const access = accessForPreview(DEFAULT_TIER_CONFIG, "none");
    expect(access.tier).toBeNull();
    expect(can(access, "signals.core")).toBe(true);
    expect(can(access, "signals.basic_result")).toBe(true);
    expect(can(access, "sources.stats.summary")).toBe(false);
    expect(access.historyDays).toBe(7);
  });

  it("ignores unknown preview values", () => {
    expect(parseViewAs("admin")).toBeNull();
    expect(parseViewAs("diamond")).toBeNull();
    expect(parseViewAs("gold")).toBeNull();
    expect(parseViewAs("none")).toBe("none");
  });
});

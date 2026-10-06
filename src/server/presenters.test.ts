import { describe, expect, it } from "vitest";
import { buildAccess } from "@/server/entitlements/access";
import { DEFAULT_TIER_CONFIG } from "@/server/entitlements/config";
import { presentSignalListItem, presentSourceSummary, redactIdentities, sourceDisplayName } from "./presenters";
import type { Source } from "@/server/db/schema";

const access = buildAccess("gold", DEFAULT_TIER_CONFIG);

describe("source identity", () => {
  const source = { id: "src-1", name: "Chartsyco Trades", nickname: "Amber Fox", slug: "chartsycotrades", isQa: false };

  it("gives members the nickname and admins the channel name", () => {
    expect(sourceDisplayName(source, access)).toBe("Amber Fox");
    expect(sourceDisplayName(source, buildAccess("gold", DEFAULT_TIER_CONFIG, true))).toBe("Chartsyco Trades");
  });

  it("strips channel names from member signal rows", () => {
    const item = presentSignalListItem(
      {
        signal: {
          id: "sig",
          instrument: "XAUUSD",
          direction: "LONG",
          entryType: "MARKET",
          entryMin: 4100,
          entryMax: 4100,
          stopLoss: 4090,
          signalTime: new Date("2026-09-28T12:00:00Z"),
          closedAt: null,
          status: "PENDING",
        } as never,
        source,
        targets: [],
        outcome: null,
      },
      access,
      DEFAULT_TIER_CONFIG,
    );
    expect(item.source.name).toBe("Amber Fox");
    expect(JSON.stringify(item)).not.toContain("Chartsyco");
    expect(JSON.stringify(item)).not.toContain("chartsycotrades");
  });

  it("returns the channel name on an admin signal row", () => {
    const item = presentSignalListItem(
      {
        signal: {
          id: "sig",
          instrument: "XAUUSD",
          direction: "LONG",
          entryType: "MARKET",
          entryMin: 4100,
          entryMax: 4100,
          stopLoss: 4090,
          signalTime: new Date("2026-09-28T12:00:00Z"),
          closedAt: null,
          status: "PENDING",
        } as never,
        source,
        targets: [],
        outcome: null,
      },
      buildAccess("gold", DEFAULT_TIER_CONFIG, true),
      DEFAULT_TIER_CONFIG,
    );
    expect(item.source.name).toBe("Chartsyco Trades");
    expect(item.source.slug).toBe("chartsycotrades");
  });

  it("omits the channel name, slug and description from member source summaries", () => {
    const summary = presentSourceSummary(
      {
        ...source,
        name: "James Gold Master",
        slug: "james-gold-master",
        description: "Signals from James Gold Master",
        sourceType: "telegram",
        telegramUsername: "jamesgold",
        active: true,
      } as Source,
      null,
      access,
      DEFAULT_TIER_CONFIG,
    );
    expect(summary.name).toBe("Amber Fox");
    expect(summary.slug).toBe("src-1");
    expect(summary.description).toBeNull();
    expect(summary.telegramUsername).toBeNull();
    expect(JSON.stringify(summary)).not.toContain("James");
  });

  it("rewrites a stored channel name inside analysis text", () => {
    expect(redactIdentities("James Gold Master closed 12 trades.", ["James Gold Master", "james-gold-master"])).toBe(
      "this source closed 12 trades.",
    );
  });
});

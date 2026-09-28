import { describe, expect, it } from "vitest";
import { buildAccess } from "@/server/entitlements/access";
import { DEFAULT_TIER_CONFIG } from "@/server/entitlements/config";
import { presentSignalListItem, presentSourceSummary, redactIdentities } from "./presenters";
import type { Source } from "@/server/db/schema";

const access = buildAccess("platinum", DEFAULT_TIER_CONFIG);

describe("source anonymity", () => {
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
        source: { id: "src-1", name: "Chartsyco Trades", slug: "chartsycotrades", showRawText: true, isQa: false },
        targets: [],
        outcome: null,
      },
      access,
      DEFAULT_TIER_CONFIG,
    );
    expect(item.source.name).toBe("This source");
    expect(JSON.stringify(item)).not.toContain("Chartsyco");
    expect(JSON.stringify(item)).not.toContain("chartsycotrades");
  });

  it("omits the channel name, slug and description from source summaries", () => {
    const summary = presentSourceSummary(
      {
        id: "src-1",
        name: "James Gold Master",
        slug: "james-gold-master",
        description: "Signals from James Gold Master",
        sourceType: "telegram",
        telegramUsername: "jamesgold",
        isQa: false,
        active: true,
      } as Source,
      null,
      access,
      DEFAULT_TIER_CONFIG,
    );
    expect(summary.name).toBe("This source");
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

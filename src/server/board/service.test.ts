import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { boardPosts, consolidatedIdeas } from "@/server/db/schema";
import { refreshBoard } from "./service";

const returned = {
  primary: {
    direction: "LONG" as const,
    entryMin: 2711.5,
    entryMax: 2712,
    stopLoss: 2700,
    targets: [2720],
    writeup: "News read is unavailable. One source, sample size 0.",
    ideaIds: [] as string[],
  },
  alternates: [],
};

describe("refreshBoard", () => {
  beforeAll(async () => {
    await runMigrations();
  }, 60_000);

  afterAll(async () => {
    await closeDb();
  });

  it("skips the model on an empty market, stores the returned primary, then skips again until the market clears", async () => {
    let calls = 0;
    const generate = async (facts: Record<string, unknown>) => {
      calls += 1;
      expect(facts.news).toBeNull();
      return { ...returned, primary: { ...returned.primary, ideaIds: ((facts.ideas as { id: string }[]) ?? []).map((idea) => idea.id) } };
    };

    const empty = await refreshBoard({ generate });
    expect(empty.action).toBe("clear");
    expect(calls).toBe(0);

    const db = await getDb();
    const [idea] = await db
      .insert(consolidatedIdeas)
      .values({
        direction: "LONG",
        entryMin: 2650,
        entryMax: 2650,
        stopLoss: 2640,
        targets: [2660],
        exitSpreadStops: null,
        exitSpreadTargets: [0],
        sourceCount: 3,
        signalIds: [],
        replacedSignalIds: [],
        newestSignalAt: new Date(),
      })
      .returning();

    const first = await refreshBoard({ generate });
    expect(first.action).toBe("call");
    expect(calls).toBe(1);
    const [stored] = await db.select().from(boardPosts).where(eq(boardPosts.active, true));
    expect(stored.primary.entryMin).toBe(2711.5);
    expect(stored.primary.entryMin).not.toBe(idea.entryMin);
    expect(stored.primary.ideaIds).toEqual([idea.id]);

    const second = await refreshBoard({ generate });
    expect(second.action).toBe("keep");
    expect(calls).toBe(1);

    await db.delete(consolidatedIdeas).where(eq(consolidatedIdeas.id, idea.id));
    const cleared = await refreshBoard({ generate });
    expect(cleared.action).toBe("clear");
    expect(calls).toBe(1);
    expect(await db.select().from(boardPosts).where(eq(boardPosts.active, true))).toHaveLength(0);
    expect(await db.select().from(boardPosts)).toHaveLength(1);
  });

  it("includes an older idea on the one historical pass and leaves it out of the 14-day pass", async () => {
    const db = await getDb();
    await db.insert(consolidatedIdeas).values({
      direction: "SHORT",
      entryMin: 2400,
      entryMax: 2400,
      stopLoss: 2410,
      targets: [2380],
      exitSpreadStops: null,
      exitSpreadTargets: [0],
      sourceCount: 3,
      signalIds: [],
      replacedSignalIds: [],
      newestSignalAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });
    let calls = 0;
    const generate = async () => {
      calls += 1;
      return returned;
    };
    const recent = await refreshBoard({ generate });
    expect(recent.action).toBe("clear");
    expect(calls).toBe(0);
    const historical = await refreshBoard({ fullHistory: true, generate });
    expect(historical.action).toBe("call");
    expect(calls).toBe(1);
  });
});

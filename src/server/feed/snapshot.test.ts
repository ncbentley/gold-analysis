import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { dashboardSnapshots, feedRevisions } from "@/server/db/schema";
import { syncDashboardCache } from "./snapshot";

describe("syncDashboardCache", () => {
  beforeAll(async () => {
    await runMigrations();
  }, 60_000);

  afterAll(async () => {
    await closeDb();
  });

  it("writes each dashboard once and leaves the cache alone when nothing changed", async () => {
    expect(await syncDashboardCache()).toBe(true);
    const db = await getDb();
    expect(await db.select().from(dashboardSnapshots)).toHaveLength(4);
    const [mark] = await db.select().from(feedRevisions).where(eq(feedRevisions.id, "dashboard"));
    expect(mark.fingerprint).toBeTruthy();
    expect(await syncDashboardCache()).toBe(false);
  });
});

import { and, eq, sql } from "drizzle-orm";
import { recordAudit, type Actor } from "@/server/audit";
import { getDb } from "@/server/db";
import { affiliateClicks, affiliateLinks } from "@/server/db/schema";

/**
 * Affiliate links are informational only. Membership access never depends on
 * broker signup, deposit size or trading volume, so nothing here touches entitlements.
 */
export const PLACEMENTS = ["landing", "pricing", "dashboard", "signal_detail"] as const;
export type Placement = (typeof PLACEMENTS)[number];

export async function linksForPlacement(placement: Placement) {
  const db = await getDb();
  return db
    .select()
    .from(affiliateLinks)
    .where(and(eq(affiliateLinks.active, true), sql`${affiliateLinks.placements} @> ${JSON.stringify([placement])}::jsonb`));
}

export async function listAffiliateLinks() {
  const db = await getDb();
  return db.select().from(affiliateLinks).orderBy(affiliateLinks.name);
}

export async function recordAffiliateClick(slug: string, userId: string | null) {
  const db = await getDb();
  const [link] = await db.select().from(affiliateLinks).where(and(eq(affiliateLinks.slug, slug), eq(affiliateLinks.active, true)));
  if (!link) return null;
  await db.update(affiliateLinks).set({ clickCount: sql`${affiliateLinks.clickCount} + 1` }).where(eq(affiliateLinks.id, link.id));
  await db.insert(affiliateClicks).values({ linkId: link.id, userId });
  return link;
}

export interface AffiliateInput {
  name: string;
  slug: string;
  destinationUrl: string;
  disclosure: string;
  placements: Placement[];
  active: boolean;
}

export async function upsertAffiliateLink(id: string | null, input: AffiliateInput, actor: Actor) {
  const db = await getDb();
  const url = new URL(input.destinationUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Destination must be http(s)");
  if (id) {
    const [before] = await db.select().from(affiliateLinks).where(eq(affiliateLinks.id, id));
    await db.update(affiliateLinks).set(input).where(eq(affiliateLinks.id, id));
    await recordAudit({ actor, entityType: "affiliate_link", entityId: id, action: "affiliate.updated", before, after: input });
    return id;
  }
  const [row] = await db.insert(affiliateLinks).values(input).returning({ id: affiliateLinks.id });
  await recordAudit({ actor, entityType: "affiliate_link", entityId: row.id, action: "affiliate.created", after: input });
  return row.id;
}

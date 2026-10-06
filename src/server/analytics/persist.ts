import { and, eq, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { getCurrentUser } from "@/server/auth";
import { getDb } from "@/server/db";
import { attributionTouches, userAttributions, users, type StoredTouch } from "@/server/db/schema";
import { sha256 } from "@/server/lib/hash";
import { ATTR_COOKIE, TOUCH_HEADER, decodeAttribution, paramsKey, sessionBucket, type AttributionState, type Touch } from "./attribution";
import { aliasVisitor, personProperties, setPerson } from "./posthog";

/** Writes the touch the proxy just captured. Failures never block the page. */
export async function persistIncomingTouch() {
  try {
    const raw = (await headers()).get(TOUCH_HEADER);
    const state = decodeAttribution(raw);
    if (!state) return;
    const user = await getCurrentUser();
    await insertTouch(state.visitorId, state.first, user?.id ?? null);
    await insertTouch(state.visitorId, state.last, user?.id ?? null);
    if (user) await identifyAttribution(user.id, state);
  } catch (err) {
    console.warn("[analytics] touch dropped", (err as Error).message);
  }
}

/**
 * Copies the browser's first and last touch onto the account.
 * First touch already stored for that account is left as-is.
 */
export async function identifyAttribution(userId: string, known?: AttributionState | null) {
  try {
    const state = known === undefined ? await attributionFromCookies() : known;
    if (!state) return;
    await insertTouch(state.visitorId, state.first, userId);
    await insertTouch(state.visitorId, state.last, userId);
    const db = await getDb();
    const [existing] = await db.select().from(userAttributions).where(eq(userAttributions.userId, userId));
    if (!existing) {
      await db.insert(userAttributions).values({
        userId,
        visitorId: state.visitorId,
        firstTouch: state.first,
        lastTouch: state.last,
      });
    } else if (shouldMoveLastTouch(existing.lastTouch, state.last)) {
      await db.update(userAttributions).set({ lastTouch: state.last, updatedAt: new Date() }).where(eq(userAttributions.userId, userId));
    }
    await db
      .update(attributionTouches)
      .set({ userId })
      .where(and(eq(attributionTouches.visitorId, state.visitorId), isNull(attributionTouches.userId)));
    await forwardIdentity(userId);
  } catch (err) {
    console.warn("[analytics] identify dropped", (err as Error).message);
  }
}

async function forwardIdentity(userId: string) {
  try {
    const db = await getDb();
    const [row] = await db.select().from(userAttributions).where(eq(userAttributions.userId, userId));
    const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
    if (!row || !user) return;
    const stored: AttributionState = { visitorId: row.visitorId, first: row.firstTouch, last: row.lastTouch };
    aliasVisitor(userId, stored.visitorId);
    const person = personProperties(stored, user.email);
    setPerson(userId, person.setOnce, person.set);
  } catch (err) {
    console.warn("[analytics] identify dropped", (err as Error).message);
  }
}

/** Cookie attribution for this request, or the account's stored touches when there is no browser. */
export async function attributionSnapshot(userId: string | null): Promise<AttributionState | null> {
  const fromCookie = await attributionFromCookies();
  if (fromCookie) return fromCookie;
  if (!userId) return null;
  try {
    const db = await getDb();
    const [row] = await db.select().from(userAttributions).where(eq(userAttributions.userId, userId));
    if (!row) return null;
    return { visitorId: row.visitorId, first: row.firstTouch, last: row.lastTouch };
  } catch {
    return null;
  }
}

async function attributionFromCookies() {
  try {
    const jar = await cookies();
    return decodeAttribution(jar.get(ATTR_COOKIE)?.value);
  } catch {
    return null;
  }
}

async function insertTouch(visitorId: string, touch: Touch, userId: string | null) {
  const touchedAt = new Date(touch.at);
  if (Number.isNaN(touchedAt.getTime())) return;
  const db = await getDb();
  await db
    .insert(attributionTouches)
    .values({
      touchKey: sha256(`${visitorId}\n${touch.landing}\n${paramsKey(touch.params)}\n${sessionBucket(touch.at)}`),
      visitorId,
      userId,
      landing: touch.landing,
      referrer: touch.referrer,
      params: touch.params,
      touchedAt,
    })
    .onConflictDoNothing();
}

function shouldMoveLastTouch(stored: StoredTouch, incoming: Touch) {
  if (incoming.at <= stored.at) return false;
  return Object.keys(incoming.params).length > 0 || Object.keys(stored.params).length === 0;
}

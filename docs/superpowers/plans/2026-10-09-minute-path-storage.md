# Minute Path Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep live XAU/USD print order for 30 days as one row per minute, and make multi-idea page replays read and index that window once.

**Architecture:** Pure functions collapse and merge a minute's prints. Postgres stores the sealed path and a short tick buffer. The price socket seals a minute when the next one starts, and merges a late print into the sealed row. `getEngineTicks` reads paths plus any minute that is not sealed yet. A page that replays many ideas builds the print index once and passes it into each replay.

**Tech Stack:** TypeScript, Drizzle, Postgres (PGlite in tests), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-minute-path-storage-design.md`

---

## File map

- Create `src/server/market-data/minute-path.ts` — minute math, collapse, merge, expand. No database.
- Create `src/server/market-data/minute-path.test.ts` — those functions.
- Create `src/server/market-data/paths.ts` — seal, merge, compact, retention, and the tick read. Database only.
- Create `src/server/market-data/paths.test.ts` — those writes and reads on PGlite.
- Modify `src/server/db/schema.ts` — `marketMinutePaths`.
- Create `drizzle/0019_market_minute_paths.sql` and register it in `drizzle/meta/_journal.json`.
- Modify `src/server/market-data/index.ts` — `getEngineTicks` reads paths; sync sweeps; reset deletes paths and ticks.
- Modify `src/server/market-data/twelvedata-stream.ts` — seal and late-print merge.
- Modify `src/server/outcomes/engine.ts` — export `indexTicks`; accept a prepared index.
- Modify `src/server/ideas/replay.ts` and `src/server/ideas/replay.test.ts` — pass that index through.
- Modify the multi-idea callers: `src/server/ideas/service.ts`, `src/server/gold/sections.ts`, `src/server/gold/from-board.ts`, `src/server/board/service.ts`.
- Modify `DECISIONS.md` — record the 30-day path.

---

### Task 1: Collapse and merge a minute

**Files:**
- Create: `src/server/market-data/minute-path.ts`
- Test: `src/server/market-data/minute-path.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { collapsePrints, expandPath, mergePrint, minuteStart, PATH_RETENTION_MS, routePrint } from "./minute-path";

const MINUTE = 60_000;

describe("minute paths", () => {
  it("keeps vendor order and drops a consecutive duplicate", () => {
    const path = collapsePrints(0, [
      { t: 30, price: 100 },
      { t: 10, price: 100 },
      { t: 20, price: 101 },
    ]);
    expect(path).toEqual({ minute: 0, offsets: [10, 20], prices: [100, 101] });
    expect(expandPath(path)).toEqual([
      { t: 10, price: 100 },
      { t: 20, price: 101 },
    ]);
  });

  it("merges a late print by vendor time", () => {
    const sealed = collapsePrints(MINUTE, [
      { t: MINUTE + 10, price: 100 },
      { t: MINUTE + 40, price: 102 },
    ]);
    expect(mergePrint(sealed, { t: MINUTE + 20, price: 101 })).toEqual({
      minute: MINUTE,
      offsets: [10, 20, 40],
      prices: [100, 101, 102],
    });
  });

  it("keeps the earlier print when the late price matches its neighbor", () => {
    const sealed = collapsePrints(0, [
      { t: 10, price: 100 },
      { t: 40, price: 102 },
    ]);
    expect(mergePrint(sealed, { t: 20, price: 100 }).prices).toEqual([100, 102]);
  });

  it("routes a print to the buffer, a seal, or a merge", () => {
    expect(routePrint(null, 5_000)).toBe("buffer");
    expect(routePrint(0, 5_000)).toBe("buffer");
    expect(routePrint(0, MINUTE + 1)).toBe("seal");
    expect(routePrint(MINUTE, 5_000)).toBe("merge");
  });

  it("retains a path for 30 days from the minute open", () => {
    expect(PATH_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(minuteStart(MINUTE + 5)).toBe(MINUTE);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/server/market-data/minute-path.test.ts`

Expected: FAIL. Cannot find module `./minute-path`.

- [ ] **Step 3: Write the functions**

```ts
const MINUTE = 60_000;

export const PATH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function minuteStart(t: number) {
  return Math.floor(t / MINUTE) * MINUTE;
}

export interface StoredPath {
  minute: number;
  offsets: number[];
  prices: number[];
}

/** Vendor time, then the order the prints were given. Consecutive equal prices keep the earliest. */
export function collapsePrints(minute: number, prints: { t: number; price: number }[]): StoredPath {
  const ordered = [...prints].sort((a, b) => a.t - b.t);
  const offsets: number[] = [];
  const prices: number[] = [];
  for (const print of ordered) {
    if (prices.length && prices[prices.length - 1] === print.price) continue;
    offsets.push(print.t - minute);
    prices.push(print.price);
  }
  return { minute, offsets, prices };
}

/** Insert by vendor time. An equal vendor time stays behind prints already stored. */
export function mergePrint(path: StoredPath, print: { t: number; price: number }): StoredPath {
  const offset = print.t - path.minute;
  const offsets = [...path.offsets];
  const prices = [...path.prices];
  let at = 0;
  while (at < offsets.length && offsets[at] <= offset) at += 1;
  offsets.splice(at, 0, offset);
  prices.splice(at, 0, print.price);
  return collapsePrints(
    path.minute,
    offsets.map((off, index) => ({ t: path.minute + off, price: prices[index] })),
  );
}

export function expandPath(path: StoredPath): { t: number; price: number }[] {
  return path.prices.map((price, index) => ({ t: path.minute + path.offsets[index], price }));
}

export function routePrint(openMinute: number | null, printTime: number): "buffer" | "seal" | "merge" {
  const minute = minuteStart(printTime);
  if (openMinute !== null && minute < openMinute) return "merge";
  if (openMinute !== null && minute > openMinute) return "seal";
  return "buffer";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/server/market-data/minute-path.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/market-data/minute-path.ts src/server/market-data/minute-path.test.ts
git commit -m "$(cat <<'EOF'
Add minute-path collapse and late-print merge.

EOF
)"
```

---

### Task 2: Store one path per minute

**Files:**
- Modify: `src/server/db/schema.ts` (after the `marketTicks` table)
- Create: `drizzle/0019_market_minute_paths.sql`
- Modify: `drizzle/meta/_journal.json` (append one entry)

- [ ] **Step 1: Add the table**

In `src/server/db/schema.ts`, immediately after the `marketTicks` table:

```ts
/** Ordered prints for one sealed minute. Offsets are milliseconds from `minute`. */
export const marketMinutePaths = pgTable(
  "market_minute_paths",
  {
    instrument: text("instrument").notNull(),
    minute: ts("minute").notNull(),
    offsets: integer("offsets").array().notNull(),
    prices: doublePrecision("prices").array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.instrument, t.minute] })],
);
```

`integer`, `doublePrecision`, `primaryKey`, `text`, and `ts` are already imported in this file.

- [ ] **Step 2: Add the migration**

`drizzle/0019_market_minute_paths.sql`:

```sql
CREATE TABLE "market_minute_paths" (
	"instrument" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"offsets" integer[] NOT NULL,
	"prices" double precision[] NOT NULL,
	CONSTRAINT "market_minute_paths_instrument_minute_pk" PRIMARY KEY("instrument","minute")
);
```

Append this object as the last entry of `entries` in `drizzle/meta/_journal.json`:

```json
{
  "idx": 19,
  "version": "7",
  "when": 1792281600000,
  "tag": "0019_market_minute_paths",
  "breakpoints": true
}
```

- [ ] **Step 3: Verify the migration applies**

Run: `pnpm exec vitest run src/server/pipeline.integration.test.ts`

Expected: PASS. `runMigrations` loads every journal entry, including `0019`.

- [ ] **Step 4: Commit**

```bash
git add src/server/db/schema.ts drizzle/0019_market_minute_paths.sql drizzle/meta/_journal.json
git commit -m "$(cat <<'EOF'
Store a sealed minute as one ordered path.

EOF
)"
```

---

### Task 3: Seal, read, and keep the buffer small

**Files:**
- Create: `src/server/market-data/paths.ts`
- Test: `src/server/market-data/paths.test.ts`
- Modify: `src/server/market-data/index.ts` (`getEngineTicks`)

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { marketMinutePaths, marketTicks } from "@/server/db/schema";
import { getEngineTicks } from "./index";
import { PATH_RETENTION_MS } from "./minute-path";
import { compactClosedMinutes, deleteExpiredPaths, deleteSealedBuffer, mergeSealedPrint, sealMinute } from "./paths";

const INSTRUMENT = "XAUUSD";
const MINUTE = 60_000;

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await closeDb();
});

describe("minute path storage", () => {
  it("seals buffer prints in order and removes them", async () => {
    const db = await getDb();
    const minute = new Date(0);
    await db.insert(marketTicks).values([
      { instrument: INSTRUMENT, at: new Date(30), seq: 0, price: 100, receivedAt: new Date(2) },
      { instrument: INSTRUMENT, at: new Date(10), seq: 1, price: 100, receivedAt: new Date(1) },
      { instrument: INSTRUMENT, at: new Date(20), seq: 2, price: 101, receivedAt: new Date(1) },
    ]);
    await sealMinute(INSTRUMENT, minute);
    const ticks = await getEngineTicks(minute, new Date(MINUTE));
    expect(ticks).toEqual([
      { t: 10, price: 100 },
      { t: 20, price: 101 },
    ]);
    const left = await db.select().from(marketTicks);
    expect(left).toEqual([]);
  });

  it("reads a sealed minute and an unsealed minute together", async () => {
    const db = await getDb();
    await db.insert(marketTicks).values({ instrument: INSTRUMENT, at: new Date(MINUTE + 5), seq: 0, price: 110, receivedAt: new Date(0) });
    const ticks = await getEngineTicks(new Date(0), new Date(2 * MINUTE));
    expect(ticks).toEqual([
      { t: 10, price: 100 },
      { t: 20, price: 101 },
      { t: MINUTE + 5, price: 110 },
    ]);
  });

  it("merges a print into a sealed minute", async () => {
    await mergeSealedPrint(INSTRUMENT, 15, 100.5);
    const ticks = await getEngineTicks(new Date(0), new Date(MINUTE));
    expect(ticks.map((tick) => tick.price)).toEqual([100, 100.5, 101]);
  });

  it("compacts a closed minute and leaves the open minute buffered", async () => {
    const db = await getDb();
    await db.insert(marketTicks).values({ instrument: INSTRUMENT, at: new Date(2 * MINUTE + 5), seq: 0, price: 120, receivedAt: new Date(0) });
    await compactClosedMinutes(INSTRUMENT, 2 * MINUTE);
    const ticks = await getEngineTicks(new Date(MINUTE), new Date(3 * MINUTE));
    expect(ticks).toEqual([
      { t: MINUTE + 5, price: 110 },
      { t: 2 * MINUTE + 5, price: 120 },
    ]);
    const buffered = await db.select().from(marketTicks);
    expect(buffered).toHaveLength(1);
  });

  it("drops paths older than 30 days and leaves a buffer row that has no path", async () => {
    const db = await getDb();
    const old = new Date(Date.now() - PATH_RETENTION_MS - MINUTE);
    await db.insert(marketMinutePaths).values({ instrument: INSTRUMENT, minute: old, offsets: [0], prices: [1] });
    await db.insert(marketTicks).values({ instrument: INSTRUMENT, at: new Date(3 * MINUTE), seq: 0, price: 130, receivedAt: new Date(0) });
    await deleteExpiredPaths(Date.now());
    await deleteSealedBuffer(INSTRUMENT);
    const paths = await db.select().from(marketMinutePaths);
    expect(paths.some((row) => row.minute.getTime() === old.getTime())).toBe(false);
    const buffered = await db.select().from(marketTicks);
    expect(buffered.map((row) => row.price).sort()).toEqual([120, 130]);
  });
});
```

The tests share one PGlite and run in order. Do not add `.concurrent` or reorder them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/server/market-data/paths.test.ts`

Expected: FAIL. Cannot find module `./paths`.

- [ ] **Step 3: Write the database functions**

`src/server/market-data/paths.ts`:

```ts
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { getDb } from "@/server/db";
import { marketMinutePaths, marketTicks } from "@/server/db/schema";
import type { EngineTick } from "@/server/outcomes/engine";
import { collapsePrints, expandPath, mergePrint, minuteStart, PATH_RETENTION_MS } from "./minute-path";

const MINUTE = 60_000;

export async function sealMinute(instrument: string, minute: Date, extra: { t: number; price: number; seq: number }[] = []) {
  const db = await getDb();
  const end = new Date(minute.getTime() + MINUTE);
  await db.transaction(async (tx) => {
    if (extra.length) {
      const receivedAt = new Date();
      await tx.insert(marketTicks).values(
        extra.map((row) => ({ instrument, at: new Date(row.t), seq: row.seq, price: row.price, receivedAt })),
      );
    }
    const rows = await tx
      .select({ at: marketTicks.at, price: marketTicks.price })
      .from(marketTicks)
      .where(and(eq(marketTicks.instrument, instrument), gte(marketTicks.at, minute), lt(marketTicks.at, end)))
      .orderBy(asc(marketTicks.at), asc(marketTicks.receivedAt), asc(marketTicks.seq));
    const path = collapsePrints(
      minute.getTime(),
      rows.map((row) => ({ t: row.at.getTime(), price: row.price })),
    );
    if (path.prices.length) {
      await tx
        .insert(marketMinutePaths)
        .values({ instrument, minute, offsets: path.offsets, prices: path.prices })
        .onConflictDoUpdate({
          target: [marketMinutePaths.instrument, marketMinutePaths.minute],
          set: { offsets: path.offsets, prices: path.prices },
        });
    }
    await tx.delete(marketTicks).where(and(eq(marketTicks.instrument, instrument), gte(marketTicks.at, minute), lt(marketTicks.at, end)));
  });
}

/** Returns false when that minute has no path yet. The caller keeps the print in the buffer. */
export async function mergeSealedPrint(instrument: string, t: number, price: number) {
  const db = await getDb();
  const minute = new Date(minuteStart(t));
  const [row] = await db
    .select({ offsets: marketMinutePaths.offsets, prices: marketMinutePaths.prices })
    .from(marketMinutePaths)
    .where(and(eq(marketMinutePaths.instrument, instrument), eq(marketMinutePaths.minute, minute)));
  if (!row) return false;
  const merged = mergePrint({ minute: minute.getTime(), offsets: row.offsets, prices: row.prices }, { t, price });
  await db
    .update(marketMinutePaths)
    .set({ offsets: merged.offsets, prices: merged.prices })
    .where(and(eq(marketMinutePaths.instrument, instrument), eq(marketMinutePaths.minute, minute)));
  return true;
}

export async function compactClosedMinutes(instrument: string, openMinute: number) {
  const db = await getDb();
  const rows = await db
    .select({ at: marketTicks.at })
    .from(marketTicks)
    .where(and(eq(marketTicks.instrument, instrument), lt(marketTicks.at, new Date(openMinute))));
  const minutes = [...new Set(rows.map((row) => minuteStart(row.at.getTime())))].sort((a, b) => a - b);
  for (const minute of minutes) await sealMinute(instrument, new Date(minute));
}

export async function deleteExpiredPaths(now: number) {
  const db = await getDb();
  await db.delete(marketMinutePaths).where(lt(marketMinutePaths.minute, new Date(now - PATH_RETENTION_MS)));
}

export async function deleteSealedBuffer(instrument: string) {
  const db = await getDb();
  const sealed = await db.select({ minute: marketMinutePaths.minute }).from(marketMinutePaths).where(eq(marketMinutePaths.instrument, instrument));
  for (const row of sealed) {
    const end = new Date(row.minute.getTime() + MINUTE);
    await db.delete(marketTicks).where(and(eq(marketTicks.instrument, instrument), gte(marketTicks.at, row.minute), lt(marketTicks.at, end)));
  }
}

export async function maintainMinutePaths(instrument: string, now = Date.now()) {
  await compactClosedMinutes(instrument, minuteStart(now));
  await deleteExpiredPaths(now);
  await deleteSealedBuffer(instrument);
}

export async function readStoredTicks(instrument: string, from: Date, end: Date): Promise<EngineTick[]> {
  const db = await getDb();
  const paths = await db
    .select({ minute: marketMinutePaths.minute, offsets: marketMinutePaths.offsets, prices: marketMinutePaths.prices })
    .from(marketMinutePaths)
    .where(and(eq(marketMinutePaths.instrument, instrument), gte(marketMinutePaths.minute, from), lt(marketMinutePaths.minute, end)))
    .orderBy(asc(marketMinutePaths.minute));
  const buffered = await db
    .select({ at: marketTicks.at, price: marketTicks.price })
    .from(marketTicks)
    .where(and(eq(marketTicks.instrument, instrument), gte(marketTicks.at, from), lt(marketTicks.at, end)))
    .orderBy(asc(marketTicks.at), asc(marketTicks.receivedAt), asc(marketTicks.seq));
  const covered = new Set(paths.map((row) => row.minute.getTime()));
  const groups = new Map<number, EngineTick[]>();
  for (const row of paths) {
    groups.set(row.minute.getTime(), expandPath({ minute: row.minute.getTime(), offsets: row.offsets, prices: row.prices }));
  }
  for (const row of buffered) {
    const minute = minuteStart(row.at.getTime());
    if (covered.has(minute)) continue;
    const list = groups.get(minute) ?? [];
    list.push({ t: row.at.getTime(), price: row.price });
    groups.set(minute, list);
  }
  return [...groups.keys()].sort((a, b) => a - b).flatMap((minute) => groups.get(minute) ?? []);
}
```

Replace `getEngineTicks` in `src/server/market-data/index.ts`. Add `readStoredTicks` to the static imports from `./paths`. `paths.ts` must not import `index.ts`.

```ts
export async function getEngineTicks(from: Date, to: Date, instrument = INSTRUMENT): Promise<EngineTick[]> {
  const end = new Date(Math.min(to.getTime(), Date.now() + MINUTE));
  if (from.getTime() >= end.getTime()) return [];
  return readStoredTicks(instrument, from, end);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run src/server/market-data/paths.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/market-data/paths.ts src/server/market-data/paths.test.ts src/server/market-data/index.ts
git commit -m "$(cat <<'EOF'
Seal minute prints into one row and read that row back.

EOF
)"
```

---

### Task 4: Seal from the live socket

**Files:**
- Modify: `src/server/market-data/twelvedata-stream.ts`

- [ ] **Step 1: Write the failing test**

Add this case to `src/server/market-data/minute-path.test.ts`. `routePrint` already covers the decision. This case covers the split the socket needs when a seal and a new print arrive in the same buffer:

```ts
import { splitSeal } from "./minute-path";

it("splits the buffer at the sealed minute", () => {
  const pending = [
    { t: 10, price: 100, seq: 0 },
    { t: 70_000, price: 110, seq: 1 },
  ];
  expect(splitSeal(pending, 0)).toEqual({
    sealed: [{ t: 10, price: 100, seq: 0 }],
    open: [{ t: 70_000, price: 110, seq: 1 }],
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/server/market-data/minute-path.test.ts`

Expected: FAIL. `splitSeal` is not exported.

- [ ] **Step 3: Split the buffer and use it in the socket**

Add to `minute-path.ts`:

```ts
export function splitSeal<T extends { t: number }>(pending: T[], sealedMinute: number): { sealed: T[]; open: T[] } {
  const end = sealedMinute + 60_000;
  return {
    sealed: pending.filter((row) => row.t >= sealedMinute && row.t < end),
    open: pending.filter((row) => row.t >= end),
  };
}
```

In `twelvedata-stream.ts`, import `mergeSealedPrint`, `sealMinute`, and `maintainMinutePaths` from `./paths`, and `minuteStart`, `routePrint` from `./minute-path`. Import `INSTRUMENT` is already available from `./index`.

At the start of `run`, before `connect()`:

```ts
await maintainMinutePaths(INSTRUMENT);
```

Replace the body of the `message` listener, after a print is parsed, with:

```ts
const action = routePrint(openBar?.t ?? null, print.t);
if (action === "merge") {
  const merged = await mergeSealedPrint(INSTRUMENT, print.t, print.price);
  if (merged) return;
}
if (action === "seal" && openBar) {
  const split = splitSeal(pending, openBar.t);
  pending = split.open;
  await sealMinute(INSTRUMENT, new Date(openBar.t), split.sealed);
}
pending.push({ t: print.t, price: print.price, seq: seq++ });
const next = applyPrint(openBar, print);
openBar = next.open;
if (next.sealed) {
  void saveBar(next.sealed).catch((err) => console.error("[market] sealed bar write failed:", (err as Error).message));
  void flushOpen();
}
```

`sealMinute` inserts the not-yet-flushed prints for that minute in the same transaction as the path write, then deletes the minute's buffer rows. Prints already flushed by the one-second timer are included when the transaction reads the buffer. The new minute's print stays in `pending`.

A merge that finds no path falls through into the buffer. That covers a print older than the open minute during the first compact.

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run src/server/market-data/minute-path.test.ts src/server/market-data/minute-bar.test.ts`

Expected: PASS. `minute-bar.test.ts` imports `readPricePrint` from the stream module, so it catches a broken import.

- [ ] **Step 5: Commit**

```bash
git add src/server/market-data/minute-path.ts src/server/market-data/minute-path.test.ts src/server/market-data/twelvedata-stream.ts
git commit -m "$(cat <<'EOF'
Seal each live minute and merge a late print into its path.

EOF
)"
```

---

### Task 5: Sweep on the market schedule and reset with the provider

**Files:**
- Modify: `src/server/market-data/index.ts` (`syncMarketData`, `resetMarketData`)
- Test: `src/server/market-data/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `paths.test.ts`:

```ts
import { marketBars, marketDataSync } from "@/server/db/schema";
import { resetMarketData } from "./index";

it("clears paths and buffer prints when the bar series is reset", async () => {
  const db = await getDb();
  await db.insert(marketBars).values({
    instrument: INSTRUMENT,
    resolution: "1m",
    timestamp: new Date(0),
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: null,
    provider: "mock",
  });
  await db.insert(marketDataSync).values({ instrument: INSTRUMENT, provider: "mock", syncedThrough: new Date(0) });
  await resetMarketData(INSTRUMENT);
  expect(await db.select().from(marketMinutePaths)).toEqual([]);
  expect(await db.select().from(marketTicks)).toEqual([]);
  expect(await db.select().from(marketBars)).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/server/market-data/paths.test.ts`

Expected: FAIL. Paths or ticks remain after `resetMarketData`.

- [ ] **Step 3: Sweep and reset**

`maintainMinutePaths` is already imported from `./paths` in Task 3. Call it at the start of `syncMarketData`, before the provider is loaded and before the recent-sync return:

```ts
const instrument = opts.instrument ?? INSTRUMENT;
await maintainMinutePaths(instrument);
```

In `resetMarketData`, after the existing deletes:

```ts
await db.delete(marketMinutePaths).where(eq(marketMinutePaths.instrument, instrument));
await db.delete(marketTicks).where(eq(marketTicks.instrument, instrument));
```

Import `marketMinutePaths` and `marketTicks` in `index.ts`. `marketTicks` is already imported. Add `marketMinutePaths`.

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run src/server/market-data/paths.test.ts src/server/market-data/sync-window.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/market-data/index.ts src/server/market-data/paths.test.ts
git commit -m "$(cat <<'EOF'
Sweep sealed paths on the market schedule and clear them on provider reset.

EOF
)"
```

---

### Task 6: Index the window once per page

**Files:**
- Modify: `src/server/outcomes/engine.ts` (`indexTicks`, `createReplay`, `evaluateSignal`)
- Modify: `src/server/ideas/replay.ts`
- Modify: `src/server/ideas/replay.test.ts`
- Modify: `src/server/ideas/service.ts` (`replayConsolidatedIdeas`)
- Modify: `src/server/gold/sections.ts` (`goldBookCards`)
- Modify: `src/server/gold/from-board.ts` (`reconcileGoldBook`, `closeSections`)
- Modify: `src/server/board/service.ts` (`loadMarket`, `anyPickLive`, `labelPicks`)

- [ ] **Step 1: Write the failing test**

Add to `src/server/ideas/replay.test.ts`:

```ts
import { indexTicks } from "@/server/outcomes/engine";

it("reuses a prepared print index for every idea", () => {
  const start = Date.parse("2026-03-02T15:00:00Z");
  const bars = [{ t: start, o: 2650, h: 2660, l: 2640, c: 2655 }];
  const idea = {
    direction: "LONG" as const,
    entryMin: 2648,
    entryMax: 2652,
    stopLoss: 2640,
    targets: [2660],
    startedAt: start,
  };
  const paths = indexTicks([{ t: start, price: 2650 }, { t: start + 1_000, price: 2640 }], 60_000);
  const first = replayIdea(idea, bars, null, true, [], start, paths);
  const second = replayIdea(idea, bars, null, true, [{ t: start, price: 9999 }], start, paths);
  expect(second).toEqual(first);
  expect(first.outcome.entered).toBe(true);
});
```

The second call passes a different tick list. A replay that indexes `ticks` again would fill at 9999. Reusing `paths` keeps the first result.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run src/server/ideas/replay.test.ts`

Expected: FAIL. `replayIdea` does not accept a prepared index, or the two results differ.

- [ ] **Step 3: Thread the index through replay**

In `engine.ts`, change `function indexTicks` to `export function indexTicks`.

Change `createReplay` to accept the prepared map:

```ts
function createReplay(
  signal: EngineSignal,
  adjustments: EngineAdjustment[],
  rules: OutcomeRules,
  ticks: EngineTick[] = [],
  tickPaths?: Map<number, number[]>,
): ReplayState {
  return {
    signal,
    adj: [...adjustments].sort((a, b) => a.effectiveAt - b.effectiveAt),
    dir: signal.direction === "LONG" ? 1 : -1,
    expiry: signal.expiryTime ?? signal.signalTime + rules.defaultExpiryMinutes * 60_000,
    weight: 1 / Math.max(signal.targets.length, 1),
    tickPaths: tickPaths ?? indexTicks(ticks, rules.barMs),
    cp: blankCheckpoint(signal),
  };
}
```

Pass `tickPaths` from `restoreReplay` and from both `evaluateSignal` and `advanceFromCheckpoint`. Add it as the last argument of each public function:

```ts
export function evaluateSignal(
  signal: EngineSignal,
  bars: EngineBar[],
  adjustments: EngineAdjustment[] = [],
  dataThrough: number | null = null,
  rules: OutcomeRules = OUTCOME_RULES,
  presorted = false,
  ticks: EngineTick[] = [],
  tickPaths?: Map<number, number[]>,
): EngineOutcome {
```

`createReplay(signal, adjustments, rules, ticks, tickPaths)` inside `evaluateSignal`. The same last argument on `advanceFromCheckpoint`, passed into `restoreReplay`, then into `createReplay`.

In `replay.ts`:

```ts
export function replayIdea(
  idea: IdeaLevels,
  bars: EngineBar[],
  spot: number | null,
  presorted = false,
  ticks: EngineTick[] = [],
  now = Date.now(),
  tickPaths?: Map<number, number[]>,
): { phase: IdeaPhase; outcome: EngineOutcome } {
```

Pass `tickPaths` as the last argument to `evaluateSignal`.

In each multi-idea function, build the index once after the ticks are loaded:

```ts
import { indexTicks, OUTCOME_RULES } from "@/server/outcomes/engine";

const paths = indexTicks(ticks, OUTCOME_RULES.barMs);
```

Pass `paths` as the last argument of every `replayIdea` in that function. Do this in:

- `replayConsolidatedIdeas` in `src/server/ideas/service.ts`
- `goldBookCards` in `src/server/gold/sections.ts`
- `reconcileGoldBook` and `closeSections` in `src/server/gold/from-board.ts`
- `loadMarket` and `labelPicks` in `src/server/board/service.ts`

`anyPickLive` calls `pickPhase` once per pick, and each call loads the window. Replace that loop with one load:

```ts
async function anyPickLive(picks: BoardPick[], startedAt: number, spot: number | null) {
  const from = new Date(startedAt);
  const to = new Date(Date.now() + 60_000);
  const [bars, ticks] = await Promise.all([getEngineBars(from, to), getEngineTicks(from, to)]);
  const paths = indexTicks(ticks, OUTCOME_RULES.barMs);
  return picks.some((pick) => replayIdea({ ...pick, startedAt }, bars, spot, true, [], Date.now(), paths).phase !== "history");
}
```

Leave `pickPhase` in place if `boardPick` still uses a single replay. A single idea does not need a shared index.

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run src/server/ideas/replay.test.ts src/server/outcomes/engine.test.ts src/server/board/service.test.ts src/server/gold/qualify.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/outcomes/engine.ts src/server/ideas/replay.ts src/server/ideas/replay.test.ts src/server/ideas/service.ts src/server/gold/sections.ts src/server/gold/from-board.ts src/server/board/service.ts
git commit -m "$(cat <<'EOF'
Index one loaded print window for every idea on the page.

EOF
)"
```

---

### Task 7: Record the retention rule

**Files:**
- Modify: `DECISIONS.md` (after the "Outcome rules" section's last bullet, add a new section)

- [ ] **Step 1: Add the decision**

```md
## Market tape

- **A sealed minute is one path, kept for 30 days.** Live prints sit in `market_ticks` until the minute closes, then move to `market_minute_paths` as ordered prices. Consecutive equal prices are stored once. A print that arrives after the seal is merged by vendor time. The market sync deletes paths older than 30 days. A replay of a missing path uses the candle path. Minute bars stay, and a provider reset deletes paths and buffer prints with the bars.
```

- [ ] **Step 2: Commit**

```bash
git add DECISIONS.md
git commit -m "$(cat <<'EOF'
Record 30-day minute path retention.

EOF
)"
```

---

## Spec coverage

- Seal to one ordered row, drop consecutive duplicates: Task 1, Task 3.
- Buffer only until seal, one-second flush stays in the socket: Task 4.
- Late print merges by vendor time: Task 1, Task 3, Task 4.
- First compact of closed buffer minutes: Task 3 `compactClosedMinutes`, called from the socket start and from `maintainMinutePaths`.
- 30-day delete, and buffer rows without a path are kept: Task 3, Task 5.
- Read mixes paths and buffer; missing path uses the candle path already in `pathForBar`: Task 3.
- Provider reset clears paths and ticks: Task 5.
- One load and one index per multi-idea replay: Task 6.
- Stored outcomes are not rewritten by this work. No outcome job changes.

## Self-review notes

- `paths.ts` imports the database and schema. It does not import `index.ts`.
- `getEngineTicks` remains the replay read. Callers keep their window math.
- `deleteSealedBuffer` must not delete a tick whose minute has no path. The test inserts that row at `3 * MINUTE` and expects it to remain.

import path from "node:path";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

export type Db = PgliteDatabase<typeof schema>;

type DbHandle = { db: Db; close: () => Promise<void>; driver: "pglite" | "postgres" };

const globalForDb = globalThis as unknown as { __gsiDb?: Promise<DbHandle> };

export function pgliteDataDir() {
  return process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
}

async function connect(): Promise<DbHandle> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: url });
    // Query API is identical across pg-core drivers; the cast keeps one Db type app-wide.
    const db = drizzle(pool, { schema }) as unknown as Db;
    return { db, close: () => pool.end(), driver: "postgres" };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = process.env.PGLITE_DATA_DIR === "memory://" ? "memory://" : pgliteDataDir();
  if (dataDir !== "memory://") {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(path.dirname(dataDir), { recursive: true });
  }
  const client = new PGlite(dataDir);
  await client.waitReady;
  const db = drizzlePglite(client, { schema });
  return { db, close: () => client.close(), driver: "pglite" };
}

export async function getDbHandle(): Promise<DbHandle> {
  if (!globalForDb.__gsiDb) globalForDb.__gsiDb = connect();
  return globalForDb.__gsiDb;
}

export async function getDb(): Promise<Db> {
  return (await getDbHandle()).db;
}

export async function closeDb() {
  if (!globalForDb.__gsiDb) return;
  const handle = await globalForDb.__gsiDb;
  globalForDb.__gsiDb = undefined;
  await handle.close();
}

export { schema };

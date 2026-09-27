import path from "node:path";
import { getDbHandle } from "./index";

export async function runMigrations() {
  const handle = await getDbHandle();
  const migrationsFolder = path.join(process.cwd(), "drizzle");
  if (handle.driver === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle.db, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(handle.db as any, { migrationsFolder });
  }
}

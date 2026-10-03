/**
 * On-device queue service. Jobs live in Postgres, so restarting the app
 * does not drop them. This process keeps running beside the app.
 */
import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { runMigrations } from "@/server/db/migrate";
import { startWorker } from "@/server/jobs/worker";

function authorized(header: string | string[] | undefined, secret: string) {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return false;
  const got = Buffer.from(value);
  const expected = Buffer.from(secret);
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

async function main() {
  await runMigrations();
  const { rebuildConsolidatedIdeas } = await import("@/server/ideas/service");
  const ideas = await rebuildConsolidatedIdeas();
  console.log(`[queue] rebuilt ${ideas} consolidated ideas from the full signal history`);
  const { enqueueJob } = await import("@/server/jobs/queue");
  await enqueueJob("REFRESH_BOARD", { fullHistory: true }, { dedupeKey: "refresh-board-history" });
  await enqueueJob("RELABEL_FEED", {}, { dedupeKey: "relabel-feed" });
  console.log("[queue] queued one board pass over every stored signal");
  const port = Number(process.env.QUEUE_PORT ?? 4320);
  const secret = process.env.APP_SECRET ?? "";
  createServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    if (!secret || !authorized(req.headers["x-app-secret"], secret)) {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("unauthorized");
      return;
    }
    if (req.method === "GET" && req.url === "/telegram/status") {
      try {
        const { connectTelegram, telegramStatus } = await import("@/server/telegram");
        await connectTelegram();
        const status = await telegramStatus();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ connected: status.connected, lastError: status.lastError }));
      } catch (err) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(err instanceof Error ? err.message : "telegram status failed");
      }
      return;
    }
    if (req.method === "POST" && req.url === "/telegram/connect") {
      try {
        const { connectTelegram, telegramStatus } = await import("@/server/telegram");
        await connectTelegram();
        const status = await telegramStatus();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ connected: status.connected, lastError: status.lastError }));
      } catch (err) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(err instanceof Error ? err.message : "telegram connect failed");
      }
      return;
    }
    if (req.method === "POST" && req.url === "/telegram/sign-out") {
      try {
        const { SYSTEM } = await import("@/server/audit");
        const { signOutTelegram } = await import("@/server/telegram");
        await signOutTelegram(SYSTEM);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(err instanceof Error ? err.message : "telegram sign-out failed");
      }
      return;
    }
    if (req.method === "GET" && req.url === "/telegram/dialogs") {
      try {
        const { listJoinedTelegramChats } = await import("@/server/telegram");
        const listed = await listJoinedTelegramChats();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ connected: listed.connected, chats: listed.chats }));
      } catch (err) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(err instanceof Error ? err.message : "telegram list failed");
      }
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }).listen(port, "0.0.0.0");
  console.log(`[queue] listening on ${port}`);
  startWorker();
}

main().catch((err) => {
  console.error("[queue] failed to start:", err instanceof Error ? err.message : "error");
  process.exit(1);
});

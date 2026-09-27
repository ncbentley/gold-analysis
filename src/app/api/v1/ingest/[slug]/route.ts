import { timingSafeEqual } from "node:crypto";
import { apiError, json } from "@/server/api";
import { clientIp, rateLimit } from "@/server/auth/rate-limit";
import { ingestRawEvent } from "@/server/ingestion";
import { processJobs } from "@/server/jobs/runner";
import { getSourceBySlugOrId } from "@/server/signals/queries";

const MAX_BODY_BYTES = 64 * 1024;

function ingestToken() {
  if (process.env.INGEST_TOKEN) return process.env.INGEST_TOKEN;
  return process.env.NODE_ENV === "production" ? null : "dev-ingest-token";
}

function tokenMatches(given: string | null, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Webhook ingestion. Body is JSON. If it has a string `text` field that becomes the raw
 * message; otherwise the whole body is the raw message. `message_id` (or the
 * `x-message-id` header) makes redelivery idempotent; `published_at` overrides receive time.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/v1/ingest/[slug]">) {
  const { slug } = await ctx.params;
  const expected = ingestToken();
  if (!expected) return apiError(503, "ingest_disabled", "INGEST_TOKEN is not configured.");
  const auth = req.headers.get("x-ingest-token") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  if (!tokenMatches(auth, expected)) return apiError(401, "invalid_token", "Missing or invalid ingest token.");

  const limit = rateLimit(`ingest:${slug}:${clientIp(req.headers)}`, 120, 60_000);
  if (!limit.ok) return apiError(429, "rate_limited", "Too many events; slow down.", { retryAt: new Date(limit.resetAt).toISOString() });

  const source = await getSourceBySlugOrId(slug, { includeQa: true });
  if (!source || source.slug !== slug) return apiError(404, "unknown_source", "No source with this slug.");
  if (!source.active) return apiError(409, "source_disabled", "This source is disabled.");

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return apiError(413, "too_large", "Event body is too large.");
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed;
  } catch {
    return apiError(400, "invalid_json", "Body must be a JSON object.");
  }

  const rawText = typeof body.text === "string" ? body.text : raw;
  if (!rawText.trim()) return apiError(400, "empty", "Event has no content.");
  const messageId = req.headers.get("x-message-id") ?? (typeof body.message_id === "string" || typeof body.message_id === "number" ? String(body.message_id) : null);
  const publishedAt = typeof body.published_at === "string" && !Number.isNaN(Date.parse(body.published_at)) ? new Date(body.published_at) : new Date();
  if (publishedAt.getTime() > Date.now() + 5 * 60_000) return apiError(400, "future_timestamp", "published_at is in the future.");

  const result = await ingestRawEvent(source.id, { externalMessageId: messageId, rawText, payload: body, publishedAt });
  void processJobs(100).catch(() => {});
  if (result.status === "duplicate") return json({ status: "duplicate", rawEventId: result.rawEventId, reason: result.reason }, 200);
  return json(
    {
      status: "stored",
      rawEventId: result.rawEventId,
      parse: { status: result.parse.status, eventType: result.parse.eventType, signalId: result.parse.signalId, issues: result.parse.issues },
    },
    202,
  );
}

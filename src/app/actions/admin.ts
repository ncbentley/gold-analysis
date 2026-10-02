"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { removeSourceFromList, retryJob, upsertSource } from "@/server/admin";
import { upsertAffiliateLink, PLACEMENTS, type Placement } from "@/server/affiliates";
import { analyzeSignal, analyzeSourcePatterns } from "@/server/ai/service";
import { PROMPTS } from "@/server/ai/prompts";
import { recordAudit } from "@/server/audit";
import { requireAdmin } from "@/server/auth/guards";
import { SOURCE_TYPES, TIERS, type Tier } from "@/server/db/schema";
import { ALL_FEATURES, type Feature } from "@/server/entitlements/config";
import { getTierConfig, saveTierConfig } from "@/server/entitlements/service";
import { ingestRawEvent } from "@/server/ingestion";
import { enqueueJob, JOB_TYPES, type JobType } from "@/server/jobs/queue";
import { processJobs, scheduleRecurring } from "@/server/jobs/runner";
import { markTelegramImportQueued } from "@/server/telegram/import-status";
import { correctSignal, dismissReview, processRawEvent, resolveReviewWithSignal, type SignalInput } from "@/server/normalization";
import { clearOverride, overrideOutcome, recalculateOutcome } from "@/server/outcomes/service";
import { getMarketDataConfig, resetMarketData } from "@/server/market-data";
import { createTwelveDataProvider } from "@/server/market-data/twelvedata-provider";
import { PARSER_TYPES } from "@/server/parsing";
import { setSetting, SETTING_KEYS } from "@/server/settings";
import { enqueueDueTelegramSyncs } from "@/server/telegram/schedule";
import {
  cancelTelegramLogin,
  completeTelegramLogin,
  enableTelegramSignalTracking,
  HEADLINE_BACKFILL,
  queueJoinedTelegramChats,
  reconnectTelegram,
  setTelegramSourceStarred,
  starJoinedTelegramChat,
  stopTelegramSignalTracking,
  type JoinedChat,
  signOutTelegram,
  startTelegramLogin,
  telegramStatus,
} from "@/server/telegram";

function back(path: string, notice: string, kind: "ok" | "error" = "ok"): never {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${kind === "ok" ? "notice" : "error"}=${encodeURIComponent(notice)}`);
}

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const num = (form: FormData, key: string) => {
  const s = str(form, key);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};
const reasonOf = (form: FormData) => {
  const r = str(form, "reason");
  if (r.length < 3) throw new Error("A reason is required for manual changes.");
  return r.slice(0, 500);
};
const safeReturn = (form: FormData, fallback: string) => {
  const r = str(form, "returnTo");
  return r.startsWith("/admin") ? r : fallback;
};

/** The queue service runs jobs when JOBS_WORKER=off. The app must not take them. */
async function runQueued(limit: number) {
  if (process.env.JOBS_WORKER === "off") return 0;
  return processJobs(limit);
}

async function attempt(path: string, fn: () => Promise<string | void>) {
  let message: string | void;
  try {
    message = await fn();
  } catch (err) {
    back(path, (err as Error).message, "error");
  }
  revalidatePath("/admin", "layout");
  back(path, message || "Saved.");
}

/* Jobs */

export async function runJobsAction(form: FormData) {
  await requireAdmin();
  const path = safeReturn(form, "/admin/jobs");
  await attempt(path, async () => {
    if (process.env.JOBS_WORKER === "off") return "The queue service will run these jobs. Restarting the app does not drop them.";
    const n = await runQueued(300);
    return `Processed ${n} job${n === 1 ? "" : "s"}.`;
  });
}

export async function enqueueJobAction(form: FormData) {
  const { actor } = await requireAdmin();
  const path = safeReturn(form, "/admin/jobs");
  await attempt(path, async () => {
    const type = str(form, "type");
    if (type === "recurring:minute" || type === "recurring:telegram" || type === "recurring:hourly") {
      await scheduleRecurring(type.split(":")[1] as "minute" | "telegram" | "hourly");
    } else if ((JOB_TYPES as readonly string[]).includes(type)) {
      await enqueueJob(type as JobType, {});
    } else throw new Error("Unknown job type");
    await recordAudit({ actor, entityType: "job", entityId: type, action: "job.enqueued" });
    await runQueued(300);
    return `Queued and ran ${type}.`;
  });
}

export async function retryJobAction(form: FormData) {
  const { actor } = await requireAdmin();
  await attempt("/admin/jobs", async () => {
    const job = await retryJob(str(form, "id"), actor);
    if (!job) throw new Error("Only failed jobs can be retried.");
    await runQueued(50);
    return `Retried ${job.type}.`;
  });
}

/* Sources and events */

const sourceSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, "Slug may only contain lowercase letters, numbers and dashes"),
  sourceType: z.enum(SOURCE_TYPES),
  sourceUrl: z.url().nullable(),
  description: z.string().max(500).nullable(),
  timezone: z.string().min(1).max(60),
  parserType: z.enum(PARSER_TYPES as [string, ...string[]]),
  active: z.boolean(),
  isQa: z.boolean(),
});

export async function saveSourceAction(form: FormData) {
  const { actor } = await requireAdmin();
  const id = str(form, "id") || null;
  await attempt("/admin/telegram", async () => {
    const parsed = sourceSchema.safeParse({
      name: str(form, "name"),
      slug: str(form, "slug"),
      sourceType: str(form, "sourceType"),
      sourceUrl: str(form, "sourceUrl") || null,
      description: str(form, "description") || null,
      timezone: str(form, "timezone") || "UTC",
      parserType: str(form, "parserType"),
      active: form.get("active") === "on",
      isQa: form.get("isQa") === "on",
    });
    if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
    await upsertSource(id, parsed.data, actor);
    return id ? "Source updated." : "Source created.";
  });
}

export async function ingestManualEventAction(form: FormData) {
  const { actor } = await requireAdmin();
  await attempt("/admin/events", async () => {
    const sourceId = str(form, "sourceId");
    const rawText = str(form, "rawText");
    if (!sourceId || !rawText) throw new Error("Source and message text are required.");
    const publishedRaw = str(form, "publishedAt");
    const publishedAt = publishedRaw ? new Date(`${publishedRaw}Z`) : new Date();
    if (Number.isNaN(publishedAt.getTime())) throw new Error("Invalid publish time.");
    let payload: Record<string, unknown> | null = null;
    const payloadRaw = str(form, "payload");
    if (payloadRaw) {
      try {
        payload = JSON.parse(payloadRaw);
      } catch {
        throw new Error("Payload must be valid JSON.");
      }
    }
    const res = await ingestRawEvent(sourceId, { externalMessageId: str(form, "externalMessageId") || null, rawText, payload, publishedAt });
    if (res.status === "duplicate") return "Duplicate: this event was already recorded.";
    await recordAudit({ actor, entityType: "raw_event", entityId: res.rawEventId, action: "event.manual_ingest" });
    await runQueued(100);
    return "Event recorded and parsed.";
  });
}

export async function reparseEventAction(form: FormData) {
  const { actor } = await requireAdmin();
  const id = str(form, "id");
  await attempt(safeReturn(form, `/admin/events/${id}`), async () => {
    await processRawEvent(id, actor);
    await recordAudit({ actor, entityType: "raw_event", entityId: id, action: "event.reparsed" });
    await runQueued(50);
    return "Event re-parsed.";
  });
}

/* Review queue */

function signalInputFrom(form: FormData, fallbackTime: Date): SignalInput {
  const direction = str(form, "direction");
  const entryType = str(form, "entryType");
  if (direction !== "LONG" && direction !== "SHORT") throw new Error("Direction is required.");
  if (entryType !== "MARKET" && entryType !== "LIMIT" && entryType !== "ZONE") throw new Error("Entry type is required.");
  const entryMin = num(form, "entryMin");
  const entryMax = num(form, "entryMax") ?? entryMin;
  if (entryMin === null || Number.isNaN(entryMin) || entryMax === null || Number.isNaN(entryMax)) throw new Error("Entry price is required.");
  const stopLoss = num(form, "stopLoss");
  if (Number.isNaN(stopLoss)) throw new Error("Stop loss must be a number.");
  const targets = str(form, "targets")
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  if (targets.some((t) => !Number.isFinite(t))) throw new Error("Targets must be numbers separated by commas.");
  const [lo, hi] = entryMin <= entryMax ? [entryMin, entryMax] : [entryMax, entryMin];
  if (stopLoss !== null && (direction === "LONG" ? stopLoss >= lo : stopLoss <= hi)) throw new Error("Stop loss is on the wrong side of the entry.");
  if (targets.some((t) => (direction === "LONG" ? t <= lo : t >= hi))) throw new Error("A target is on the wrong side of the entry.");
  const time = str(form, "signalTime");
  const signalTime = time ? new Date(`${time}Z`) : fallbackTime;
  if (Number.isNaN(signalTime.getTime())) throw new Error("Invalid signal time.");
  return {
    instrument: "XAUUSD",
    direction,
    entryType,
    entryMin: lo,
    entryMax: hi,
    stopLoss,
    targets: [...targets].sort((a, b) => (direction === "LONG" ? a - b : b - a)),
    signalType: str(form, "signalType") || null,
    sourceConfidenceText: str(form, "sourceConfidenceText") || null,
    signalTime,
    expiryTime: null,
  };
}

export async function resolveReviewAction(form: FormData) {
  const { actor } = await requireAdmin();
  await attempt("/admin/review", async () => {
    const reason = reasonOf(form);
    const publishedAt = new Date(str(form, "publishedAt"));
    const signal = await resolveReviewWithSignal(str(form, "rawEventId"), signalInputFrom(form, publishedAt), actor, reason);
    await runQueued(50);
    return `Signal created (${signal.id.slice(0, 8)}).`;
  });
}

export async function dismissReviewAction(form: FormData) {
  const { actor } = await requireAdmin();
  await attempt("/admin/review", async () => {
    await dismissReview(str(form, "rawEventId"), actor, reasonOf(form));
    return "Dismissed.";
  });
}

/* Signals */

export async function correctSignalAction(form: FormData) {
  const { actor } = await requireAdmin();
  const id = str(form, "signalId");
  await attempt(`/admin/signals/${id}`, async () => {
    const reason = reasonOf(form);
    const input = signalInputFrom(form, new Date());
    const status = str(form, "status");
    const patch: Parameters<typeof correctSignal>[1] = { ...input };
    delete patch.expiryTime;
    delete patch.instrument;
    if (status === "INVALID") patch.status = "INVALID";
    await correctSignal(id, patch, actor, reason);
    await runQueued(50);
    return status === "INVALID" ? "Signal marked invalid." : "Signal corrected. Outcome recalculated.";
  });
}

export async function recalcOutcomeAction(form: FormData) {
  const { actor } = await requireAdmin();
  const id = str(form, "signalId");
  await attempt(`/admin/signals/${id}`, async () => {
    await recalculateOutcome(id, { force: form.get("force") === "on", actor });
    await recordAudit({ actor, entityType: "signal_outcome", entityId: id, action: "outcome.recalculated" });
    await runQueued(50);
    return "Outcome recalculated.";
  });
}

export async function overrideOutcomeAction(form: FormData) {
  const { actor } = await requireAdmin();
  const id = str(form, "signalId");
  await attempt(`/admin/signals/${id}`, async () => {
    const reason = reasonOf(form);
    const classification = str(form, "classification");
    if (!["WON", "LOST", "BREAKEVEN", "CANCELLED", "EXPIRED"].includes(classification)) throw new Error("Choose a classification.");
    const r = num(form, "rResult");
    if (Number.isNaN(r)) throw new Error("R result must be a number.");
    const exit = str(form, "exitTime");
    await overrideOutcome(id, { classification: classification as "WON", rResult: r, exitTime: exit ? new Date(`${exit}Z`) : null }, actor, reason);
    await runQueued(50);
    return "Outcome overridden.";
  });
}

export async function clearOverrideAction(form: FormData) {
  const { actor } = await requireAdmin();
  const id = str(form, "signalId");
  await attempt(`/admin/signals/${id}`, async () => {
    await clearOverride(id, actor, reasonOf(form));
    await runQueued(50);
    return "Override cleared; computed outcome restored.";
  });
}

export async function rerunAiAction(form: FormData) {
  const { actor } = await requireAdmin();
  const signalId = str(form, "signalId");
  const sourceId = str(form, "sourceId");
  const promptVersion = str(form, "promptVersion") || undefined;
  const path = signalId ? `/admin/signals/${signalId}` : "/admin/telegram";
  await attempt(path, async () => {
    if (promptVersion && !PROMPTS[promptVersion]) throw new Error("Unknown prompt version");
    if (signalId) {
      const r = await analyzeSignal(signalId, { promptVersion, force: true });
      await recordAudit({ actor, entityType: "signal", entityId: signalId, action: "ai.rerun", after: { promptVersion: r.analysis.promptVersion, model: r.analysis.model } });
      return `AI analysis regenerated with ${r.analysis.promptVersion}.`;
    }
    await analyzeSourcePatterns(sourceId, { force: true });
    await recordAudit({ actor, entityType: "source", entityId: sourceId, action: "ai.rerun" });
    return "Source pattern analysis regenerated.";
  });
}

/* Entitlements and affiliates */

export async function saveEntitlementsAction(form: FormData) {
  const { actor } = await requireAdmin();
  await attempt("/admin/entitlements", async () => {
    const reason = reasonOf(form);
    const before = await getTierConfig();
    const after = structuredClone(before);
    for (const tier of TIERS) {
      const features = form.getAll(`${tier}:features`).map(String).filter((f): f is Feature => (ALL_FEATURES as string[]).includes(f));
      const daysRaw = str(form, `${tier}:historyDays`);
      const days = daysRaw === "" ? null : Number(daysRaw);
      if (days !== null && (!Number.isInteger(days) || days < 1 || days > 36500)) throw new Error(`History days for ${tier} must be a positive whole number or empty.`);
      after[tier as Tier] = { features, historyDays: days };
    }
    for (const tier of TIERS) await saveTierConfig(tier, after[tier]);
    await recordAudit({ actor, entityType: "entitlements", entityId: "tiers", action: "entitlements.updated", before, after, reason });
    return "Entitlements saved. Changes apply to the next request.";
  });
}

export async function saveAffiliateAction(form: FormData) {
  const { actor } = await requireAdmin();
  await attempt("/admin/affiliates", async () => {
    const placements = form.getAll("placements").map(String).filter((p): p is Placement => (PLACEMENTS as readonly string[]).includes(p));
    const name = str(form, "name");
    const slug = str(form, "slug");
    const disclosure = str(form, "disclosure");
    if (!name || !/^[a-z0-9-]{2,60}$/.test(slug)) throw new Error("Name and a lowercase slug are required.");
    if (disclosure.length < 10) throw new Error("A disclosure statement is required.");
    await upsertAffiliateLink(str(form, "id") || null, { name, slug, destinationUrl: str(form, "destinationUrl"), disclosure, placements, active: form.get("active") === "on" }, actor);
    return "Affiliate link saved.";
  });
}

/* Telegram */

export async function telegramSendCodeAction(form: FormData) {
  const { actor } = await requireAdmin();
  await attempt("/admin/telegram", async () => {
    const apiId = Number(str(form, "apiId"));
    const apiHash = str(form, "apiHash");
    const phone = str(form, "phone").replace(/[\s()-]/g, "");
    if (!Number.isInteger(apiId) || apiId <= 0) throw new Error("API ID must be the number shown on my.telegram.org.");
    if (!/^[a-f0-9]{32}$/i.test(apiHash)) throw new Error("API hash must be the 32-character value shown on my.telegram.org.");
    if (!/^\+?[0-9]{6,16}$/.test(phone)) throw new Error("Enter the phone number in international format, e.g. +447700900123.");
    const { viaApp } = await startTelegramLogin({ apiId, apiHash, phone: phone.startsWith("+") ? phone : `+${phone}` }, actor);
    return viaApp ? "Code sent to your Telegram app. Enter it below." : "Code sent by SMS. Enter it below.";
  });
}

export async function telegramVerifyAction(form: FormData) {
  const { actor } = await requireAdmin();
  await attempt("/admin/telegram", async () => {
    const res = await completeTelegramLogin({ code: str(form, "code").replace(/\s/g, "") || undefined, password: str(form, "password") || undefined }, actor);
    if (res.needsPassword) return "This account has two-step verification. Enter your Telegram password.";
    await enqueueDueTelegramSyncs();
    return `Signed in as ${res.me.name}.`;
  });
}

export async function telegramCancelLoginAction() {
  await requireAdmin();
  await attempt("/admin/telegram", async () => {
    await cancelTelegramLogin();
    return "Sign-in cancelled.";
  });
}

export async function telegramSignOutAction() {
  const { actor } = await requireAdmin();
  await attempt("/admin/telegram", async () => {
    await signOutTelegram(actor);
    return "Signed out of Telegram. Channels stay in place; sign in again to resume syncing.";
  });
}

export async function telegramReconnectAction() {
  await requireAdmin();
  await attempt("/admin/telegram", async () => {
    const connected = await reconnectTelegram();
    if (!connected) throw new Error((await telegramStatus()).lastError ?? "Could not connect. Sign in again.");
    return "Connected to Telegram.";
  });
}

export async function removeSourceAction(form: FormData) {
  const { actor } = await requireAdmin();
  await attempt("/admin/telegram", async () => {
    const name = await removeSourceFromList(str(form, "id"), actor);
    return `${name} was removed from the list. Past signals stay. Add the channel again to capture new posts.`;
  });
}

function joinedChatFromForm(value: FormDataEntryValue): JoinedChat {
  if (typeof value !== "string") throw new Error("Choose a channel or group the connected account has joined.");
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    throw new Error("Choose a channel or group the connected account has joined.");
  }
  if (!raw || typeof raw !== "object") throw new Error("Choose a channel or group the connected account has joined.");
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const title = typeof row.title === "string" ? row.title.trim().slice(0, 80) : "";
  const kind = row.kind === "channel" || row.kind === "group" ? row.kind : null;
  const accessHash = typeof row.accessHash === "string" && /^-?[1-9][0-9]*$/.test(row.accessHash) ? row.accessHash : null;
  const username = typeof row.username === "string" && row.username.trim() ? row.username.trim().slice(0, 64) : null;
  if (!kind || !/^[1-9][0-9]*$/.test(id) || !title) throw new Error("Choose a channel or group the connected account has joined.");
  return { id, accessHash, username, title, kind };
}

export async function telegramAddJoinedChatAction(form: FormData) {
  const { actor } = await requireAdmin();
  await attempt("/admin/telegram", async () => {
    const parserType = str(form, "parserType") || PARSER_TYPES[0];
    if (!(PARSER_TYPES as readonly string[]).includes(parserType)) throw new Error("Unknown parser.");
    const backfill = Math.trunc(num(form, "backfill") ?? 0);
    if (!Number.isFinite(backfill) || backfill < 0 || backfill > 1000) throw new Error("Backfill must be between 0 and 1000 messages.");
    const chats = form.getAll("chat").map(joinedChatFromForm);
    if (chats.length === 0) throw new Error("Choose at least one channel or group.");
    const { queued, alreadyTracked } = await queueJoinedTelegramChats(chats, { isQa: form.get("isQa") === "on", parserType, backfill }, actor);
    if (queued.length === 0) return "Those channels are already tracked.";
    const names = queued.map((chat) => chat.title).join(", ");
    const skipped = alreadyTracked.length ? ` ${alreadyTracked.length} already tracked ${alreadyTracked.length === 1 ? "was" : "were"} left unchanged.` : "";
    return `Queued ${queued.length}: ${names}. Each row shows queued, then importing, then caught up or failed.${skipped}`;
  });
}

const DEFAULT_TRACK_BACKFILL = 200;

export async function saveTelegramTrackingAction(form: FormData) {
  const { actor } = await requireAdmin();
  await attempt("/admin/telegram", async () => {
    const removeIds = [...new Set(form.getAll("remove").map(String).filter(Boolean))];
    const chats = form.getAll("add").map(joinedChatFromForm);
    for (const id of removeIds) await stopTelegramSignalTracking(id, actor);
    let queuedCount = 0;
    let enabledCount = 0;
    const fresh: JoinedChat[] = [];
    for (const chat of chats) {
      const enabled = await enableTelegramSignalTracking(chat, actor);
      if (enabled) {
        if (!enabled.already) enabledCount += 1;
        continue;
      }
      fresh.push(chat);
    }
    if (fresh.length > 0) {
      const parserType = PARSER_TYPES[0];
      if (!parserType) throw new Error("No parser is configured.");
      const saved = await queueJoinedTelegramChats(fresh, { isQa: false, parserType, backfill: DEFAULT_TRACK_BACKFILL }, actor);
      queuedCount = saved.queued.length;
    }
    if (removeIds.length === 0 && queuedCount === 0 && enabledCount === 0) return chats.length > 0 ? "Those channels are already tracked." : "No channel changes to save.";
    const summary = [queuedCount > 0 ? `Now tracking ${queuedCount}` : null, enabledCount > 0 ? `signal tracking on for ${enabledCount}` : null, removeIds.length > 0 ? `stopped ${removeIds.length}` : null].filter((part): part is string => Boolean(part));
    const imported = queuedCount > 0 ? ` New channels import the latest ${DEFAULT_TRACK_BACKFILL} messages.` : "";
    return `${summary.join(", ")}.${imported}`;
  });
}

export async function starTelegramChannelAction(form: FormData) {
  const { actor } = await requireAdmin();
  await attempt("/admin/telegram", async () => {
    const starred = str(form, "starred") === "1";
    const sourceId = str(form, "sourceId");
    revalidatePath("/dashboard");
    if (sourceId) {
      const name = await setTelegramSourceStarred(sourceId, starred, actor);
      return starred ? `Starred ${name}. Its posts feed the dashboard direction read.` : `Unstarred ${name}.`;
    }
    if (!starred) throw new Error("That channel is not starred.");
    const parserType = PARSER_TYPES[0];
    if (!parserType) throw new Error("No parser is configured.");
    const chatValue = form.get("chat");
    if (chatValue === null) throw new Error("Choose a channel or group the connected account has joined.");
    const saved = await starJoinedTelegramChat(joinedChatFromForm(chatValue), parserType, actor);
    return `Starred ${saved.title}. The latest ${HEADLINE_BACKFILL} posts feed the dashboard direction read.`;
  });
}

export async function telegramSyncSourceAction(form: FormData) {
  await requireAdmin();
  await attempt("/admin/telegram", async () => {
    const id = str(form, "sourceId");
    await markTelegramImportQueued(id);
    await enqueueJob("TELEGRAM_SYNC", { sourceId: id }, { dedupeKey: `telegram-sync:${id}` });
    return "Sync is queued. The row will show queued, then importing, then caught up.";
  });
}

/* Settings */

export async function saveMarketDataAction(form: FormData) {
  const { actor } = await requireAdmin();
  await attempt("/admin/settings", async () => {
    const provider = str(form, "provider");
    if (provider !== "mock" && provider !== "twelvedata") throw new Error("Choose a market data provider.");
    const before = await getMarketDataConfig();
    const keyInput = str(form, "twelvedataApiKey");
    const twelvedataApiKey = keyInput || (before.provider === "twelvedata" ? before.twelvedataApiKey ?? null : null);
    if (provider === "twelvedata" && !twelvedataApiKey) throw new Error("A Twelve Data API key is required.");
    if (provider === "twelvedata" && keyInput) {
      const check = await createTwelveDataProvider(keyInput)
        .fetchMinuteBars("XAUUSD", new Date(Date.now() - 3 * 86_400_000), new Date())
        .catch((err: Error) => err);
      if (check instanceof Error && !/no data/i.test(check.message)) throw new Error(`Twelve Data rejected the key: ${check.message}`);
    }
    await setSetting(SETTING_KEYS.marketData, { provider, twelvedataApiKey: provider === "twelvedata" ? twelvedataApiKey : null });
    await recordAudit({ actor, entityType: "settings", entityId: "market_data", action: "settings.market_data", before: { provider: before.provider }, after: { provider } });
    if (before.provider !== provider) {
      // Bars from different providers must not be mixed inside one outcome evaluation.
      await resetMarketData();
      await enqueueJob("MARKET_DATA_BACKFILL", {}, { dedupeKey: "market-backfill" });
      await enqueueJob("RECALC_ALL_SIGNALS", {}, { dedupeKey: "recalc-all" });
      void runQueued(500).catch(() => {});
      return "Provider switched. Stored prices were cleared; history is being re-fetched and every outcome recalculated in the background.";
    }
    return "Market data settings saved.";
  });
}

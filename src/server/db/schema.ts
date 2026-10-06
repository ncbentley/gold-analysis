import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const SOURCE_TYPES = ["telegram", "webhook", "manual"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/* ------------------------------------------------------------------ */
/* Users, sessions, auth tokens                                        */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["member", "admin"] }).notNull().default("member"),
  emailVerifiedAt: ts("email_verified_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 of the cookie token
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const authTokens = pgTable("auth_tokens", {
  id: text("id").primaryKey(), // sha256 of the emailed token
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["verify_email", "reset_password"] }).notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

/** Local stand-in for an email provider. Every outbound email is recorded here. */
export const outboundEmails = pgTable("outbound_emails", {
  id: id(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Billing and entitlements                                            */
/* ------------------------------------------------------------------ */

export const TIERS = ["silver", "gold"] as const;
export type Tier = (typeof TIERS)[number];
export const PERIODS = ["weekly", "monthly", "annual"] as const;
export type BillingPeriod = (typeof PERIODS)[number];

export const plans = pgTable(
  "plans",
  {
    id: id(),
    tier: text("tier", { enum: TIERS }).notNull(),
    period: text("period", { enum: PERIODS }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    providerPriceId: text("provider_price_id"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("plans_tier_period_idx").on(t.tier, t.period)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tier: text("tier", { enum: TIERS }).notNull(),
    period: text("period", { enum: PERIODS }).notNull(),
    status: text("status", {
      enum: ["incomplete", "active", "trialing", "past_due", "canceled", "expired"],
    }).notNull(),
    provider: text("provider", { enum: ["stripe", "mock"] }).notNull(),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id").unique(),
    currentPeriodEnd: ts("current_period_end").notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: ts("canceled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("subscriptions_user_idx").on(t.userId)],
);

/** Configurable entitlements. One row per tier; features are string keys. */
export const tierEntitlements = pgTable("tier_entitlements", {
  tier: text("tier", { enum: TIERS }).primaryKey(),
  features: jsonb("features").$type<string[]>().notNull(),
  historyDays: integer("history_days"), // null = unlimited
  updatedAt: updatedAt(),
});

/** One complimentary tier per member. It never charges and stays until an admin removes it. */
export const complimentaryGrants = pgTable("complimentary_grants", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  tier: text("tier", { enum: TIERS }).notNull(),
  grantedByUserId: text("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Sources and raw evidence                                            */
/* ------------------------------------------------------------------ */

export const sources = pgTable(
  "sources",
  {
    id: id(),
    name: text("name").notNull(),
    /** What members see instead of the channel name. Unique ignoring case; the database generates one when omitted. */
    nickname: text("nickname").notNull().default(sql`generate_source_nickname()`),
    slug: text("slug").notNull().unique(),
    sourceType: text("source_type", { enum: SOURCE_TYPES }).notNull(),
    sourceUrl: text("source_url"),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    /** QA sources are visible to admins only and never appear in member views or public stats. */
    isQa: boolean("is_qa").notNull().default(false),
    timezone: text("timezone").notNull().default("UTC"),
    parserType: text("parser_type").notNull(),
    telegramChannelId: text("telegram_channel_id").unique(),
    telegramAccessHash: text("telegram_access_hash"),
    telegramUsername: text("telegram_username"),
    lastMessageId: integer("last_message_id"),
    lastSyncedAt: ts("last_synced_at"),
    syncError: text("sync_error"),
    /** queued, then importing, then caught_up or failed. Null on sources added before this column. */
    importStatus: text("import_status", { enum: ["queued", "importing", "caught_up", "failed"] }),
    /** Set when an admin takes the source off the list. The row stays so past signals remain. */
    removedAt: ts("removed_at"),
    /** Posts from a starred source feed the dashboard market-direction read. */
    starred: boolean("starred").notNull().default(false),
    /** False for a headline-only source. Its posts are stored and never parsed as trades. */
    parseSignals: boolean("parse_signals").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("sources_nickname_idx").on(sql`lower(${t.nickname})`)],
);

/** Encrypted key/value store for credentials entered in the admin (Telegram session, API keys). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  valueEncrypted: text("value_encrypted").notNull(),
  updatedAt: updatedAt(),
});

export const EVENT_TYPES = [
  "NEW_SIGNAL",
  "UPDATE",
  "CANCEL",
  "TARGET_HIT",
  "STOP_HIT",
  "CLOSE",
  "COMMENT",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Immutable. Rows are only ever inserted. */
export const rawEvents = pgTable(
  "raw_events",
  {
    id: id(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    externalMessageId: text("external_message_id"),
    rawText: text("raw_text").notNull(),
    rawPayloadJson: jsonb("raw_payload_json").$type<Record<string, unknown>>(),
    publishedAt: ts("published_at").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    eventType: text("event_type", { enum: EVENT_TYPES }),
    contentHash: text("content_hash").notNull(),
  },
  (t) => [
    uniqueIndex("raw_events_source_ext_idx").on(t.sourceId, t.externalMessageId),
    uniqueIndex("raw_events_source_hash_idx").on(t.sourceId, t.contentHash),
    index("raw_events_published_idx").on(t.publishedAt),
  ],
);

/** Each parse attempt is a new row; raw events are never mutated. */
export const parseResults = pgTable(
  "parse_results",
  {
    id: id(),
    rawEventId: text("raw_event_id")
      .notNull()
      .references(() => rawEvents.id),
    parserType: text("parser_type").notNull(),
    parserVersion: text("parser_version").notNull(),
    eventType: text("event_type", { enum: EVENT_TYPES }).notNull(),
    outputJson: jsonb("output_json").$type<Record<string, unknown>>().notNull(),
    confidence: doublePrecision("confidence").notNull(),
    status: text("status", {
      enum: ["applied", "needs_review", "failed", "ignored", "resolved", "superseded"],
    }).notNull(),
    issues: jsonb("issues").$type<string[]>().notNull().default([]),
    signalId: text("signal_id"),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("parse_results_event_idx").on(t.rawEventId), index("parse_results_status_idx").on(t.status)],
);

/* ------------------------------------------------------------------ */
/* Normalized signals                                                  */
/* ------------------------------------------------------------------ */

export const SIGNAL_STATUSES = [
  "PENDING",
  "ACTIVE",
  "PARTIAL",
  "WON",
  "LOST",
  "BREAKEVEN",
  "CANCELLED",
  "EXPIRED",
  "INVALID",
  "MANUAL_REVIEW",
] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export const signals = pgTable(
  "signals",
  {
    id: id(),
    sourceId: text("source_id")
      .notNull()
      .references(() => sources.id),
    originEventId: text("origin_event_id")
      .notNull()
      .references(() => rawEvents.id),
    instrument: text("instrument").notNull().default("XAUUSD"),
    direction: text("direction", { enum: ["LONG", "SHORT"] }).notNull(),
    entryType: text("entry_type", { enum: ["MARKET", "LIMIT", "ZONE"] }).notNull(),
    signalType: text("signal_type"),
    entryMin: doublePrecision("entry_min").notNull(),
    entryMax: doublePrecision("entry_max").notNull(),
    stopLoss: doublePrecision("stop_loss"),
    status: text("status", { enum: SIGNAL_STATUSES }).notNull().default("PENDING"),
    signalTime: ts("signal_time").notNull(),
    expiryTime: ts("expiry_time"),
    closedAt: ts("closed_at"),
    sourceConfidenceText: text("source_confidence_text"),
    parserConfidence: doublePrecision("parser_confidence").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("signals_source_idx").on(t.sourceId),
    index("signals_time_idx").on(t.signalTime),
    index("signals_status_idx").on(t.status),
  ],
);

export const consolidatedIdeas = pgTable("consolidated_ideas", {
  id: id(),
  direction: text("direction", { enum: ["LONG", "SHORT"] }).notNull(),
  entryMin: doublePrecision("entry_min").notNull(),
  entryMax: doublePrecision("entry_max").notNull(),
  stopLoss: doublePrecision("stop_loss"),
  targets: jsonb("targets").$type<number[]>().notNull(),
  exitSpreadStops: doublePrecision("exit_spread_stops"),
  exitSpreadTargets: jsonb("exit_spread_targets").$type<number[]>().notNull(),
  sourceCount: integer("source_count").notNull(),
  signalIds: jsonb("signal_ids").$type<string[]>().notNull(),
  replacedSignalIds: jsonb("replaced_signal_ids").$type<string[]>().notNull().default([]),
  newestSignalAt: ts("newest_signal_at").notNull(),
  frozenAt: ts("frozen_at"),
  phase: text("phase").notNull().default("available"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const goldBookEntries = pgTable("gold_book_entries", {
  id: id(),
  ideaId: text("idea_id")
    .notNull()
    .references(() => consolidatedIdeas.id, { onDelete: "cascade" }),
  direction: text("direction", { enum: ["LONG", "SHORT"] }).notNull(),
  entryMin: doublePrecision("entry_min").notNull(),
  entryMax: doublePrecision("entry_max").notNull(),
  stopLoss: doublePrecision("stop_loss"),
  targets: jsonb("targets").$type<number[]>().notNull(),
  sectionAtCall: text("section_at_call", { enum: ["available", "active"] }),
  closeCalledAt: ts("close_called_at"),
  exitTime: ts("exit_time"),
  exitPrice: doublePrecision("exit_price"),
  retired: boolean("retired").notNull().default(false),
  createdAt: createdAt(),
});

export interface BoardPick {
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  targets: number[];
  writeup: string;
  ideaIds: string[];
}

/** One model pass. The active row is the board on screen. Older rows stay as history. */
export const boardPosts = pgTable("board_posts", {
  id: id(),
  active: boolean("active").notNull().default(false),
  model: text("model"),
  promptVersion: text("prompt_version").notNull(),
  directionKey: text("direction_key"),
  signalIds: jsonb("signal_ids").$type<string[]>().notNull(),
  ideaIds: jsonb("idea_ids").$type<string[]>().notNull(),
  primary: jsonb("primary").$type<BoardPick>().notNull(),
  alternates: jsonb("alternates").$type<BoardPick[]>().notNull(),
  cardState: jsonb("card_state").$type<BoardCardState[]>().notNull().default([]),
  labeledAt: ts("labeled_at"),
  createdAt: createdAt(),
});

export interface BoardCardState {
  slot: "primary" | number;
  phase: "available" | "playing-out" | "history";
  startedAt: number;
}

/** Bumped once when a stored dashboard label changes. Pages read this instead of replaying bars. */
export const feedRevisions = pgTable("feed_revisions", {
  id: text("id").primaryKey(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  fingerprint: text("fingerprint"),
});

/** Precomputed dashboard for one membership. The page reads this and does not recompute it. */
export const dashboardSnapshots = pgTable("dashboard_snapshots", {
  view: text("view").primaryKey(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const signalTargets = pgTable(
  "signal_targets",
  {
    id: id(),
    signalId: text("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    targetIndex: integer("target_index").notNull(),
    price: doublePrecision("price"),
    hitAt: ts("hit_at"),
    status: text("status", { enum: ["OPEN", "HIT", "MISSED", "AMBIGUOUS"] }).notNull().default("OPEN"),
  },
  (t) => [uniqueIndex("signal_targets_idx").on(t.signalId, t.targetIndex)],
);

/** Source-issued instructions that affect an existing trade (move stop, close, cancel). */
export const signalAdjustments = pgTable(
  "signal_adjustments",
  {
    id: id(),
    signalId: text("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    rawEventId: text("raw_event_id").references(() => rawEvents.id),
    type: text("type", { enum: ["MOVE_STOP", "CLOSE", "CANCEL", "EDIT"] }).notNull(),
    effectiveAt: ts("effective_at").notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("signal_adjustments_signal_idx").on(t.signalId)],
);

/* ------------------------------------------------------------------ */
/* Market data                                                         */
/* ------------------------------------------------------------------ */

export const marketBars = pgTable(
  "market_bars",
  {
    instrument: text("instrument").notNull(),
    resolution: text("resolution").notNull().default("1m"),
    timestamp: ts("timestamp").notNull(),
    open: doublePrecision("open").notNull(),
    high: doublePrecision("high").notNull(),
    low: doublePrecision("low").notNull(),
    close: doublePrecision("close").notNull(),
    volume: doublePrecision("volume"),
    provider: text("provider").notNull(),
  },
  (t) => [primaryKey({ columns: [t.instrument, t.resolution, t.timestamp] })],
);

/** How far market data is known to be complete, per instrument. */
export const marketDataSync = pgTable("market_data_sync", {
  instrument: text("instrument").primaryKey(),
  provider: text("provider").notNull(),
  syncedThrough: ts("synced_through").notNull(),
  firstBarAt: ts("first_bar_at"),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Derived facts                                                       */
/* ------------------------------------------------------------------ */

export const signalOutcomes = pgTable(
  "signal_outcomes",
  {
    id: id(),
    signalId: text("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    calcVersion: text("calc_version").notNull(),
    signalVersion: integer("signal_version").notNull(),
    kind: text("kind", { enum: ["computed", "override"] }).notNull().default("computed"),
    isCurrent: boolean("is_current").notNull().default(true),
    classification: text("classification").notNull(),
    entered: boolean("entered").notNull(),
    entryTime: ts("entry_time"),
    entryPrice: doublePrecision("entry_price"),
    exitTime: ts("exit_time"),
    exitReason: text("exit_reason"),
    stopHitAt: ts("stop_hit_at"),
    rResult: doublePrecision("r_result"),
    mfe: doublePrecision("mfe"),
    mae: doublePrecision("mae"),
    mfeR: doublePrecision("mfe_r"),
    maeR: doublePrecision("mae_r"),
    bestPrice: doublePrecision("best_price"),
    worstPrice: doublePrecision("worst_price"),
    durationMinutes: integer("duration_minutes"),
    ambiguous: boolean("ambiguous").notNull().default(false),
    detailJson: jsonb("detail_json").$type<Record<string, unknown>>().notNull(),
    overrideReason: text("override_reason"),
    createdBy: text("created_by"),
    computedAt: createdAt(),
  },
  (t) => [index("signal_outcomes_signal_idx").on(t.signalId, t.isCurrent)],
);

export const aiAnalyses = pgTable(
  "ai_analyses",
  {
    id: id(),
    signalId: text("signal_id").references(() => signals.id, { onDelete: "cascade" }),
    sourceId: text("source_id").references(() => sources.id),
    analysisType: text("analysis_type", { enum: ["signal_setup", "source_patterns"] }).notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputHash: text("input_hash").notNull(),
    inputJson: jsonb("input_json").$type<Record<string, unknown>>().notNull(),
    outputJson: jsonb("output_json").$type<Record<string, unknown>>().notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("ai_analyses_signal_idx").on(t.signalId), index("ai_analyses_source_idx").on(t.sourceId)],
);

export const sourceStats = pgTable("source_stats", {
  sourceId: text("source_id")
    .primaryKey()
    .references(() => sources.id),
  calcVersion: text("calc_version").notNull(),
  statsJson: jsonb("stats_json").$type<Record<string, unknown>>().notNull(),
  computedAt: ts("computed_at").notNull().defaultNow(),
});

export const DIRECTION_LEANS = ["bid", "defensive", "offered"] as const;
export type DirectionLean = (typeof DIRECTION_LEANS)[number];

export interface DirectionHeadlineRecord {
  sourceId: string;
  sourceName: string;
  text: string;
  publishedAt: string;
}

/** One row each time starred headlines are read against the latest gold price. */
export const marketDirectionSnapshots = pgTable("market_direction_snapshots", {
  id: id(),
  lean: text("lean", { enum: DIRECTION_LEANS }).notNull(),
  summary: text("summary").notNull(),
  headlines: jsonb("headlines").$type<DirectionHeadlineRecord[]>().notNull(),
  spot: doublePrecision("spot"),
  change60m: doublePrecision("change_60m"),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* Operations: jobs, audit, affiliates, analytics                      */
/* ------------------------------------------------------------------ */

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
    dedupeKey: text("dedupe_key"),
    status: text("status", { enum: ["queued", "running", "succeeded", "failed"] }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    runAfter: ts("run_after").notNull().defaultNow(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("jobs_status_idx").on(t.status, t.runAfter),
    index("jobs_claim_idx").on(t.type, t.status, t.runAfter, t.createdAt),
    index("jobs_dedupe_idx").on(t.dedupeKey),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorUserId: text("actor_user_id"),
    actorLabel: text("actor_label").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    beforeJson: jsonb("before_json").$type<unknown>(),
    afterJson: jsonb("after_json").$type<unknown>(),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId)],
);

export const affiliateLinks = pgTable("affiliate_links", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  destinationUrl: text("destination_url").notNull(),
  disclosure: text("disclosure").notNull(),
  placements: jsonb("placements").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  clickCount: integer("click_count").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const affiliateClicks = pgTable(
  "affiliate_clicks",
  {
    id: id(),
    linkId: text("link_id")
      .notNull()
      .references(() => affiliateLinks.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    createdAt: createdAt(),
  },
  (t) => [index("affiliate_clicks_link_idx").on(t.linkId)],
);

export type StoredTouch = {
  at: string;
  landing: string;
  referrer: string | null;
  params: Record<string, string>;
};

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: id(),
    name: text("name").notNull(),
    userId: text("user_id"),
    visitorId: text("visitor_id"),
    propsJson: jsonb("props_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("analytics_name_idx").on(t.name), index("analytics_visitor_idx").on(t.visitorId)],
);

/** First and last campaign touch for an account. First touch is never replaced. */
export const userAttributions = pgTable(
  "user_attributions",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    visitorId: text("visitor_id").notNull(),
    firstTouch: jsonb("first_touch").$type<StoredTouch>().notNull(),
    lastTouch: jsonb("last_touch").$type<StoredTouch>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("user_attributions_visitor_idx").on(t.visitorId)],
);

/** One row per campaign arrival, including the direct visit that created a visitor. */
export const attributionTouches = pgTable(
  "attribution_touches",
  {
    id: id(),
    touchKey: text("touch_key").notNull().unique(),
    visitorId: text("visitor_id").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    landing: text("landing").notNull(),
    referrer: text("referrer"),
    params: jsonb("params").$type<Record<string, string>>().notNull().default({}),
    touchedAt: ts("touched_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("attribution_touches_visitor_idx").on(t.visitorId), index("attribution_touches_touched_idx").on(t.touchedAt)],
);

export type User = typeof users.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type RawEvent = typeof rawEvents.$inferSelect;
export type Signal = typeof signals.$inferSelect;
export type SignalTarget = typeof signalTargets.$inferSelect;
export type SignalAdjustment = typeof signalAdjustments.$inferSelect;
export type SignalOutcome = typeof signalOutcomes.$inferSelect;
export type MarketBar = typeof marketBars.$inferSelect;
export type AiAnalysis = typeof aiAnalyses.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type ComplimentaryGrant = typeof complimentaryGrants.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type AffiliateLink = typeof affiliateLinks.$inferSelect;
export type Job = typeof jobs.$inferSelect;

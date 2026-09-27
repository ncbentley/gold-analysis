CREATE TABLE "affiliate_clicks" (
	"id" text PRIMARY KEY NOT NULL,
	"link_id" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_links" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"destination_url" text NOT NULL,
	"disclosure" text NOT NULL,
	"placements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"click_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affiliate_links_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ai_analyses" (
	"id" text PRIMARY KEY NOT NULL,
	"signal_id" text,
	"source_id" text,
	"analysis_type" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"input_json" jsonb NOT NULL,
	"output_json" jsonb NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"user_id" text,
	"props_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"actor_label" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"dedupe_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_bars" (
	"instrument" text NOT NULL,
	"resolution" text DEFAULT '1m' NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"open" double precision NOT NULL,
	"high" double precision NOT NULL,
	"low" double precision NOT NULL,
	"close" double precision NOT NULL,
	"volume" double precision,
	"provider" text NOT NULL,
	CONSTRAINT "market_bars_instrument_resolution_timestamp_pk" PRIMARY KEY("instrument","resolution","timestamp")
);
--> statement-breakpoint
CREATE TABLE "market_data_sync" (
	"instrument" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"synced_through" timestamp with time zone NOT NULL,
	"first_bar_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parse_results" (
	"id" text PRIMARY KEY NOT NULL,
	"raw_event_id" text NOT NULL,
	"parser_type" text NOT NULL,
	"parser_version" text NOT NULL,
	"event_type" text NOT NULL,
	"output_json" jsonb NOT NULL,
	"confidence" double precision NOT NULL,
	"status" text NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signal_id" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"period" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"provider_price_id" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_events" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"external_message_id" text,
	"raw_text" text NOT NULL,
	"raw_payload_json" jsonb,
	"published_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" text,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"signal_id" text NOT NULL,
	"raw_event_id" text,
	"type" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"payload_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"signal_id" text NOT NULL,
	"calc_version" text NOT NULL,
	"signal_version" integer NOT NULL,
	"kind" text DEFAULT 'computed' NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"classification" text NOT NULL,
	"entered" boolean NOT NULL,
	"entry_time" timestamp with time zone,
	"entry_price" double precision,
	"exit_time" timestamp with time zone,
	"exit_reason" text,
	"stop_hit_at" timestamp with time zone,
	"r_result" double precision,
	"mfe" double precision,
	"mae" double precision,
	"mfe_r" double precision,
	"mae_r" double precision,
	"best_price" double precision,
	"worst_price" double precision,
	"duration_minutes" integer,
	"ambiguous" boolean DEFAULT false NOT NULL,
	"detail_json" jsonb NOT NULL,
	"override_reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"signal_id" text NOT NULL,
	"target_index" integer NOT NULL,
	"price" double precision NOT NULL,
	"hit_at" timestamp with time zone,
	"status" text DEFAULT 'OPEN' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"origin_event_id" text NOT NULL,
	"instrument" text DEFAULT 'XAUUSD' NOT NULL,
	"direction" text NOT NULL,
	"entry_type" text NOT NULL,
	"signal_type" text,
	"entry_min" double precision NOT NULL,
	"entry_max" double precision NOT NULL,
	"stop_loss" double precision,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"signal_time" timestamp with time zone NOT NULL,
	"expiry_time" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"source_confidence_text" text,
	"parser_confidence" double precision NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_stats" (
	"source_id" text PRIMARY KEY NOT NULL,
	"calc_version" text NOT NULL,
	"stats_json" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"parser_type" text NOT NULL,
	"show_raw_text" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tier" text NOT NULL,
	"period" text NOT NULL,
	"status" text NOT NULL,
	"provider" text NOT NULL,
	"provider_customer_id" text,
	"provider_subscription_id" text,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_provider_subscription_id_unique" UNIQUE("provider_subscription_id")
);
--> statement-breakpoint
CREATE TABLE "tier_entitlements" (
	"tier" text PRIMARY KEY NOT NULL,
	"features" jsonb NOT NULL,
	"history_days" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_link_id_affiliate_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."affiliate_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parse_results" ADD CONSTRAINT "parse_results_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_adjustments" ADD CONSTRAINT "signal_adjustments_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_adjustments" ADD CONSTRAINT "signal_adjustments_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_outcomes" ADD CONSTRAINT "signal_outcomes_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_targets" ADD CONSTRAINT "signal_targets_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_origin_event_id_raw_events_id_fk" FOREIGN KEY ("origin_event_id") REFERENCES "public"."raw_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_stats" ADD CONSTRAINT "source_stats_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "affiliate_clicks_link_idx" ON "affiliate_clicks" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "ai_analyses_signal_idx" ON "ai_analyses" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "ai_analyses_source_idx" ON "ai_analyses" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "analytics_name_idx" ON "analytics_events" USING btree ("name");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_dedupe_idx" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "parse_results_event_idx" ON "parse_results" USING btree ("raw_event_id");--> statement-breakpoint
CREATE INDEX "parse_results_status_idx" ON "parse_results" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_tier_period_idx" ON "plans" USING btree ("tier","period");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_events_source_ext_idx" ON "raw_events" USING btree ("source_id","external_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_events_source_hash_idx" ON "raw_events" USING btree ("source_id","content_hash");--> statement-breakpoint
CREATE INDEX "raw_events_published_idx" ON "raw_events" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "signal_adjustments_signal_idx" ON "signal_adjustments" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "signal_outcomes_signal_idx" ON "signal_outcomes" USING btree ("signal_id","is_current");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_targets_idx" ON "signal_targets" USING btree ("signal_id","target_index");--> statement-breakpoint
CREATE INDEX "signals_source_idx" ON "signals" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "signals_time_idx" ON "signals" USING btree ("signal_time");--> statement-breakpoint
CREATE INDEX "signals_status_idx" ON "signals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");
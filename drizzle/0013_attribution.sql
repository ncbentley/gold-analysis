ALTER TABLE "analytics_events" ADD COLUMN "visitor_id" text;
--> statement-breakpoint
CREATE INDEX "analytics_visitor_idx" ON "analytics_events" ("visitor_id");
--> statement-breakpoint
CREATE TABLE "user_attributions" (
  "user_id" text PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "visitor_id" text NOT NULL,
  "first_touch" jsonb NOT NULL,
  "last_touch" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "user_attributions_visitor_idx" ON "user_attributions" ("visitor_id");
--> statement-breakpoint
CREATE TABLE "attribution_touches" (
  "id" text PRIMARY KEY,
  "touch_key" text NOT NULL UNIQUE,
  "visitor_id" text NOT NULL,
  "user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "landing" text NOT NULL,
  "referrer" text,
  "params" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "touched_at" timestamptz NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "attribution_touches_visitor_idx" ON "attribution_touches" ("visitor_id");
--> statement-breakpoint
CREATE INDEX "attribution_touches_touched_idx" ON "attribution_touches" ("touched_at");

DELETE FROM "subscriptions" WHERE "tier" = 'gold';
--> statement-breakpoint
DELETE FROM "plans" WHERE "tier" = 'gold';
--> statement-breakpoint
DELETE FROM "tier_entitlements" WHERE "tier" = 'gold';
--> statement-breakpoint
CREATE TABLE "board_posts" (
  "id" text PRIMARY KEY,
  "active" boolean DEFAULT false NOT NULL,
  "model" text,
  "prompt_version" text NOT NULL,
  "direction_key" text,
  "signal_ids" jsonb NOT NULL,
  "idea_ids" jsonb NOT NULL,
  "primary" jsonb NOT NULL,
  "alternates" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

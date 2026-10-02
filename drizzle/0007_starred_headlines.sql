ALTER TABLE "sources" ADD COLUMN "starred" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "parse_signals" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE "market_direction_snapshots" (
  "id" text PRIMARY KEY,
  "lean" text NOT NULL,
  "summary" text NOT NULL,
  "headlines" jsonb NOT NULL,
  "spot" double precision,
  "change_60m" double precision,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

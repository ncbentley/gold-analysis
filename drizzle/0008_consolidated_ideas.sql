CREATE TABLE "consolidated_ideas" (
  "id" text PRIMARY KEY,
  "direction" text NOT NULL,
  "entry_min" double precision NOT NULL,
  "entry_max" double precision NOT NULL,
  "stop_loss" double precision,
  "targets" jsonb NOT NULL,
  "exit_spread_stops" double precision,
  "exit_spread_targets" jsonb NOT NULL,
  "source_count" integer NOT NULL,
  "signal_ids" jsonb NOT NULL,
  "replaced_signal_ids" jsonb DEFAULT '[]' NOT NULL,
  "newest_signal_at" timestamptz NOT NULL,
  "frozen_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

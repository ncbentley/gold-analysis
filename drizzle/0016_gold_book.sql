CREATE TABLE "gold_book_entries" (
  "id" text PRIMARY KEY NOT NULL,
  "idea_id" text NOT NULL REFERENCES "consolidated_ideas"("id") ON DELETE cascade,
  "direction" text NOT NULL,
  "entry_min" double precision NOT NULL,
  "entry_max" double precision NOT NULL,
  "stop_loss" double precision,
  "targets" jsonb NOT NULL,
  "section_at_call" text,
  "close_called_at" timestamptz,
  "exit_time" timestamptz,
  "exit_price" double precision,
  "retired" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE "consolidated_ideas" ADD COLUMN "phase" text DEFAULT 'available' NOT NULL;
--> statement-breakpoint
ALTER TABLE "board_posts" ADD COLUMN "card_state" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "board_posts" ADD COLUMN "labeled_at" timestamptz;
--> statement-breakpoint
CREATE TABLE "feed_revisions" (
  "id" text PRIMARY KEY,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "feed_revisions" ("id") VALUES ('dashboard');

ALTER TABLE "feed_revisions" ADD COLUMN "fingerprint" text;
--> statement-breakpoint
CREATE TABLE "dashboard_snapshots" (
  "view" text PRIMARY KEY,
  "payload" jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

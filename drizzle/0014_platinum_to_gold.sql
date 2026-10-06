UPDATE "subscriptions" SET "tier" = 'gold' WHERE "tier" = 'platinum';
--> statement-breakpoint
UPDATE "plans" SET "tier" = 'gold' WHERE "tier" = 'platinum';
--> statement-breakpoint
UPDATE "tier_entitlements" SET "tier" = 'gold' WHERE "tier" = 'platinum';
--> statement-breakpoint
DELETE FROM "dashboard_snapshots" WHERE "view" = 'platinum';

INSERT INTO "tier_entitlements" ("tier", "features", "history_days")
VALUES ('basic', '["signals.core","signals.basic_result"]'::jsonb, 7)
ON CONFLICT ("tier") DO NOTHING;
--> statement-breakpoint
INSERT INTO "plans" ("id", "tier", "period", "amount_cents", "currency", "active")
VALUES
  ('plan_basic_weekly', 'basic', 'weekly', 500, 'usd', true),
  ('plan_basic_monthly', 'basic', 'monthly', 1000, 'usd', true),
  ('plan_basic_annual', 'basic', 'annual', 10000, 'usd', true)
ON CONFLICT ("tier", "period") DO NOTHING;

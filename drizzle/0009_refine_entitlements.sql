UPDATE "tier_entitlements"
SET "features" = '["signals.core","signals.basic_result","sources.stats.summary"]'::jsonb,
    "history_days" = 180
WHERE "tier" = 'silver';
--> statement-breakpoint
UPDATE "tier_entitlements"
SET "features" = '["signals.core","signals.basic_result","sources.stats.summary","sources.stats.recent","sources.stats.time_of_day","sources.stats.direction","sources.stats.signal_type","sources.history.full","sources.stats.extended","similar.summary","similar.details","outcome.excursion_summary","outcome.excursion_detail","outcome.time_to_target","filters.advanced","search.history"]'::jsonb,
    "history_days" = NULL
WHERE "tier" = 'platinum';
--> statement-breakpoint
UPDATE "plans"
SET "amount_cents" = 1400
WHERE "tier" = 'silver' AND "period" = 'weekly';

-- Existing installs keep admin edits to other features. These keys are added once.
UPDATE "tier_entitlements"
SET "features" = "features" || '["consensus.grade","consensus.timing"]'::jsonb
WHERE "tier" = 'gold'
  AND NOT ("features" @> '["consensus.grade"]'::jsonb);
--> statement-breakpoint
UPDATE "tier_entitlements"
SET "features" = "features" || '["consensus.grade","consensus.timing","consensus.mapping"]'::jsonb
WHERE "tier" = 'platinum'
  AND NOT ("features" @> '["consensus.mapping"]'::jsonb);

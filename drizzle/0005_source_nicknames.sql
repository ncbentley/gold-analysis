-- Members see a source by its nickname. The function is the column default, so every insert path gets a unique one.
CREATE OR REPLACE FUNCTION generate_source_nickname() RETURNS text
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  adjectives text[] := ARRAY[
    'Amber','Arctic','Ashen','Azure','Bold','Brass','Bright','Cedar','Cobalt','Copper','Coral','Crimson','Desert','Dusky','Ember','Emerald','Frost','Granite','Indigo','Iron',
    'Ivory','Jade','Lunar','Marble','Midnight','Misty','Noble','Obsidian','Onyx','Polar','Quiet','Rapid','Sable','Scarlet','Solar','Steady','Storm','Swift','Velvet','Wild'];
  nouns text[] := ARRAY[
    'Albatross','Antelope','Badger','Barracuda','Bear','Bison','Caracal','Cheetah','Cobra','Condor','Coyote','Crane','Eagle','Falcon','Fox','Gazelle','Hawk','Heron','Hornet','Ibex',
    'Jaguar','Leopard','Lion','Lynx','Marlin','Mongoose','Mustang','Orca','Osprey','Owl','Panther','Pelican','Puma','Raven','Shark','Sparrow','Stag','Tiger','Viper','Wolf'];
  candidate text;
  attempt int := 0;
BEGIN
  LOOP
    candidate := adjectives[1 + floor(random() * array_length(adjectives, 1))::int] || ' ' || nouns[1 + floor(random() * array_length(nouns, 1))::int];
    IF attempt >= 40 THEN
      candidate := candidate || ' ' || (attempt - 38)::text;
    END IF;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM sources WHERE lower(nickname) = lower(candidate));
    attempt := attempt + 1;
  END LOOP;
  RETURN candidate;
END $$;
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "nickname" text;
--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM sources ORDER BY created_at LOOP
    UPDATE sources SET nickname = generate_source_nickname() WHERE id = r.id;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "nickname" SET DEFAULT generate_source_nickname();
--> statement-breakpoint
ALTER TABLE "sources" ALTER COLUMN "nickname" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "sources_nickname_idx" ON "sources" (lower("nickname"));
--> statement-breakpoint
-- Original message text is now admin-only. show_raw_text is no longer read; it stays until no running build selects it.
UPDATE "tier_entitlements" SET "features" = "features" - 'signals.raw_text';

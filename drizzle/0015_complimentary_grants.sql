CREATE TABLE "complimentary_grants" (
  "user_id" text PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "tier" text NOT NULL,
  "granted_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

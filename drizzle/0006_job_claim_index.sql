CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("type","status","run_after","created_at");

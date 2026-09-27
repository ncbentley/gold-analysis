# Decisions

Choices made while building the MVP where the PRD left room for interpretation. Each entry says what was decided and why, so it can be revisited deliberately.

## Stack

- **Next.js App Router, TypeScript, Tailwind v4 and shadcn/ui.** One deployable unit for the public site, member area, admin and API. Server components let entitlement filtering happen before anything reaches the browser.
- **Postgres through Drizzle ORM, with PGlite as the zero-setup default.** PGlite is real Postgres compiled to WASM, so the same schema, SQL and migrations run locally with no Docker. Setting `DATABASE_URL` switches to node-postgres. PGlite is single-process, which is why `pnpm dev` seeds before starting the server and why the job worker runs in-process.
- **Durable jobs in a Postgres table, not a separate queue service.** Jobs have dedupe keys, attempts, exponential backoff, `run_after` and stale-job recovery. That covers the PRD's durable-jobs requirement without adding Redis. The scheduler runs in `instrumentation.ts`; for more than one instance, set `JOBS_WORKER=off` on web nodes and run one worker.
- **Every external integration has a deterministic local fallback:** market data, AI, billing, email and signal sources. The seeded dataset is fully reproducible, and tests need no network.

## Data integrity

- **Raw events are insert-only.** Parsing, correction and review never modify `raw_events`. Each parse is a new `parse_results` row, with `is_current` marking the latest.
- **De-duplication** uses `(source, external_message_id)` when the source supplies an id. Otherwise it uses `(source, sha256(text, payload, published_at))`, so identical text posted at different times still counts as two messages.
- **Signals are versioned.** An admin correction bumps `signals.version` and writes before and after values to the audit log. Outcomes record the `signal_version` and `calc_version` they were computed from.
- **Outcome history is append-only in substance.** A new outcome row is written whenever the classification, rules version or signal version changes. Minute-by-minute progress on an open trade updates the current row in place, which avoids thousands of near-identical rows. Overrides are separate rows with `kind = override` and a mandatory reason, and automatic recalculation never replaces an override unless an admin forces it.
- **Source claims ("TP1 hit", "SL hit") are recorded as evidence, never as results.** Outcomes come only from market data.

## Outcome rules (`outcome-v1`)

The PRD asks for deterministic, documented rules. The choices:

- **Fill.** A market order fills at the open of the first bar at or after the signal time. A long limit or zone fills when the bar low reaches the top of the zone, at `min(open, zoneMax)`; shorts mirror this. This is a conservative "first touch" fill; a mid-zone fill would overstate precision.
- **Targets** are equal-weight partial exits. With three targets, each closes a third. R is the weighted sum.
- **Same-candle stop and target** is `AMBIGUOUS` and shown as "Ambiguous". It is excluded from win rate and average R, and listed separately. One-minute bars cannot say which was touched first, and counting it as either a win or a loss would bias statistics.
- **Fill candle.** A stop touched on the fill candle counts. A target on the fill candle counts only if the candle closes beyond it. This is the conservative reading.
- **Gaps** through the stop exit at the bar open, which can be worse than the stop.
- **Move stop to breakeven or a price** applies from the instruction's publish time. `CLOSE` exits at the next bar's open. `CANCEL` before entry marks the signal `CANCELLED`; after entry it is treated as a close.
- **Expiry.** Unfilled signals expire after 24h unless the source gives an expiry. Open trades time out after 7 days at the open of the first bar past the limit.
- **Breakeven band.** A result within ±0.05R (or ±$0.10 when there is no stop) is classified `BREAKEVEN`.
- **No stop.** R is null and classification uses price PnL. These trades count in win rate but not in R statistics, and the rated sample size shows the difference.
- **MFE and MAE** are measured from entry to exit. On the exit bar, only prices up to the exit price are included.

## Entitlements

- **Features are string keys in a per-tier config** (`tier_entitlements`), editable at `/admin/entitlements`, plus a history window in days (`null` means unlimited). The defaults follow PRD section 5: Silver 30 days, Gold 180 days, Platinum unlimited.
- **Enforcement lives in presenters** (`src/server/presenters.ts`). Locked sections are replaced with `{ locked: true, requiredTier }` before serialization, so pages and the API share one code path and nothing hidden is sent to the client.
- **Advanced filters and search** are ignored server-side for tiers without them. The API reports them in `ignoredFilters`.
- **Admins get every feature.** Visitors with no plan can browse the app shell and see upgrade prompts, but no signal data.
- **CSV export** exists as a feature key but is assigned to no tier, per PRD non-goals.

## Billing

- **Cancelled subscriptions keep access until the end of the paid period.** Plan changes in mock mode take effect immediately.
- **Stripe is optional.** Without `STRIPE_SECRET_KEY`, checkout goes to a local mock page that activates the plan. With Stripe configured, access is granted only by verified webhooks. An hourly reconciliation job refreshes Stripe subscriptions whose period has ended (in case a webhook was missed), and renews or expires mock ones.
- **Prices live in the `plans` table.** The seeded amounts are placeholders.
- **Email verification is required before checkout.** This reduces throwaway accounts on paid plans.

## AI

- **AI output is advisory and replaceable.** Analyses are keyed by input hash and prompt version. Re-running with the same inputs is a no-op unless forced, and a new prompt version creates a new row while keeping history.
- **Prompts carry guardrails:** no predictions, no personalised advice, cite sample sizes, use only supplied facts. Output is validated against a zod schema, and invalid output is rejected rather than stored.
- **The mock analyst** builds its text from the same computed facts, so the UI and the storage path are exercised without an API key.

## Affiliates

- **Affiliate links never touch entitlements.** They are shown in configured placements with a disclosure, counted through a `/go/:slug` redirect, and are never a condition of access.

## Security

- **Sessions** are random 32-byte tokens in an HTTP-only, SameSite=Lax cookie. Only their SHA-256 is stored.
- **Passwords** are hashed with bcrypt.
- **Login, signup and reset** are rate limited per IP and email with an in-memory limiter, which suits a single instance.
- **Admin access** is checked by `requireAdmin()` in the admin layout, in every admin page and in every admin server action. Non-admins get a 404.
- **Ingest** requires a shared token compared in constant time. It is rate limited per source and IP, and rejects bodies over 64 KB and future timestamps.
- **Stripe webhooks** are verified against the raw body.

# Aurum Ledger: Gold Signal Intelligence

A subscription web platform that collects third-party gold (XAU/USD) trading signals, replays each one against one-minute market data with versioned deterministic rules, and shows members how every source has actually performed. It includes source statistics, similar historical trades and AI-written context, with Silver, Gold and Platinum tiers.

This is the MVP described in [`docs/PRD.md`](docs/PRD.md). Design decisions are in [`DECISIONS.md`](DECISIONS.md) and known gaps in [`TODO.md`](TODO.md).

## Quick start

Requirements: Node 20+ and pnpm. No database, Docker or API keys are needed.

```bash
pnpm install
pnpm dev          # seeds on first run (~30s), then serves http://localhost:4317
```

On first run, `pnpm dev` creates an embedded Postgres database (PGlite) in `.data/pglite`. It applies migrations and seeds three sources, 60 days of synthetic XAU/USD minute bars and several hundred signals with computed outcomes, stats and AI analyses. Later runs reuse the data. A background worker keeps market data, mock feeds and open trades moving while the server runs.

| Account | Password | Access |
| --- | --- | --- |
| `admin@example.com` | `admin12345` | Admin console plus everything |
| `platinum@example.com` | `demo12345` | Platinum |
| `gold@example.com` | `demo12345` | Gold |
| `silver@example.com` | `demo12345` | Silver |
| `free@example.com` | `demo12345` | Signed in, no plan |

Billing runs in test mode: choosing a plan on `/pricing` opens a mock checkout that activates the subscription immediately. Verification and password-reset emails are written to a dev mailbox, and a link to them appears on `/check-email`.

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Seed if empty, then run the dev server on port 4317 |
| `pnpm build` / `pnpm start` | Production build and server (port 4317) |
| `pnpm test` | Vitest: outcome engine, parsers, entitlements, pipeline integration |
| `pnpm typecheck` / `pnpm lint` | TypeScript and ESLint |
| `pnpm db:setup` | Apply migrations and seed if the database is empty (`--force` to reseed) |
| `pnpm db:reset` | Delete the local PGlite database and reseed |
| `pnpm db:generate` | Generate a SQL migration from `src/server/db/schema.ts` |

PGlite is single-process: stop the dev server before running `db:setup` or `db:reset` against the same data directory. Set `DATABASE_URL` to use a regular Postgres server instead.

## How it works

```
source message ─▶ raw_events (immutable) ─▶ parse_results (versioned) ─▶ signals + targets + adjustments
                                                     │ low confidence
                                                     ▼
                                               admin review queue
market_bars (1m) ─▶ outcome engine (outcome-v1) ─▶ signal_outcomes (versioned, override-able)
                                                     ▼
                         source_stats (stats-v1) · similar trades · ai_analyses (prompt-versioned)
                                                     ▼
                        entitlement-aware presenters ─▶ pages and /api/v1
```

- **Raw events are never edited.** Every incoming message is stored with its timestamp and content hash, and is de-duplicated by external id or hash. Re-parsing creates a new parse result.
- **Parsing** (`src/server/parsing`) extracts direction, entry (market, limit or zone), stop, targets, signal type and follow-up instructions such as move SL to breakeven, cancel, close, TP hit and SL hit. Anything below 80% confidence, or with a wrong-side stop or an implausible price, goes to `/admin/review` instead of being guessed.
- **Outcomes** (`src/server/outcomes/engine.ts`) are a pure function of the signal, its adjustments and minute bars. The rules are versioned (`outcome-v1`):
  - fills are at the zone edge or the bar open, whichever is better for the trader;
  - targets are equal-weight partial exits;
  - a gap through the stop exits at the open;
  - a stop and a target touched in the same candle is marked ambiguous and never counted as a win;
  - unfilled signals expire after 24h, and trades time out after 7 days.
  
  Results are stored with the rules version and signal version. Admin overrides are separate rows with a reason, and the computed history is kept.
- **Statistics** (`src/server/statistics`) cover win rate, average R, expectancy, recent form, excursion, time-to-target, and breakdowns by hour, weekday, session, direction, signal type and entry type. Every figure carries its sample size.
- **Similar trades** always match on source and direction, then on session, entry type, signal type, weekday and AI pattern tags. The least important criteria are dropped until at least five matches exist. Only trades that closed before the signal count.
- **AI** only explains computed facts. Prompts are versioned, outputs are schema-validated, and analyses are stored separately from outcomes (`ai_analyses`). The AI never changes a result. The default provider is a deterministic mock; set `AI_PROVIDER=openai` to use a real model.
- **Entitlements** (`src/server/entitlements`) are configurable per tier in `/admin/entitlements`: a feature list plus a history window. They are enforced on the server in `src/server/presenters.ts`, so locked fields are never serialized to the browser or the API.
- **Jobs** are durable rows in `jobs`, retried with exponential backoff. An in-process scheduler (`src/instrumentation.ts`) runs them. It handles market data sync every minute, mock feed polling, open-trade recalculation, stats refresh, AI analysis and subscription reconciliation.
- **Audit**: every manual change to a signal, outcome, source, entitlement, affiliate link or subscription is written to `audit_logs` with before and after values and a reason.

## Pages

- **Public:** `/`, `/pricing`, `/login`, `/signup`, `/forgot-password`, `/terms`, `/privacy`
- **Members:** `/dashboard`, `/signals`, `/signals/:id`, `/sources`, `/sources/:slug`, `/billing`, `/account`
- **Admin:** `/admin`, `/admin/review`, `/admin/events`, `/admin/signals`, `/admin/sources`, `/admin/jobs`, `/admin/entitlements`, `/admin/affiliates`, `/admin/audit`

## API

All `/api/v1` read endpoints use the session cookie and return the same entitlement-filtered data as the UI. Locked sections come back as `{ "locked": true, "requiredTier": "gold" }`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/signals` | Filters: `source`, `status` (`OPEN`, `CLOSED` or a status), `direction`, `from`, `to`; Platinum adds `entryType`, `signalType` and `q`. Paging: `limit`, `offset` |
| GET | `/api/v1/signals/:id` | Signal, targets, updates and outcome |
| GET | `/api/v1/signals/:id/similar` | Similar-trade summary and details |
| GET | `/api/v1/signals/:id/analysis` | AI classification, summary and patterns |
| GET | `/api/v1/sources`, `/api/v1/sources/:id`, `/api/v1/sources/:id/stats` | `:id` accepts a slug |
| GET | `/api/v1/me/entitlements` | Tier, features, history window and subscription |
| POST | `/api/v1/ingest/:slug` | Webhook ingestion, authenticated with `x-ingest-token` |
| POST | `/api/billing/checkout`, `/api/billing/portal` | Return a redirect `url` |
| POST | `/api/billing/webhook` | Stripe webhook, signature-verified |

Send a signal to the seeded webhook source:

```bash
curl -X POST http://localhost:4317/api/v1/ingest/midas-webhook \
  -H 'x-ingest-token: dev-ingest-token' -H 'content-type: application/json' \
  -d '{"action":"open","side":"buy","entry":[3400,3402],"sl":3392,"tp":[3412,3425],"ref":"demo-1","message_id":"demo-1"}'
```

Text sources accept `{"text": "XAUUSD BUY 3400-3402 SL 3392 TP1 3412 TP2 3425", "message_id": "..."}`. Sending the same `message_id` again returns `duplicate`.

## Configuration

Every integration has a local fallback, so nothing is required to run locally. See [`.env.example`](.env.example) for the full list. The main switches are:

- `DATABASE_URL`: use Postgres instead of embedded PGlite.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_<TIER>_<PERIOD>`: real Stripe Checkout, Customer Portal and webhooks. Without them, mock checkout is used.
- `MARKET_DATA_PROVIDER=twelvedata` plus `TWELVEDATA_API_KEY`: real XAU/USD minute bars.
- `AI_PROVIDER=openai` plus `OPENAI_API_KEY` (and optionally `OPENAI_BASE_URL` and `AI_MODEL`): real AI analysis.
- `INGEST_TOKEN`: the webhook secret. It is required in production.
- `APP_URL`: the public base URL for emails and Stripe redirects.

## Project layout

```
src/app/(public)      landing, pricing, auth, legal pages
src/app/(app)         member area and /admin (server components + server actions)
src/app/api           REST endpoints, ingest webhook, billing
src/app/actions       server actions (auth, billing, admin)
src/server            domain logic: db, ingestion, parsing, normalization, market-data,
                      outcomes, statistics, similar, ai, entitlements, billing, jobs, audit
scripts/seed.ts       migrations + demo data
drizzle/              SQL migrations
```

## Disclaimer

Signals come from third parties and are shown identically to every member of a tier. Nothing here is personal financial advice, and past results do not predict future performance.

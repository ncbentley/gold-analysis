# Gold Intelligence Gateway: Gold Signal Intelligence

A subscription web platform that captures gold (XAU/USD) trading signals from Telegram channels, replays each one against one-minute market data with versioned deterministic rules, and shows members how every channel has actually performed. It includes source statistics, similar historical trades and AI-written context, with Silver, Gold and Platinum tiers.

This is the MVP described in [`docs/PRD.md`](docs/PRD.md). Design decisions are in [`DECISIONS.md`](DECISIONS.md) and known gaps in [`TODO.md`](TODO.md).

## Quick start

Requirements: Node 20+ and pnpm. No database, Docker or API keys are needed to start.

```bash
git clone <your-repo-url> aurum-ledger && cd aurum-ledger
pnpm install
pnpm dev          # migrates and seeds on first run, then serves http://localhost:4317
```

On first run, `pnpm dev` creates an embedded Postgres database (PGlite) in `.data/pglite`. It applies migrations and seeds the plans, tier entitlements and one admin account. There are no demo sources or signals. Everything shown to members comes from the Telegram channels you connect.

Sign in at `/login` as `admin@example.com` / `admin12345`. Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` before the first run to choose your own.

## Connecting Telegram

Signals are read from Telegram channels through a Telegram **user account**. A bot can only read channels where it is an admin; a user account can read any channel it has joined, including private ones. Use a dedicated account (a spare SIM or eSIM is fine) rather than your personal one. The app only reads; it never posts.

1. On [my.telegram.org/apps](https://my.telegram.org/apps), sign in with that account's phone number and create an application. Any name works. Note the **api_id** and **api_hash**.
2. In the app, open **Admin, then Telegram** (`/admin/telegram`). Enter the api_id, api_hash and phone number, then click **Send login code**.
3. Enter the code Telegram sends to the account. If the account has two-step verification, you are asked for its password next.
4. Join the channel or group in the Telegram app with that account. Then open **Admin, then Sources** (`/admin/sources`). The page lists the channels and groups the account is already in. Choose one, pick a parser and how many recent messages to import (up to 1000), and click **Add source**. The source name is the chat's Telegram title. The row updates immediately: **queued**, then **importing**, then **caught up** or **failed**. Messages show as **queued** on Raw events until a review job reads them. If Telegram is not connected, Sources says so and links back to the Telegram page.

The session is stored encrypted in the database (see `APP_SECRET`), so you only sign in once. New posts arrive live over Telegram's update stream. A catch-up sync also runs every two minutes, so nothing is missed while the server was down: on restart it fetches everything after the last message it saw.

### QA channel

Tick **QA channel (admins only)** when adding your testing channel. QA channels go through the same pipeline (parsing, review, outcome replay, stats, AI), but they are hidden from members, the public landing page and the member API. Admins see them everywhere with a `QA` badge. You can switch a channel between QA and live later under **Admin, then Sources, then Edit**.

A good workflow: create a private channel, join it with the connected account, add it as QA from Sources, post signals in the formats your real channels use, and check how they appear in `/admin/review` and `/admin/signals` before adding real channels.

### How Telegram messages are handled

- Each post becomes an immutable raw event keyed by its Telegram message id, so the live update and the catch-up sync can't create duplicates.
- A reply (for example "move SL to entry" in reply to the signal) is linked to the signal it replies to.
- An **edit** to an earlier post is stored as a separate event and sent to the review queue. It never silently changes a recorded signal. Review it and use **Correct signal** if the change is legitimate.
- Posts that are only a photo keep a placeholder text as evidence. Link previews and empty service messages are skipped.

## Market data

Outcomes are replayed against 1-minute XAU/USD bars. Until you configure a provider, the app uses **synthetic prices**, and the admin overview warns about it. For real results, create a free [Twelve Data](https://twelvedata.com) key and enter it in **Admin, then Settings**. Switching provider clears the stored bars, re-fetches history back to the oldest signal and recalculates every outcome. When a channel's history is imported, missing older bars are backfilled automatically.

## Billing and email

Billing runs in test mode until Stripe keys are set: choosing a plan on `/pricing` opens a mock checkout that activates the subscription immediately. With `RESEND_API_KEY` set, verification and password-reset emails go out through Resend. Until a domain is verified, the sender is `onboarding@resend.dev`, which only delivers to the Resend account email. Without a key, those emails stay in the dev mailbox and a link appears on `/check-email`.

To see what each tier sees without paying, run `SEED_DEMO_USERS=1 pnpm db:reset`. This creates `free@`, `silver@`, `gold@` and `platinum@example.com` with password `demo12345`.

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Seed if empty, then run the dev server on port 4317 |
| `pnpm build` / `pnpm start` | Production build and server (port 4317) |
| `pnpm test` | Vitest: outcome engine, parsers, entitlements, pipeline integration |
| `pnpm typecheck` / `pnpm lint` | TypeScript and ESLint |
| `pnpm db:setup` | Apply migrations and seed if the database is empty (`--force` to reseed) |
| `pnpm db:reset` | Delete the local PGlite database and reseed. This also deletes the stored Telegram session and all channels |
| `pnpm db:generate` | Generate a SQL migration from `src/server/db/schema.ts` |

PGlite is single-process: stop the dev server before running `db:setup` or `db:reset` against the same data directory. Set `DATABASE_URL` to use a regular Postgres server instead.

## How it works

```
Telegram post ─▶ raw_events (immutable) ─▶ parse_results (versioned) ─▶ signals + targets + adjustments
                                                     │ low confidence
                                                     ▼
                                          model review, then admin queue
market_bars (1m) ─▶ outcome engine (outcome-v3) ─▶ signal_outcomes (versioned, override-able)
                                                     ▼
                         source_stats (stats-v1) · similar trades · ai_analyses (prompt-versioned)
                                                     ▼
                        entitlement-aware presenters ─▶ pages and /api/v1
```

- **Telegram** (`src/server/telegram`) uses GramJS (MTProto). It handles sign-in, listing the channels and groups the account has joined, the live update handlers, and a catch-up sync that pages through history by message id.
- **Raw events are never edited.** Every incoming message is stored with its timestamp and content hash, and is de-duplicated by external id or hash. Re-parsing creates a new parse result.
- **Parsing** (`src/server/parsing`) extracts direction, entry (market, limit or zone), stop, targets, signal type and follow-up instructions such as move SL to breakeven, cancel, close, TP hit and SL hit. Anything below 80% confidence, or with a wrong-side stop or an implausible price, is reviewed by the configured chat model first. The model applies, dismisses, or corrects it when it is at least 80% confident. Otherwise the post goes to `/admin/review`. A decision the model is sure about is stored as a text pattern, and the next post with that shape does not call the model again.
- **Outcomes** (`src/server/outcomes/engine.ts`) are a pure function of the signal, its adjustments and minute bars. The rules are versioned (`outcome-v3`):
  - a market quote more than $80 from the bar is not a fill, and the same check keeps a new post off the live list;
  - fills are at the zone edge or the bar open, whichever is better for the trader;
  - targets are equal-weight partial exits;
  - a gap through the stop exits at the open;
  - a stop and a target touched in the same candle is marked ambiguous and never counted as a win;
  - unfilled signals expire after 24h, and trades time out after 7 days.
  
  Results are stored with the rules version and signal version. Admin overrides are separate rows with a reason, and the computed history is kept.
- **Statistics** (`src/server/statistics`) cover win rate, average R, expectancy, recent form, excursion, time-to-target, and breakdowns by hour, weekday, session, direction, signal type and entry type. Every figure carries its sample size.
- **Consensus** (`src/server/consensus`) scores sources that publish the same XAU/USD entry zone inside 30 minutes. Historically accurate sources are the ones `stats-v1` already measures (sample size, win rate, expectancy). Silver sees the trade only. Gold sees the score and how the timing lines up. Platinum also sees how many of the top historical performers are on that zone. Channel names stay on the admin signal page.
- **Source nicknames.** Members see each source by a unique nickname, and admins see the real channel name. Original message text is admin-only. See `DECISIONS.md`.
- **Similar trades** always match on source and direction, then on session, entry type, signal type, weekday and AI pattern tags. The least important criteria are dropped until at least five matches exist. Only trades that closed before the signal count.
- **AI** only explains computed facts. Prompts are versioned, outputs are schema-validated, and analyses are stored separately from outcomes (`ai_analyses`). The AI never changes an outcome. The same provider also reviews posts the parser could not accept: a confident decision is applied, and a low-confidence or unknown decision stays in the human queue. The default provider is a deterministic mock; set `AI_PROVIDER=openai` to use a real model.
- **Entitlements** (`src/server/entitlements`) are configurable per tier in `/admin/entitlements`: a feature list plus a history window. They are enforced on the server in `src/server/presenters.ts`, so locked fields are never serialized to the browser or the API.
- **Jobs** are durable rows in `jobs`, retried with exponential backoff. Docker Compose runs them in a `queue` service beside the app, using the same Postgres, so an app restart does not drop the queue. Each job type has its own lane and concurrency, so message processing is not stuck behind Telegram, market data, or AI. Live posts jump ahead of a history import. Telegram history fetches share a cap of 2. Without Docker, the scheduler in `src/instrumentation.ts` does the same work in-process. It handles market data sync every minute, Telegram catch-up sync every two minutes, market data backfill, open-trade recalculation, stats refresh, AI analysis and subscription reconciliation.
- **Audit**: every manual change to a signal, outcome, source, entitlement, affiliate link or subscription is written to `audit_logs` with before and after values and a reason.

## Pages

- **Public:** `/`, `/pricing`, `/login`, `/signup`, `/forgot-password`, `/terms`, `/privacy`
- **Members:** `/dashboard`, `/signals`, `/signals/:id`, `/sources` (top sources), `/sources/:id`, `/billing`, `/account`
- **Admin:** `/admin`, `/admin/telegram`, `/admin/review`, `/admin/events`, `/admin/signals`, `/admin/sources`, `/admin/jobs`, `/admin/entitlements`, `/admin/affiliates`, `/admin/audit`, `/admin/settings`

## API

All `/api/v1` read endpoints use the session cookie and return the same entitlement-filtered data as the UI. Locked sections come back as `{ "locked": true, "requiredTier": "gold" }`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/signals` | Filters: `source`, `status` (`OPEN`, `CLOSED` or a status), `direction`, `from`, `to`; Platinum adds `entryType`, `signalType` and `q`. Paging: `limit`, `offset` |
| GET | `/api/v1/signals/:id` | Signal, targets, updates, outcome, and consensus gated by tier |
| GET | `/api/v1/signals/:id/similar` | Similar-trade summary and details |
| GET | `/api/v1/signals/:id/analysis` | AI classification, summary and patterns |
| GET | `/api/v1/sources`, `/api/v1/sources/:id`, `/api/v1/sources/:id/stats` | `:id` accepts a slug |
| GET | `/api/v1/me/entitlements` | Tier, features, history window and subscription |
| POST | `/api/v1/ingest/:slug` | Webhook ingestion for non-Telegram sources, authenticated with `x-ingest-token` |
| POST | `/api/billing/checkout`, `/api/billing/portal` | Return a redirect `url` |
| POST | `/api/billing/webhook` | Stripe webhook, signature-verified |

Telegram is the primary source. For other feeds, create a **webhook** source in `/admin/sources` and post to it:

```bash
curl -X POST http://localhost:4317/api/v1/ingest/<source-slug> \
  -H 'x-ingest-token: dev-ingest-token' -H 'content-type: application/json' \
  -d '{"text": "XAUUSD BUY 3400-3402 SL 3392 TP1 3412 TP2 3425", "message_id": "1"}'
```

Sending the same `message_id` again returns `duplicate`. The `json-webhook` parser accepts structured payloads such as `{"action":"open","side":"buy","entry":[3400,3402],"sl":3392,"tp":[3412,3425],"ref":"1"}`.

## Configuration

Every integration has a local fallback, so nothing is required to run locally. Telegram and market data credentials are entered in the admin and stored encrypted. See [`.env.example`](.env.example) for the full list.

Production secrets live in Infisical at `https://vault.mountainwest.digital`, in the Gold Intelligence Gateway project, environment `prod`. The inbound host holds a machine identity in `~/.infisical/auth.env`. Every deploy runs `deploy/render-env.sh`, which writes `deploy/.env` from that environment and then starts Compose. The rendered file is not committed. Changing `APP_SECRET` there makes stored Telegram credentials unreadable.

This repository's `.infisical.json` points the CLI at that project and defaults to the `dev` environment, so commands run from this directory do not select it globally. After `infisical login --domain=https://vault.mountainwest.digital`, local runs that need those secrets use `infisical run --env=dev -- pnpm dev`. `pnpm dev` by itself still uses the local fallbacks.

The main switches are:

- `APP_SECRET`: the key that encrypts credentials stored from the admin. It is required in production. In development one is generated in `.data/app-secret`.
- `DATABASE_URL`: use Postgres instead of embedded PGlite.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_<TIER>_<PERIOD>`: real Stripe Checkout, Customer Portal and webhooks. Without them, mock checkout is used.
- `MARKET_DATA_PROVIDER=twelvedata` plus `TWELVEDATA_API_KEY`: real XAU/USD minute bars, if you prefer env vars to `/admin/settings`.
- `AI_PROVIDER=deepinfra` plus `DEEPINFRA_API_KEY` (cheap Llama 3.1 8B by default), or `cloudflare` plus `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, or `openai` plus `OPENAI_API_KEY`. Optional `AI_MODEL`. The same setting reviews the human queue.
- `INGEST_TOKEN`: the webhook secret. It is required in production if you use webhook sources.
- `APP_URL`: the public base URL for emails and Stripe redirects.

## Deploying

The Telegram client holds a long-lived connection, so deploy it as a **persistent Node process**: a VPS or Docker host. Serverless platforms such as Vercel stop the process between requests, which drops the Telegram connection.

`docker compose up --build` starts Postgres, the app, and the queue service. The queue process is what talks to Telegram and runs jobs. `JOBS_WORKER=off` on the app, so restarting the app leaves queued jobs in Postgres. `APP_SECRET` is generated into a shared volume the first time it is missing and reused after that. It is never rotated. Set `SEED_ADMIN_PASSWORD` (12+ characters) before the first production start. The host must be allowed to make outbound connections to Telegram's servers.

### Production VPS

`deploy/` holds the production stack: Postgres, the app, the queue service, Caddy, and a Cloudflare tunnel. No host port is published. Traffic arrives through the tunnel, goes to Caddy, then to the app. Run `deploy/deploy.sh` from your machine. It rsyncs the working tree to `/srv/gold` on the `inbound-prod` SSH host, renders `deploy/.env` from Infisical, rebuilds the image there, and restarts the stack. `deploy/env.example` lists the keys.

The public site is `https://goldintelligencegateway.com`. Tunnel `gold-intelligence-gateway` dials out from the VPS to Cloudflare and forwards the apex and `www` to `http://caddy:80`. Caddy redirects `www` to the apex. `APP_URL`, `TUNNEL_COMMAND`, `TUNNEL_TOKEN`, and `SITE_ADDRESS` are Infisical values. The host does not listen on ports 80 or 443.

If `TUNNEL_TOKEN` is empty, Compose starts a quick tunnel on a random `trycloudflare.com` address. `deploy.sh` prints that address and writes it back to `APP_URL` in Infisical.

Only one machine may run the queue service against a Telegram session. Running it on two machines at once can get the session revoked.

## Project layout

```
src/app/(public)      landing, pricing, auth, legal pages
src/app/(app)         member area and /admin (server components + server actions)
src/app/api           REST endpoints, ingest webhook, billing
src/app/actions       server actions (auth, billing, admin)
src/server            domain logic: db, telegram, ingestion, parsing, normalization, market-data,
                      outcomes, statistics, similar, ai, entitlements, billing, jobs, settings, audit
scripts/seed.ts       migrations + plans, entitlements and the admin account
drizzle/              SQL migrations
```

## Disclaimer

Signals come from third parties and are shown identically to every member of a tier. Nothing here is personal financial advice, and past results do not predict future performance.

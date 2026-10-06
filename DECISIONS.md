# Decisions

Choices made while building the MVP where the PRD left room for interpretation. Each entry says what was decided and why, so it can be revisited deliberately.

## Stack

- **Next.js App Router, TypeScript, Tailwind v4 and shadcn/ui.** One deployable unit for the public site, member area, admin and API. Server components let entitlement filtering happen before anything reaches the browser.
- **Postgres through Drizzle ORM, with PGlite as the zero-setup default.** PGlite is real Postgres compiled to WASM, so the same schema, SQL and migrations run locally with no Docker. Setting `DATABASE_URL` switches to node-postgres. PGlite is single-process, which is why `pnpm dev` seeds before starting the server and why the job worker runs in-process.
- **Durable jobs in Postgres, processed by an on-device queue service.** Jobs have dedupe keys, attempts, exponential backoff, `run_after` and stale-job recovery. Docker Compose runs that worker next to the app (`queue` in `docker-compose.yml`) against the same Postgres volume. Restarting the app does not drop queued jobs, and it is not a cloud queue. Each job type has its own lane and concurrency (`JOB_CONCURRENCY`), so a Telegram sync, market-data pull, or AI writeup cannot hold a slot that `PROCESS_EVENT` needs. Live Telegram posts are marked `live` and claimed ahead of history imports. Chat-completion lanes add up to the DeepInfra concurrent cap (`DEEPINFRA_CONCURRENCY`, default 200). Signal writeups take every request that message review, source writeups, the board, and the direction note do not reserve. The lanes stay separate, so a writeup backlog cannot occupy a slot a live post needs. Set `JOBS_WORKER=off` on the web app so it only enqueues. Without Docker, the same lanes still start inside the Next.js process. A second OS process is not used for jobs: another MTProto session can invalidate the Telegram auth key.
- **Most integrations have a deterministic local fallback:** market data, AI, billing and email. Tests need no network. Signal sources are the exception: there is no demo or seeded source data, so nothing synthetic can be mistaken for a real track record.
- **Synthetic market data is allowed only as a clearly flagged development fallback.** The admin overview and settings warn while it is active. Switching provider wipes the stored bars and recalculates every outcome, so bars from two providers are never mixed in one evaluation.

## Telegram

- **Telegram is the primary source, read through a user account (MTProto via GramJS), not the Bot API.** Bots only receive channel posts where they are an admin, and most signal channels are run by third parties. A user account can read any channel it has joined, including private channels reached through invite links.
- **Admins add a Telegram source by choosing a chat the account is already in.** Sources lists those channels and groups from the account's dialogs. It does not accept a typed username or invite link, and it does not fill in a name: the source title is the dialog title. Joining happens in the Telegram app. If no account is connected, Sources says so and links to the Telegram sign-in screen.
- **Sign-in happens in the admin, not in environment variables.** The admin enters api_id, api_hash and phone, then the login code and the 2FA password if set. The resulting session string and the API credentials are stored in `app_settings`, encrypted with AES-256-GCM using a key derived from `APP_SECRET`. The api_hash and session never reach the browser.
- **Live updates plus a cursor-based catch-up.** Each channel stores the highest message id seen. Live `NewMessage` events are stored immediately and queued for review, and a `TELEGRAM_SYNC` job every two minutes (and on startup) fetches anything newer than the cursor. The message id is the external id, so the two paths de-duplicate naturally. When a channel is added, the admin chooses how much history to import (0 to 1000 messages). The add returns at once. The source row shows queued, then importing, then caught up or failed. Each fetched message shows as queued until its review job runs.
- **Telegram concurrency is 2.** Telegram does not publish a `messages.getHistory` concurrency. It does publish `FLOOD_WAIT_X`, a single main session unless `tmp_sessions` is greater than 1 (extra sessions can invalidate the auth key), and short cooldown waits of at most 3 seconds on bursts. GramJS only inserts its own delay after 3000 messages. History pages share one cap of 2 in-flight calls on that single session. A live update does not take a slot: the message is already delivered, and storing it must not wait behind a history page. Each history call still fails after 25 seconds.
- **Edits do not silently rewrite a signal.** An edited post is stored as a new raw event (`<id>@edit-<editDate>`, with `edit_of`). Edited comments are ignored. A signal edit is reviewed by the model first. A confident model can correct the original signal or dismiss the edit. A low-confidence or unknown answer stays in the human queue. The edit is not stored as a reusable text pattern.
- **Replies link updates to signals.** A reply's `reply_to_message_id` is how instructions such as "move SL to entry" find their signal. Without a reply, the latest open signal from that channel is used, and the link is flagged as inferred.
- **QA channels are a flag on the source, not a separate environment.** `sources.is_qa` channels run through the full pipeline but are filtered out of every member query, the public landing sample and the member API. That lets the operator test parsing and outcomes on a real Telegram channel in production without touching member data.
- **Interactive Telegram calls are bounded by a timeout.** GramJS can wait indefinitely on a dead socket, so sign-in, channel resolution and history fetches fail after 25 seconds with a clear message instead of blocking the request or the job queue.
- **The app needs a persistent process.** The Telegram connection and job scheduler live in the Node server, which rules out serverless hosting for this MVP.

## Data integrity

- **Raw events are insert-only.** Parsing, correction and review never modify `raw_events`. Each parse is a new `parse_results` row, with `is_current` marking the latest.
- **De-duplication** uses `(source, external_message_id)` when the source supplies an id. Otherwise it uses `(source, sha256(text, payload, published_at))`, so identical text posted at different times still counts as two messages.
- **Signals are versioned.** An admin correction bumps `signals.version` and writes before and after values to the audit log. Outcomes record the `signal_version` and `calc_version` they were computed from.
- **Outcome history is append-only in substance.** A new outcome row is written whenever the classification, rules version or signal version changes. Minute-by-minute progress on an open trade updates the current row in place, which avoids thousands of near-identical rows. Overrides are separate rows with `kind = override` and a mandatory reason, and automatic recalculation never replaces an override unless an admin forces it.
- **Source claims ("TP1 hit", "SL hit") are recorded as evidence, never as results.** Outcomes come only from market data.

## Outcome rules (`outcome-v3`)

The PRD asks for deterministic, documented rules. The choices:

- **Fill.** A market order fills at the open of the first bar at or after the signal time, and only when that bar trades within $80 of the quoted entry. A quote hundreds of dollars from the market is not a fill. A limit or zone fills only when the bar's range overlaps the entry prices: a long fills at `min(open, zoneMax)` when price trades down into the zone, and a short fills at `max(open, zoneMin)` when price trades up into it. Price that misses the zone entirely is not a fill. A gap that opens through the zone fills at the open.
- **Live gate.** Before a new signal is published, the quoted entry is compared with the price at post time. A quote more than $80 away stays in the review queue instead of the live list. When `AI_PROVIDER=openai` and `OPENAI_API_KEY` are set, that review is offered to the model together with the message, the market price, and the last human signal corrections, so a later call can follow decisions already made. The model cannot override the $80 check.
- **Model review before the human queue.** Anything the parser would put in the human queue is sent to a live chat model first. The provider is `AI_PROVIDER`, or whichever key is set: DeepInfra (`DEEPINFRA_API_KEY`, default `meta-llama/Meta-Llama-3.1-8B-Instruct`), Cloudflare Workers AI (`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, default `@cf/meta/llama-3.1-8b-instruct`), then OpenAI (`OPENAI_API_KEY`, default `gpt-4o-mini`). `AI_MODEL` overrides the model. The model answers `apply`, `dismiss`, `correct`, or `unknown`, with a confidence from 0 to 1. The decision is used only when it is not `unknown` and confidence is at least 0.8. Otherwise the post stays in the human queue. A confident decision writes a `parse.learned` row whose `learned` object is the pattern: the lowercased message with each gold price replaced by `{p}`, the role of each price (`entry`, `entryMin`, `entryMax`, `stop`, `target`), and the direction and entry type. The next post with that same shape is applied or dismissed by that rule and does not call the model. Prices the model names must appear in the post, or be a one-digit repair of one that does. Direction still comes from stop and target geometry. A missing direction word is not, by itself, a reason to treat the post as commentary.
- **Targets** are equal-weight partial exits. With three targets, each closes a third. R is the weighted sum.
- **Same-candle stop and target** is `AMBIGUOUS` and shown as "Ambiguous". It is excluded from win rate and average R, and listed separately. One-minute bars cannot say which was touched first, and counting it as either a win or a loss would bias statistics.
- **Fill candle.** A stop touched on the fill candle counts. A target on the fill candle counts only if the candle closes beyond it. This is the conservative reading.
- **Gaps** through the stop exit at the bar open, which can be worse than the stop.
- **Move stop to breakeven or a price** applies from the instruction's publish time. `CLOSE` exits at the next bar's open. `CANCEL` before entry marks the signal `CANCELLED`; after entry it is treated as a close.
- **Expiry.** Unfilled signals expire after 24h unless the source gives an expiry. Open trades time out after 7 days at the open of the first bar past the limit.
- **Breakeven band.** A result within ±0.05R (or ±$0.10 when there is no stop) is classified `BREAKEVEN`.
- **No stop.** R is null and classification uses price PnL. These trades count in win rate but not in R statistics, and the rated sample size shows the difference.
- **MFE and MAE** are measured from entry to exit. On the exit bar, only prices up to the exit price are included.

## Cross-trader consensus (`consensus-v1`)

Computed when a signal is read. It is not stored, and it does not use a hand-picked channel list.

- **Same zone.** A signal stores an inclusive entry interval, `[entryMin, entryMax]`. A market or limit price is a zero-width interval. Two XAU signals share a zone when those intervals overlap, or when the gap between them is at most $2. Overlap is the primary rule, so a published zone matches any entry inside it. The $2 band only joins ranges that do not quite touch. It is tighter than the zones the parser usually records and much tighter than the $80 quote-sanity gate. `XAU/USD` and `XAUUSD` are the same instrument.
- **Window.** Other signals count when their publish time is within 30 minutes of the signal on screen, inclusive. One source casts one vote: the post closest in time. Invalid, cancelled, and manual-review signals are ignored. QA channels are left out of the member score.
- **Historically accurate.** Taken from `stats-v1`, not from a list: at least 8 rated trades, win rate at least 55%, and expectancy above 0. The top historical performers are the sources that clear the sample minimum, ordered by expectancy, then win rate, then sample size. Platinum talks about at most the first 10.
- **Score.** Starts at 50. Each other agreeing source adds 2, or 5 when that source is historically accurate. Each opposing source subtracts 4, or 12 when it is historically accurate. The result is clamped to 0–100. Grades are A ≥ 85, B ≥ 70, C ≥ 50, D ≥ 30, otherwise F. Seven other accurate sources on the same side reach 85, Grade A. Risk is high when two or more accurate sources are the other way, or when the accurate sources on the other side outnumber the accurate sources on this side. Any other disagreement is elevated risk.
- **Tiers.** Silver receives the trade (direction, zone, stop, targets) and neither the score nor the alignment. Gold receives the score, the risk note, and the timing breakdown (counts and minute offsets only). Platinum also receives the anonymized line, for example “7 of our top 10 historical performers are currently aligned on this exact entry zone.” These lines never name a source, not even by nickname, and never include channel titles, Telegram usernames, slugs, or “Source #” labels. Admin signal pages still list the real names for the same cluster. View-as uses these feature keys, so a Silver preview does not receive the score.

## Entitlements

- **Features are string keys in a per-tier config** (`tier_entitlements`), editable at `/admin/entitlements`, plus a history window in days (`null` means unlimited). The defaults follow PRD section 5: Silver 30 days, Gold 180 days, Platinum unlimited.
- **Enforcement lives in presenters** (`src/server/presenters.ts`). Locked sections are replaced with `{ locked: true, requiredTier }` before serialization, so pages and the API share one code path and nothing hidden is sent to the client.
- **Advanced filters and search** are ignored server-side for tiers without them. The API reports them in `ignoredFilters`.
- **Admins get every feature.** Visitors with no plan can browse the app shell and see upgrade prompts, but no signal data. An admin can preview Silver, Gold, Platinum, or no plan from the member shell. That choice is a cookie honored only for an admin, and admin pages keep using the real account.
- **CSV export** exists as a feature key but is assigned to no tier, per PRD non-goals.

## Source identity

- **Members see each source by a nickname, admins by its real name.** Every source has a nickname such as “Amber Falcon”, unique ignoring case. The database generates one (`generate_source_nickname()`, the column default) for any source added without one, and the migration gave one to every existing source. Admins can change it on the Sources page. Clearing the field generates a new one, and a nickname that contains the channel's name, slug or Telegram username is refused. Signal lists, signal pages, top sources, the source filter and the member API all use the nickname. An admin sees the real name in the same places. An admin previewing a plan sees what that plan's members see.
- **Top sources and source pages.** `/sources` ranks up to 50 sources that have at least 20 closed trades, by expectancy. Each name links to `/sources/:id`, which shows the sample size, the tier-gated statistics and recent signals. The id in the URL is the internal id, never the slug. A source with no closed trades says so instead of showing empty figures.
- **Cached statistics are checked on read.** The refresh job only runs when an outcome's version changes, so a new, invalidated or just-closed signal could leave `source_stats` behind. On every read, the source's live signal count, closed-trade count and win count are compared with the cached row, and the row is recomputed if any differ.
- **Original message text is admin-only.** Posts often carry the channel's name, links or signature, which would undo the nickname. Members on every plan get the parsed signal and no post text, so the `signals.raw_text` feature and the per-source “show original text” switch were removed. Admins still see the unredacted text on the member signal page and in the admin tools.

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

## Production secrets and hosting

- **Production secrets live in Infisical**, the self-hosted instance at `https://vault.mountainwest.digital`, project Gold Intelligence Gateway, environment `prod`. The VPS machine identity in `~/.infisical/auth.env` renders them to `deploy/.env` on each deploy. That file is not committed. The workstation does not store this project as its global Infisical login. `.infisical.json` selects the project only when the CLI is run from this repository, and its default environment is `dev`.
- **The site is published through a named Cloudflare Tunnel** (`gold-intelligence-gateway`) to `https://goldintelligencegateway.com`. `cloudflared` makes the outbound connection. Caddy is the origin on the Docker network at `http://caddy:80`. The VPS does not publish ports 80 or 443. `www` redirects to the apex.
- **`APP_SECRET` is stable.** It encrypts the Telegram session and admin-entered API keys. Rotating it requires signing in to Telegram again.

## Security

- **Sessions** are random 32-byte tokens in an HTTP-only, SameSite=Lax cookie. Only their SHA-256 is stored.
- **Passwords** are hashed with bcrypt.
- **Login, signup and reset** are rate limited per IP and email with an in-memory limiter, which suits a single instance.
- **Admin access** is checked by `requireAdmin()` in the admin layout, in every admin page and in every admin server action. Non-admins get a 404.
- **Ingest** requires a shared token compared in constant time. It is rate limited per source and IP, and rejects bodies over 64 KB and future timestamps.
- **Stripe webhooks** are verified against the raw body.

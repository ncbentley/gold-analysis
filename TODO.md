# TODO

Known gaps and next steps after the MVP, roughly in priority order.

## Before launch

- [ ] **Legal review** of `/terms` and `/privacy`; both are working templates.
- [ ] **Real email delivery.** `sendEmail` writes to the `outbound_emails` table (the dev mailbox). Connect a provider such as Resend or Postmark and disable the mailbox link in production.
- [ ] **Stripe setup.** Create products and prices, set `STRIPE_PRICE_*`, register the webhook endpoint `/api/billing/webhook` for `checkout.session.completed` and `customer.subscription.*`, and configure the Customer Portal. Confirm the real prices in the `plans` table.
- [ ] **Production database.** Point `DATABASE_URL` at managed Postgres and apply the migrations in `drizzle/`. Add backups.
- [ ] **Market data licence** check for the chosen provider, or add another adapter in `src/server/market-data/`.
- [ ] **Source permissions.** Confirm that each tracked channel allows redistribution of its text; otherwise set `showRawText=false` on that source.
- [ ] **Set `APP_SECRET`** in production before signing in to Telegram, and keep it stable; rotating it requires signing in again.
- [ ] **Connect real market data** in `/admin/settings` before members see results. Synthetic prices are for development only.
- [ ] **Telegram account hygiene.** Use a dedicated account, enable two-step verification on it, and keep it in only the channels you track.
- [ ] **Shared rate limiting.** Move to Redis or a platform limiter before running more than one instance.
- [x] **Dedicated worker.** `docker compose` runs the `queue` service and sets `JOBS_WORKER=off` on the app. Jobs stay in Postgres.

## Paid upgrades

Roadmap for what a higher tier is actually paying for. Data depth may not be the scarce thing: there can be too many signals at once for extra history or extra fields to matter. The differentiator is choosing which signals are worth acting on, then being told, then optionally having them acted on.

- [ ] **Filterable signals.** Let a member ask only for signals of a certain quality (for example consensus grade, source track record, or risk), instead of the full firehose.
- [ ] **Push notifications for those filters.** Notify when a signal matches the quality filter above, not on every new post.
- [ ] **Automation for those filters.** Automatic execution of signals that pass the same quality filter. Trade execution is an MVP non-goal; this is the later paid step after filtering and alerts.
- [ ] **Consider opening all data to every tier.** If volume is high enough that nobody can use every signal, gating history and fields by tier may not be the product. Revisit Silver / Gold / Platinum so the paid line is the filter, the notification, and the automation, and the underlying data is available to all tiers.

## Product

- [ ] Telegram albums: a multi-photo post arrives as several messages sharing a `groupedId`. Today only the one carrying the caption produces a signal; the others are stored as captionless evidence.
- [ ] Image signals: some channels post the trade as a screenshot. Add OCR or a vision model that produces text for the parser, flagged for review.
- [ ] Alert the admin (email or Telegram) when the Telegram session is revoked or a channel sync keeps failing.
- [ ] Discord and email-to-webhook adapters that post to `/api/v1/ingest/:slug`.
- [ ] Notifications (email or push) for new signals and status changes. This is out of scope in the PRD but the most requested next feature.
- [ ] Per-source parser configuration, such as custom aliases and label patterns, editable in the admin.
- [ ] Better ambiguous-candle resolution using tick or 1-second data when available, as an optional rules version `outcome-v2`.
- [ ] Charts with the full candle series and trade markers on the signal page; the current chart is a lightweight SVG line.
- [ ] Account deletion and data export flows for privacy requests.
- [ ] Admin views for users and subscriptions, including manual comps and refunds.
- [ ] A way to show INVALID signals in the admin signal list; today they are hidden there as well as from members.

## Engineering

- [ ] End-to-end tests (Playwright) for signup, checkout, gated pages and admin review.
- [ ] Load-test the statistics refresh and similar-trade queries with around 100k signals; move them to SQL aggregates if needed.
- [ ] Structured logging and error reporting (Sentry or similar) for job failures and webhook errors.
- [ ] API keys for programmatic access; the API is session-cookie only today.

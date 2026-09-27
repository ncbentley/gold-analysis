# TODO

Known gaps and next steps after the MVP, roughly in priority order.

## Before launch

- [ ] **Legal review** of `/terms` and `/privacy`; both are working templates.
- [ ] **Real email delivery.** `sendEmail` writes to the `outbound_emails` table (the dev mailbox). Connect a provider such as Resend or Postmark and disable the mailbox link in production.
- [ ] **Stripe setup.** Create products and prices, set `STRIPE_PRICE_*`, register the webhook endpoint `/api/billing/webhook` for `checkout.session.completed` and `customer.subscription.*`, and configure the Customer Portal. Confirm the real prices in the `plans` table.
- [ ] **Production database.** Point `DATABASE_URL` at managed Postgres and apply the migrations in `drizzle/`. Add backups.
- [ ] **Market data licence** check for the chosen provider, and configure `MARKET_DATA_PROVIDER=twelvedata` or add another adapter in `src/server/market-data/`.
- [ ] **Source permissions.** Confirm that each tracked source allows redistribution of its text; otherwise set `showRawText=false` on that source.
- [ ] **Shared rate limiting.** Move to Redis or a platform limiter before running more than one instance.
- [ ] **Dedicated worker.** Run a separate worker process and set `JOBS_WORKER=off` on web instances.

## Product

- [ ] Real source connectors: Telegram, Discord and email-to-webhook adapters that post to `/api/v1/ingest/:slug`.
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

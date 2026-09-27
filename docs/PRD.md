# Product Requirements Document: Gold Signal Intelligence Platform

**Version:** 0.1 MVP  
**Date:** 2026-09-26  
**Status:** Build-ready draft  

## 1. Product Summary

Build a subscription web platform that aggregates third-party gold trading signals, stores each signal as structured historical data, measures each signal against market outcomes, and adds deterministic statistics plus AI-generated analysis.

The platform does not personalize trade advice. Every member in the same subscription tier receives the same information. The system does not size positions, manage accounts, execute trades, or alter analysis based on a user's finances or portfolio.

The initial product focuses only on gold signals. The canonical instrument is XAU/USD unless a source explicitly uses another gold instrument.

## 2. Product Thesis

Raw trading signals are easy to publish and easy to copy. Historical source performance and structured signal intelligence are harder to reproduce.

The product moat should become the historical database. Over time, the platform should answer questions such as:

- How has this source performed across all recorded trades?
- How has this source performed recently?
- Which signal types perform best for this source?
- At what times does this source perform best or worst?
- How did similar historical signals perform?
- What was the maximum favorable and adverse excursion after entry?
- How long did successful trades take to reach each target?
- What patterns appear across hundreds or thousands of signals?

## 3. Goals

### 3.1 MVP Goals

1. Ingest gold signals from one or more sources.
2. Normalize each signal into one internal schema.
3. Preserve the original raw signal permanently.
4. Track edits, cancellations, and source updates.
5. Store enough gold market data to evaluate each signal.
6. Calculate objective trade outcomes with deterministic code.
7. Produce AI classifications and summaries from stored facts.
8. Expose different data depths through Silver, Gold, and Platinum memberships.
9. Support weekly, monthly, and annual billing.
10. Provide an admin interface for source and signal management.
11. Provide simple broker affiliate links without benefits tied to account creation or trade volume.

### 3.2 Non-Goals for MVP

Do not build these features in the first release:

- Trade execution
- Copy trading
- Brokerage account connections
- Position sizing
- Personalized trade advice
- User portfolio analysis
- Trade recommendations based on account size
- Broker-volume membership rewards
- Mobile applications
- Social feeds or user chat
- Complex source ranking competitions
- Automated strategy generation
- Multi-asset support

## 4. Users

### 4.1 Visitor

A visitor can view the landing page, pricing, product explanation, sample historical data, and broker affiliate links.

### 4.2 Silver Member

A Silver member receives the core trade signal and source information.

### 4.3 Gold Member

A Gold member receives Silver data plus useful source history and signal statistics.

### 4.4 Platinum Member

A Platinum member receives all available historical data, deeper filters, and AI analysis.

### 4.5 Administrator

An administrator can manage sources, signals, parsing results, memberships, data corrections, and AI processing.

## 5. Membership Model

The exact feature split can change after usage data becomes available. Build permissions as configurable entitlements rather than hard-coded UI checks.

### 5.1 Silver

Silver should expose:

- Signal source
- Instrument
- Direction
- Entry or entry zone
- Stop loss
- Targets
- Signal timestamp
- Current signal status
- Original source text where permitted
- Basic final result after the trade closes

### 5.2 Gold

Gold should include Silver plus:

- Source lifetime trade count
- Source win rate
- Source average R result
- Source expectancy
- Recent source performance
- Performance by time of day
- Performance by signal direction
- Performance by signal type when available
- Similar historical trade summary
- MFE and MAE summaries

### 5.3 Platinum

Platinum should include Gold plus:

- Full source historical dataset
- Advanced filters
- AI setup classification
- AI context summary
- AI pattern analysis
- Similar-trade details
- Source performance by additional dimensions
- Historical signal search
- Detailed MFE and MAE data
- Time-to-target statistics
- Download or export access if enabled later

## 6. Billing

Support three billing periods for each membership tier:

- Weekly
- Monthly
- Annual

Initial pricing logic:

- Monthly price should be approximately 2x the weekly price.
- Annual price should be approximately 10x the monthly price.
- Annual therefore gives approximately two months free versus twelve monthly payments.

Do not hard-code exact prices into business logic. Store prices and provider price IDs in configuration.

Recommended initial placeholders:

| Tier | Weekly | Monthly | Annual |
|---|---:|---:|---:|
| Silver | $15 | $29 | $290 |
| Gold | $30 | $59 | $590 |
| Platinum | $50 | $99 | $990 |

Use Stripe or an equivalent subscription provider. The MVP needs checkout, subscription status, cancellation, renewal status, and entitlement updates.

## 7. Core Signal Data Model

Preserve raw facts separately from derived facts.

### 7.1 Source

Fields should include:

- `id`
- `name`
- `slug`
- `source_type`
- `source_url`
- `active`
- `timezone`
- `parser_type`
- `created_at`
- `updated_at`

### 7.2 Raw Signal Event

Every source event should be immutable.

Fields should include:

- `id`
- `source_id`
- `external_message_id`
- `raw_text`
- `raw_payload_json`
- `published_at`
- `received_at`
- `event_type`
- `content_hash`

Possible `event_type` values:

- NEW_SIGNAL
- UPDATE
- CANCEL
- TARGET_HIT
- STOP_HIT
- CLOSE
- COMMENT

### 7.3 Normalized Signal

Fields should include:

- `id`
- `source_id`
- `instrument`
- `direction`
- `entry_type`
- `entry_min`
- `entry_max`
- `stop_loss`
- `status`
- `signal_time`
- `expiry_time`
- `closed_at`
- `source_confidence_text`
- `parser_confidence`
- `created_at`
- `updated_at`

Expected direction values:

- LONG
- SHORT

Expected status values:

- PENDING
- ACTIVE
- PARTIAL
- WON
- LOST
- BREAKEVEN
- CANCELLED
- EXPIRED
- INVALID
- MANUAL_REVIEW

### 7.4 Signal Target

Store targets as ordered child records.

Fields should include:

- `id`
- `signal_id`
- `target_index`
- `price`
- `hit_at`
- `status`

### 7.5 Market Data

Store enough XAU/USD data to replay and evaluate trades.

MVP requirement:

- 1-minute OHLC bars
- UTC timestamps
- source/provider metadata

Fields should include:

- `instrument`
- `timestamp`
- `open`
- `high`
- `low`
- `close`
- `volume` when available
- `provider`

Design the schema so finer data can replace or supplement one-minute bars later.

### 7.6 Deterministic Signal Outcome

Calculate these values in code, not with an LLM:

- Was the entry reached?
- Entry time
- Which targets were reached?
- Stop hit time
- Final classification
- R result
- MFE
- MAE
- Time to each target
- Total trade duration
- Best price after entry
- Worst price after entry

Store calculation version information so historical outcomes can be recalculated later.

### 7.7 AI Analysis

Store AI output separately from raw and deterministic data.

Fields should include:

- `id`
- `signal_id`
- `analysis_type`
- `model`
- `prompt_version`
- `input_hash`
- `output_json`
- `created_at`

AI output can include:

- Setup classification
- Short plain-language summary
- Pattern tags
- Market context tags
- Similar historical pattern explanation
- Notable strengths or weaknesses in the source history

Never let AI overwrite raw signal data or deterministic outcome fields.

## 8. Signal Processing Pipeline

The system should use this pipeline:

1. Receive a raw source event.
2. Store the event without modification.
3. Detect duplicates with source identifiers and content hashes.
4. Parse the event into a normalized candidate signal.
5. Validate required fields.
6. Assign a parser confidence score.
7. Send uncertain parses to manual review.
8. Create or update the normalized signal.
9. Track market prices after the signal becomes actionable.
10. Calculate deterministic trade metrics.
11. Run AI classification after enough facts exist.
12. Update source-level aggregate statistics.
13. Expose fields according to the user's entitlements.

## 9. Parsing Requirements

Source formats will vary. The parser layer must be modular.

A parser should extract when available:

- Instrument
- Direction
- Entry price or zone
- Stop loss
- One or more targets
- Signal timestamp
- Explicit cancellation
- Move-stop instructions
- Close instructions
- Source-specific identifiers

The parser should return structured output plus confidence per field.

Do not silently invent missing prices.

When a required field is ambiguous, mark the signal for manual review.

The system should retain the raw source event even when parsing fails.

## 10. Outcome Rules

Trade evaluation rules must be explicit and versioned.

The first implementation should define:

- How an entry zone counts as filled
- What happens when both a stop and target appear inside the same one-minute candle
- How partial targets affect R
- How moved stops are handled
- How cancellations are handled
- How signals without stops are handled
- How signals without targets are handled
- How expired signals are handled
- How source edits change the active trade

If one-minute data cannot determine event order inside a candle, mark the outcome as ambiguous instead of choosing the favorable result.

Create an admin override with an audit record for exceptional cases.

## 11. Historical Statistics

Calculate source statistics from deterministic results.

MVP source statistics should include:

- Total signals
- Entered signals
- Win count
- Loss count
- Breakeven count
- Win rate
- Average R
- Median R
- Expectancy
- Average MFE
- Average MAE
- Average duration
- Recent 10-trade performance
- Recent 30-trade performance
- Long versus short performance
- Hour-of-day performance
- Day-of-week performance

The application should always display the sample size next to a statistic where practical.

## 12. Similar Trade Engine

The MVP can use a simple deterministic filter instead of embeddings.

A similar trade can match on dimensions such as:

- Source
- Direction
- Signal type
- Hour bucket
- Day of week
- Entry pattern tags

Platinum can later use vector search or learned similarity.

The UI must show the number of matched historical trades.

## 13. AI Requirements

AI should enrich stored data. AI should not become the system of record.

### 13.1 Allowed MVP AI Tasks

- Parse unstructured source messages
- Classify setup type
- Generate concise historical summaries
- Identify recurring patterns in structured data
- Create tags
- Explain deterministic statistics in plain language

### 13.2 Prohibited MVP AI Tasks

- Personalized position sizing
- Personalized risk advice
- Trade execution
- Portfolio allocation
- Changing a signal based on a member's account
- Inventing historical metrics
- Calculating P&L when code can calculate it

### 13.3 AI Output Rules

Every AI analysis must reference structured facts supplied to the model.

Use structured JSON output where possible.

Store:

- Model name
- Prompt version
- Input hash
- Output
- Processing timestamp

The system must support re-analysis when prompts or models change.

## 14. User Experience

### 14.1 Public Landing Page

The landing page should explain:

- What the product collects
- What historical analysis it provides
- Membership differences
- Sample signal data
- Sample source history
- Pricing
- Account creation

Do not make profit guarantees.

### 14.2 Dashboard

The member dashboard should show:

- Active signals
- Recent closed signals
- Source name
- Direction
- Entry
- Stop
- Targets
- Signal age
- Status
- Tier-allowed historical information

Users should be able to filter by:

- Source
- Status
- Date
- Direction

### 14.3 Signal Detail Page

The signal detail page should contain sections for:

1. Signal
2. Source
3. Outcome
4. Historical context
5. Similar trades
6. AI analysis

Hide or lock sections based on entitlements.

Show an upgrade call to action for locked information.

### 14.4 Source Page

Each source should have a profile with:

- Name
- Total tracked signals
- High-level historical performance
- Recent signals
- Tier-dependent advanced statistics

## 15. Admin Interface

The MVP admin interface should support:

- Create, edit, disable, and inspect sources
- Review raw events
- Review failed parsing
- Correct normalized signals
- Re-run parsing
- Re-run outcome calculation
- Re-run AI analysis
- View calculation versions
- Add manual outcome overrides
- View audit history
- Manage broker affiliate URLs

Every manual correction should preserve the previous value in an audit log.

## 16. Affiliate Links

Affiliate support is intentionally simple in the MVP.

Requirements:

- Admin can create named affiliate links.
- Admin can set destination URL and disclosure text.
- Links can appear on configured public or member pages.
- Clicks can be counted internally.
- The system must not change membership access based on broker signup.
- The system must not change membership access based on deposit size.
- The system must not change membership access based on trading volume.

Do not build broker APIs or conversion callbacks in the MVP.

## 17. Authentication and Authorization

Support:

- Email/password or magic-link authentication
- Verified email
- Password reset if passwords are used
- Member role
- Admin role
- Subscription entitlement checks on the server

Never rely only on hidden UI elements for paid access control.

The API must enforce entitlements.

## 18. Suggested Technical Architecture

The implementation can vary. Prefer a simple monolith for the MVP.

Suggested stack:

- Front end: Next.js with TypeScript
- API: Next.js server routes or a separate TypeScript service
- Database: PostgreSQL
- ORM: Prisma or Drizzle
- Queue/jobs: lightweight durable job queue
- Cache: Redis only if needed
- Auth: Auth.js, Clerk, Supabase Auth, or equivalent
- Billing: Stripe
- AI: provider abstraction with structured outputs
- Market data: provider adapter interface
- Hosting: standard managed cloud platform

Do not introduce microservices unless one component has a real scaling reason.

## 19. Required Service Boundaries

Even inside a monolith, separate these modules:

- Source ingestion
- Signal parsing
- Signal normalization
- Market data
- Outcome calculation
- Statistics
- AI analysis
- Billing
- Entitlements
- Affiliates
- Admin/audit

Each module should have clear interfaces so it can move to a separate service later.

## 20. Background Jobs

Use durable background jobs for:

- Source ingestion polling where applicable
- Market data updates
- Signal outcome recalculation
- Aggregate statistics refresh
- AI analysis
- Subscription reconciliation

Jobs must be idempotent where possible.

Record job failures and retries.

## 21. Auditability

The platform's credibility depends on preserving history.

Never silently rewrite historical signals.

Record:

- Original source event
- Every source update
- Every normalized-data edit
- Every manual admin edit
- Every outcome-calculation version
- Every AI-analysis version

A future user-facing feature may expose a public edit history for signals.

## 22. Security and Privacy

MVP requirements:

- Hash passwords through the authentication provider
- Keep provider API keys server-side
- Keep billing secrets server-side
- Validate all admin access on the server
- Rate-limit authentication and public APIs
- Sanitize untrusted source content before display
- Store minimum user data
- Do not collect brokerage credentials
- Do not collect account balances
- Do not collect portfolio positions

## 23. Analytics

Track product events such as:

- Account created
- Checkout started
- Subscription started
- Subscription cancelled
- Signal viewed
- Source viewed
- Locked section viewed
- Upgrade clicked
- Affiliate link clicked

Do not let product analytics block the MVP launch.

## 24. MVP Pages

Public:

- `/`
- `/pricing`
- `/login`
- `/signup`
- `/terms`
- `/privacy`

Member:

- `/dashboard`
- `/signals`
- `/signals/:id`
- `/sources`
- `/sources/:id`
- `/account`
- `/billing`

Admin:

- `/admin`
- `/admin/sources`
- `/admin/events`
- `/admin/signals`
- `/admin/review`
- `/admin/jobs`
- `/admin/affiliates`

## 25. MVP API Surface

Exact naming may vary.

Minimum useful endpoints or server actions:

- Create/read/update sources
- Create raw source events
- Parse a raw event
- Read normalized signals
- Read signal detail
- Read source statistics
- Read similar trades
- Read AI analysis
- Read membership entitlements
- Start billing checkout
- Open billing portal
- Handle billing webhooks
- Admin correction action
- Admin reprocess action

## 26. Acceptance Criteria

The MVP is ready for private beta when all conditions below are true.

### Signal ingestion

- A configured source can create a raw signal event.
- The system retains the original event permanently.
- Duplicate events do not create duplicate signals.

### Parsing

- The parser can extract direction, entry, stop, and targets from supported formats.
- Low-confidence parses enter manual review.
- An administrator can correct a parse.

### Market evaluation

- The system stores XAU/USD market bars.
- The system determines whether a signal entered.
- The system determines target and stop events when the data permits it.
- Ambiguous one-minute bars remain explicitly ambiguous.
- The system calculates MFE and MAE.

### Historical data

- Each source page shows deterministic aggregate statistics.
- Statistics update when a trade closes or an outcome changes.
- Sample size is available for historical metrics.

### AI

- The system can create a structured AI classification for a signal.
- AI data remains separate from deterministic metrics.
- An administrator can re-run analysis with a newer prompt version.

### Membership

- Silver, Gold, and Platinum subscriptions can be purchased.
- Weekly, monthly, and annual billing can be configured.
- Server-side authorization prevents lower tiers from reading higher-tier fields.
- Cancellation updates access according to the configured billing rules.

### Administration

- An administrator can inspect raw events and normalized signals.
- An administrator can correct a signal without deleting its history.
- Audit records show manual changes.

## 27. Recommended Build Order

### Phase 1: Foundation

1. Create the application and database.
2. Implement authentication.
3. Implement users, sources, raw events, normalized signals, and targets.
4. Create the admin source and signal pages.

### Phase 2: Ingestion and parsing

1. Add the first source adapter.
2. Preserve raw events.
3. Build parsing and normalization.
4. Add manual review.

### Phase 3: Market outcomes

1. Add the XAU/USD data provider adapter.
2. Store minute bars.
3. Build the deterministic trade replay engine.
4. Calculate MFE, MAE, R, and timestamps.

### Phase 4: Historical intelligence

1. Build source aggregates.
2. Build recent-performance metrics.
3. Build time and direction breakdowns.
4. Add basic similar-trade matching.

### Phase 5: AI

1. Add structured setup classification.
2. Add signal summaries.
3. Add historical pattern summaries.
4. Add prompt and model version tracking.

### Phase 6: Membership and launch

1. Add Stripe.
2. Add configurable entitlements.
3. Build pricing and checkout.
4. Add locked premium sections.
5. Add affiliate links.
6. Add product analytics.

## 28. Cursor Cloud Agent Instructions

The agent should treat this PRD as the source of truth for the MVP.

The agent should prefer simple, maintainable implementation choices.

The agent should not add features outside the MVP without a clear dependency.

The agent should create database migrations and seed data.

The agent should include automated tests for deterministic trade calculations and entitlement enforcement.

The agent should create clear environment-variable documentation.

The agent should create a local development path that does not require production credentials.

The agent should use mock source events, mock market data, mock AI responses, and billing test mode for local development.

The agent should maintain a `DECISIONS.md` file for important choices that this PRD does not settle.

The agent should maintain a `TODO.md` file for deferred items.

## 29. Open Product Decisions

These items do not need to block the first code scaffold:

- Product name and branding
- Exact subscription prices
- First source integration
- Exact XAU/USD market data vendor
- Entry-zone fill policy
- Multi-target R calculation policy
- How long an unfilled signal remains valid
- Exact AI provider and model
- Whether users can download Platinum data
- Whether closed raw signal text can be publicly shown
- Geographic availability
- Final legal copy and disclosures

## 30. Core Design Principle

Treat raw signals as immutable evidence.

Treat deterministic calculations as versioned facts derived from evidence.

Treat AI output as replaceable analysis derived from those facts.

This separation is the central technical requirement for the product.

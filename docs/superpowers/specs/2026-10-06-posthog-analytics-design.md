# PostHog product analytics

## Goal

Answer founder and marketer questions in PostHog Cloud: where revenue came from, which campaigns and landing pages produce signups and subscriptions, and how people move through the product. Postgres remains the record of product events and attribution touches. The browser never loads a PostHog script. Advertising networks receive nothing.

Payments are a separate project. The provider will be Authorize.net. This work adds a single revenue function that billing can call when a charge succeeds. It does not integrate Authorize.net, and it does not add Stripe invoice handling.

## Decisions

- PostHog Cloud is the place to explore. The admin page keeps its 7-day event counts.
- Capture is server-side. Visitor and attribution cookies stay HTTP-only.
- Anonymous activity uses the existing visitor id (`gsi_vid`). Once an account exists, that visitor is merged onto the user id, and later signed-in events use the user id.
- First touch is fixed the first time it is stored. Latest touch updates when attribution already says it should.
- `subscription_started` and `subscription_cancelled` stay conversion events and carry no money. Revenue is only the `invoice_paid` event.
- With `POSTHOG_API_KEY` unset, forwarding is skipped. Local development and tests keep writing to Postgres.
- Rows already in `analytics_events` are not imported.
- Session replay stays off.

## Architecture

The proxy and `persistIncomingTouch` keep doing what they do today. A new PostHog client is the only module that talks to PostHog. `trackEvent` writes Postgres, then forwards. A small client component reports path changes to our own route, which sends `$pageview`. `identifyAttribution` links the visitor to the account and sets person properties. `trackRevenue` sends money.

The privacy policy gains one processor sentence for PostHog. The cookie section stays as written.

## Components

### PostHog client

`src/server/analytics/posthog.ts` reads `POSTHOG_API_KEY` and `POSTHOG_HOST`. When the host is unset and a key is present, the host is `https://us.i.posthog.com`. When the key is unset, every call returns without opening a connection.

It exposes:

- `capturePostHog(distinctId, event, properties)`
- `aliasVisitor(userId, visitorId)` so events already sent with the visitor id become part of the user, and the user id is the distinct id from then on
- `setPerson(userId, setOnce, set)` for first-touch and latest-touch person properties

The client flushes about every 10 seconds and on process shutdown. Failures are caught by the callers described below.

### Product events

`trackEvent` stays the only product-event API. Callers do not change. After the Postgres insert succeeds, it forwards the same event name. PostHog properties are the caller props plus the last-touch fields below. The nested `attribution` object stored in Postgres is not copied to PostHog. Caller props keep their own names. `signal_viewed` already uses `source` for the signal slug, so the campaign channel is sent as `attr_source` and the matching `attr_*` names, and those keys are not taken from caller props.

When the caller passed a user id, that id is the distinct id. Otherwise the distinct id is the visitor id on the attribution snapshot. When both are missing, the Postgres row is kept and nothing is sent.

### Last-touch event fields

Taken from the last touch via the existing `channelOf` helper, plus the raw allowlisted params on that touch:

- `attr_source`, `attr_medium`, `attr_campaign`
- `attr_landing`, `attr_referrer`
- `visitor_id`
- each allowlisted param key already accepted by attribution (`utm_*`, click ids such as `gclid` and `fbclid`, and the existing aliases)

Person properties stay `initial_source` and `latest_source` (and the matching medium, campaign, landing, and referrer names). Those live on the person, not in the event props bag.

### Identity

`identifyAttribution` already runs on signup, login, and when a signed-in visitor arrives with a new touch. On each of those runs, after the account row is stored:

- Alias the visitor id onto the user id.
- `$set_once`: `initial_source`, `initial_medium`, `initial_campaign`, `initial_landing`, `initial_referrer` from the account's first touch. Sending these again does not replace them.
- `$set`: `latest_source`, `latest_medium`, `latest_campaign`, `latest_landing`, `latest_referrer` from the last touch, and `email`.

Channel values use `channelOf`. Landing and referrer come from the touch itself.

### Page views

A client component in the root layout sends the pathname to `POST /api/analytics/page` as `{ "pathname": "..." }` when the pathname changes. It remembers the last pathname it sent and skips a repeat, including a repeat from the development double render.

The route reads the HTTP-only cookies. It sends `$pageview` with `$pathname` and `$current_url` both set to that pathname, plus the same last-touch fields as any other event. The distinct id is the signed-in user id when there is one, otherwise the visitor id.

The route returns 204 for an accepted send and for a dropped request. It drops the request when:

- the visitor cookie is missing
- `pathname` is not a string that starts with `/`
- `pathname` contains `?`, `\`, or `://`
- `pathname` is `/admin`, `/api`, or starts with `/admin/` or `/api/`

### Revenue

`trackRevenue(userId, { amountCents, currency, tier, period, provider })` sends `invoice_paid`. Properties:

- `revenue`: `amountCents / 100` (dollars)
- `currency`: the plan currency, uppercased
- `tier`, `period`, `provider`
- the same last-touch fields as any other event

The distinct id is the user id. PostHog breaks revenue down by the person's first-touch properties, so a later renewal still belongs to the campaign that created the account.

Mock checkout calls `trackRevenue` after `subscription_started`, using the plan's `amountCents` and `currency`, with `provider: "mock"`. That is the only call site in this work. Authorize.net, when it is built, calls the same function with the captured amount for the initial charge and for each renewal.

### Configuration and privacy

`.env.example` documents `POSTHOG_API_KEY` and `POSTHOG_HOST`. The privacy policy processors section gains this sentence:

> We use PostHog to understand how the product is used and which campaigns lead to subscriptions. Those events can include an account email, pages opened, product actions, and how you arrived. They are not shared with advertising networks.

`DECISIONS.md` records the choice: PostHog Cloud, server-side capture, revenue only through `trackRevenue`, payment provider left for the Authorize.net work.

## Data flow

1. The proxy sets the visitor id and the first and last touch. The root layout stores the touch. That path is unchanged.
2. A navigation posts the pathname. The route sends `$pageview` with the last-touch channel.
3. A product action calls `trackEvent`, which inserts into `analytics_events` and then forwards.
4. Signup or login calls `identifyAttribution`, which stores the account's touches, aliases the visitor onto the user, and sets person properties.
5. Mock checkout records the subscription, emits `subscription_started` with no amount, then emits `invoice_paid` from the plan price.

## Error handling

The PostHog forward sits in its own try/catch after the Postgres insert. A send failure leaves the row stored and logs a warning with the event name. The log omits campaign parameters and click ids.

Page views exist only in PostHog. A failed send is dropped and the navigation still finishes. The pageview route always responds 204.

Signup, login, mock checkout, and `trackRevenue` return normally when PostHog is down or the key is unset. `trackRevenue` sends nothing when `amountCents` is not a finite number greater than or equal to zero, and still does not throw.

Alias and person updates run on every `identifyAttribution` call, so a failed identify is retried the next time that account shows up.

## Testing

Tests install a fake sender. No test opens a network connection.

Sender and `trackEvent`:

- A missing API key sends nothing.
- A product event includes `attr_source`, `attr_medium`, `attr_campaign`, `attr_landing`, `attr_referrer`, and the allowlisted params from the last touch. A caller prop named `source` is still present.
- `trackRevenue` turns 2900 cents and `usd` into `revenue: 29` and `currency: "USD"`.
- A non-number or a negative `amountCents` produces no revenue event.
- A thrown send leaves the Postgres row in place, and `trackEvent` resolves.

Pageview route:

- A normal pathname sends `$pageview`.
- `/admin` and `/api` (and paths under them) send nothing.
- A body that is not a pathname sends nothing.
- A request with no visitor cookie sends nothing.

Identity:

- Linking a visitor to a new account aliases that visitor id onto the user id and sets the first-touch properties once.

Billing:

- Mock checkout calls `trackRevenue` with the plan's `amountCents`, currency, tier, period, and `provider: "mock"`.
- The existing attribution tests stay as they are.

## Out of scope

- Authorize.net, Stripe invoice webhooks, and any other payment-provider work
- The PostHog browser SDK and session replay
- Importing historical `analytics_events`
- New admin analytics screens
- Sending conversions to advertising networks
- Changing how attribution cookies are captured

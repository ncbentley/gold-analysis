# Live socket, REST only for gaps

## Decision

The Twelve Data price socket is the live XAU/USD tape. A routine market sync does not call `time_series` while that tape is current.

## When REST runs

A routine sync (no explicit `from`) calls the provider only when `routineRest` returns `fetch`:

- No minute bar is stored yet.
- The market is open and the newest bar is more than two minutes behind the clock.
- The market is open and the sync cursor is more than two minutes behind the newest bar. That is the hole left by a disconnect, including minutes the socket wrote after it reconnected.

Explicit backfill (`syncMarketData({ from })`, coverage for an older signal, and a provider reset) always calls the provider.

While the market is closed and a bar is stored, the routine sync does not poll.

## When REST does not run

`skip` means the newest bar and the cursor are both within two minutes of the clock. The sync advances the cursor to the current minute and does not call Twelve Data. If that cursor moves forward, the minute job queues one open-outcome recalc. A second pass in the same minute does not queue another.

The sync still compacts minute paths on every routine pass.

## Unchanged

Stored bars stay. Socket bars still overwrite the minute they cover. REST inserts still do nothing on conflict. History behind the first stored bar is still fetched by the coverage backfill.

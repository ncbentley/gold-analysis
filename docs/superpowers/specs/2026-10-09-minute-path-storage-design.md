# Minute path storage

## Goal

Live XAU/USD prints stay accurate, the database keeps only what a replay still needs, and a page read does not scan the raw tape.

A sealed minute is one row, kept for 30 days. Minute bars stay. Individual prints exist only for minutes that are not sealed yet.

## Decisions

- The exact print order is kept for 30 days from the minute's open time. After that, the path row is deleted and a replay of that minute uses the candle path. An outcome already stored is left as it is until a rules change, a forced recalculation, or an adjustment dated before its checkpoint.
- An open trade lasts at most 7 days, and an unfilled order expires the same day, so a trade that can still change always falls inside the 30-day window.
- Charts keep using minute bars.
- REST history sync still writes bars only. Those minutes have no path, and the replay uses the candle path.
- Provider reset already deletes bars and the sync cursor. It also deletes paths and buffer prints, so two providers never share one series.

## What is stored

`market_minute_paths` has one row per instrument and minute.

- `instrument`
- `minute`, the open time
- `offsets`, milliseconds from `minute` for each kept print, in vendor-time order
- `prices`, the price for each offset

Primary key is `(instrument, minute)`.

Consecutive prints with the same price are stored once. The kept print is the earliest. A minute with no prints has no row.

`market_ticks` is the buffer for minutes that are not sealed. The socket still flushes about once a second, so a crash loses at most that second. A minute that already has a path is not buffered.

Each stored print keeps its vendor time so a print that arrives after the minute sealed can be merged into the right place. The replay uses that order. Fill, stop, and target times stay on the bar, as they do today.

## Sealing

When a print belongs to a later minute, the minute before it seals.

Sealing reads that minute's buffer in vendor time, then arrival order. It collapses consecutive equal prices, writes the path, and deletes that minute's buffer rows in one transaction. If the write fails, the buffer rows stay and the next flush tries again.

A print for a minute that already has a path is merged into that path by vendor time and collapsed again. It is not written to the buffer.

The open minute is updated in the buffer and on the open bar, so the latest price is visible before the minute seals.

The first run compacts every buffered minute that is already closed, oldest first, one minute per transaction. A read uses the path when the row exists and the buffer when it does not, so the compact can run while pages are served. After that pass, the buffer holds only the open minute.

## Retention

A path whose minute opened more than 30 days ago is deleted. The sweep also deletes buffer rows for a minute that already has a path. It does not delete buffer rows whose path was never written.

The sweep runs at least once an hour from the market-data schedule, including when the bar sync itself is skipped. Thirty days is one named constant.

## How a page reads

`getEngineTicks` stays the read used by replay. For each sealed minute in the window it expands the path in stored order, with each print's vendor time. The open minute, and any minute not yet compacted, comes from the buffer in the same order used today: vendor time, then arrival.

The query is a range on `(instrument, minute)` plus the small buffer. A seven-day window is about ten thousand path rows, not one row per print.

A request that replays many ideas loads that window once and indexes the prints once. Each idea reuses that index. It does not re-read or re-index the window per card.

When the path is gone, the minute adds no prints. `pathForBar` uses the candle path: an up bar is open, low, high, close, and a down bar is open, high, low, close.

## Failure

A failed seal leaves the buffer in place and retries. A failed sweep leaves old paths in place until the next hour. A missing path never invents prices. The candle path is the fallback, which is the same rule already used for minutes that have no prints.

## Tests

- Sealing keeps vendor order and drops a consecutive duplicate price.
- A print that arrives after the seal is merged by vendor time.
- A read returns sealed paths and buffer prints together, in order.
- A minute with no path uses the candle path.
- The sweep removes paths older than 30 days and leaves buffer rows that have no path.
- A provider reset clears paths and buffer prints with the bars.
- Several ideas replayed from one loaded window index the prints once.

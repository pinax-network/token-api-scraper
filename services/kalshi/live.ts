// Kalshi live tip-following scraper. One `run()` call = one polling cycle;
// the CLI runner loops with `AUTO_RESTART_DELAY` between iterations.

import {
    getBatchInsertQueue,
    shutdownBatchInsertQueue,
} from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import { createLogger } from '../../lib/logger';
import {
    incrementError,
    incrementItemsSkipped,
    incrementPagesReceived,
    incrementSuccess,
    setScopePoisoned,
} from '../../lib/prometheus';
import { initService, markServiceAlive } from '../../lib/service-init';
import { KalshiClient } from './client';
import {
    type CursorCheckpoint,
    getCursors,
    isDue,
    markRan,
    setCursor,
} from './cursor';
import {
    candleRow,
    eventRow,
    marketRow,
    SENTINEL_TS_PREFIX,
    seriesRow,
    tradeRow,
} from './normalize';

const serviceName = 'kalshi-live';
const log = createLogger(serviceName);

const SCOPE_TRADES = 'trades_live';
const SCOPE_MARKETS = 'markets_refresh';
const SCOPE_EVENTS = 'events_refresh';
const SCOPE_SERIES = 'series_refresh';
const SCOPE_CANDLES = 'candles_refresh';

/** Quarantine marker for a scope whose cursor pagination got stuck in a
 * loop (server returned a cursor we already used). Subsequent cycles
 * short-circuit on this value so the scope doesn't crashloop. Operator must
 * clear the row to resume. */
export const POISONED_SENTINEL = '__POISONED__';

// Cold-start lookback: bounds the very first cycle when cursor_state is empty.
// Steady-state runs drive `min_ts` from the persisted watermark instead.
const COLD_START_LOOKBACK_S = 60;

// Refresh-pass cadences. Each pass runs only if its scope clock is older than
// these. The same value doubles as the cold-start lookback for `min_updated_ts`
// so the very first refresh is roughly steady-state sized.
const MARKETS_REFRESH_S = 5 * 60;
const EVENTS_REFRESH_S = 10 * 60;
const SERIES_REFRESH_S = 60 * 60;
const CANDLES_REFRESH_S = 60;

// Kalshi `/markets/candlesticks` caps at 100 tickers per call.
const CANDLES_MAX_TICKERS = 100;
// Window of trade activity used to pick "hot" tickers; matches the candles
// refresh cadence so every tick that traded since the last pass is covered.
const CANDLES_LOOKBACK_S = 60;

// Defensive cap. With no MAX_PAGES_PER_CYCLE we drain to watermark every cycle,
// but a server-side cursor bug (same cursor echoed twice) could spin forever.
const PAGE_HARD_LIMIT = 10_000;

type Queue = ReturnType<typeof getBatchInsertQueue>;

export async function run(): Promise<void> {
    initService({ serviceName });

    const client = new KalshiClient();
    const queue = getBatchInsertQueue();

    let primaryError: unknown;
    let cycleProgressed = false;

    try {
        const cursors = await getCursors([
            SCOPE_TRADES,
            SCOPE_MARKETS,
            SCOPE_EVENTS,
            SCOPE_SERIES,
            SCOPE_CANDLES,
        ]);

        // Reassert quarantine gauges every cycle so an operator clearing
        // `__POISONED__` is reflected without a code change.
        for (const scope of [
            SCOPE_TRADES,
            SCOPE_MARKETS,
            SCOPE_EVENTS,
            SCOPE_SERIES,
            SCOPE_CANDLES,
        ]) {
            setScopePoisoned(
                scope,
                cursors.get(scope)?.last_cursor === POISONED_SENTINEL,
            );
        }

        await runPass(
            cursors,
            'trades',
            SCOPE_TRADES,
            // Always due — trades pass tip-follows on every cycle.
            true,
            () => runTradesPass(client, queue, cursors.get(SCOPE_TRADES)),
        );
        await runPass(
            cursors,
            'markets',
            SCOPE_MARKETS,
            isDue(
                cursors.get(SCOPE_MARKETS)?.last_processed_ts_ms,
                MARKETS_REFRESH_S,
            ),
            async () => {
                await runMarketsPass(client, queue, cursors.get(SCOPE_MARKETS));
                await flushAndMarkRan(queue, SCOPE_MARKETS, 'markets');
            },
        );
        await runPass(
            cursors,
            'events',
            SCOPE_EVENTS,
            isDue(
                cursors.get(SCOPE_EVENTS)?.last_processed_ts_ms,
                EVENTS_REFRESH_S,
            ),
            async () => {
                await runEventsPass(client, queue, cursors.get(SCOPE_EVENTS));
                await flushAndMarkRan(queue, SCOPE_EVENTS, 'events');
            },
        );
        await runPass(
            cursors,
            'series',
            SCOPE_SERIES,
            isDue(
                cursors.get(SCOPE_SERIES)?.last_processed_ts_ms,
                SERIES_REFRESH_S,
            ),
            async () => {
                await runSeriesPass(client, queue);
                await flushAndMarkRan(queue, SCOPE_SERIES, 'series');
            },
        );
        await runPass(
            cursors,
            'candles',
            SCOPE_CANDLES,
            isDue(
                cursors.get(SCOPE_CANDLES)?.last_processed_ts_ms,
                CANDLES_REFRESH_S,
            ),
            async () => {
                await runCandlesPass(client, queue);
                await flushAndMarkRan(queue, SCOPE_CANDLES, 'candles');
            },
        );

        cycleProgressed = true;
    } catch (error) {
        primaryError = error;
        const err = error as Error & { pass?: string };
        log.error('kalshi-live cycle failed', {
            pass: err?.pass,
            message: err?.message ?? String(error),
            stack: err?.stack,
        });
    }

    // Shutdown runs on both paths to flush in-flight rows. If shutdown
    // throws AND we already have a primary error, log+swallow so the
    // original root cause survives propagation.
    try {
        await shutdownBatchInsertQueue();
    } catch (shutdownErr) {
        if (primaryError) {
            log.error('shutdown also failed; preserving original cycle error', {
                shutdownErr: String(
                    (shutdownErr as Error)?.message ?? shutdownErr,
                ),
            });
        } else {
            primaryError = shutdownErr;
        }
    }

    if (primaryError) {
        incrementError(serviceName);
        throw primaryError;
    }
    // Heartbeat only on cycles that finished cleanly — error paths
    // deliberately leave it stale so the liveness probe can catch silent
    // insert failures + shutdown errors after the grace window.
    if (cycleProgressed) {
        markServiceAlive();
    }
    incrementSuccess(serviceName);
}

/** Run a single pass with quarantine + due-gate + per-pass error tagging.
 * The quarantine check short-circuits if `cursor_state.<scope>.last_cursor`
 * is `__POISONED__` — operator must clear the row to resume. */
async function runPass(
    cursors: Map<string, CursorCheckpoint>,
    label: string,
    scope: string,
    due: boolean,
    body: () => Promise<void>,
): Promise<void> {
    if (cursors.get(scope)?.last_cursor === POISONED_SENTINEL) {
        log.warn(`${label} pass quarantined — manual intervention required`, {
            scope,
            oldest_seen: cursors.get(scope)?.last_processed_ts_iso,
        });
        return;
    }
    if (!due) return;
    try {
        await body();
    } catch (err) {
        (err as Error & { pass?: string }).pass = label;
        throw err;
    }
}

/** Flush buffered rows, abort if any flush failed (or a prior periodic-timer
 * flush left an unresolved error), then stamp the refresh-pass clock. The
 * flush+check pair must precede `markRan` so the clock can't advance past
 * rows that were lost mid-cycle. */
async function flushAndMarkRan(
    queue: Queue,
    scope: string,
    label: string,
): Promise<void> {
    const results = await queue.flushAll();
    if (results.includes('err') || !queue.isHealthy()) {
        throw new Error(
            `${label} refresh: batch flush failed; clock not advanced`,
        );
    }
    await markRan(scope);
}

/** Unix ms → `YYYY-MM-DDTHH:MM:SS.NNNNNNZ` with the fractional seconds padded
 * to 6 digits to match Kalshi's µs-precision trade timestamps. */
export function padIsoToMicroseconds(ms: number): string {
    return new Date(ms).toISOString().replace(/\.(\d{3})Z$/, '.$1000Z');
}

async function runTradesPass(
    client: KalshiClient,
    queue: Queue,
    prev: CursorCheckpoint | undefined,
): Promise<void> {
    // Watermark for filter + comparison. Trade-side uses the full µs ISO from
    // the prior cursor so chronologically-newer trades that share the same ms
    // bucket aren't dropped by a lexicographic prefix collision. Cold-start
    // pads the ms-precision `Date#toISOString()` to 6 fractional digits — Kalshi
    // emits `.NNNNNNZ` and `'4' < 'Z'`, so `.233Z` lex-orders AFTER `.233435Z`.
    const watermarkMs =
        prev?.last_processed_ts_ms ?? Date.now() - COLD_START_LOOKBACK_S * 1000;
    const watermarkIso =
        prev?.last_processed_ts_iso ?? padIsoToMicroseconds(watermarkMs);

    // Local cursor only — live's resume mechanism is `min_ts` from the
    // persisted watermark, not the persisted cursor token. The cursor is
    // ephemeral for the duration of this cycle.
    let cursor: string | undefined;
    let prevCursor: string | undefined;
    let pages = 0;
    let inserted = 0;
    let newestSeen: string | undefined;
    let crossedWatermark = false;

    while (!crossedWatermark) {
        if (pages >= PAGE_HARD_LIMIT) {
            throw new Error(
                `trades pass exceeded ${PAGE_HARD_LIMIT} pages — possible cursor loop`,
            );
        }
        pages++;
        const page = await client.getTradesLive({
            min_ts: cursor ? undefined : Math.floor(watermarkMs / 1000),
            cursor,
            limit: 1000,
        });
        incrementPagesReceived(SCOPE_TRADES);

        if (page.trades.length === 0) break;

        for (const t of page.trades) {
            // Filter Kalshi's `0001-01-01...` sentinel BEFORE the watermark
            // comparison — otherwise the sentinel lex-orders below any real
            // watermark, falsely flips crossedWatermark, and the rest of the
            // page is silently dropped.
            if (t.created_time.startsWith(SENTINEL_TS_PREFIX)) {
                log.warn('skipping trade with sentinel created_time', {
                    trade_id: t.trade_id,
                    ticker: t.ticker,
                });
                incrementItemsSkipped('trades', 'sentinel_created_time');
                continue;
            }
            if (t.created_time <= watermarkIso) {
                crossedWatermark = true;
                break;
            }
            await queue.add('trades', tradeRow(t));
            inserted++;
            if (!newestSeen || t.created_time > newestSeen) {
                newestSeen = t.created_time;
            }
        }

        const nextCursor = page.cursor || undefined;
        // Detect both 1-hop self-loop (server echoes the cursor we just
        // sent) and 2-hop alternation (A → B → A).
        const isLoop =
            !!nextCursor &&
            (nextCursor === cursor || nextCursor === prevCursor);
        if (isLoop) {
            // Quarantine the looping scope. Flush first so already-queued
            // rows reach CH; skip the quarantine persist if the flush itself
            // failed so the next cycle can re-fetch and re-insert those rows.
            const flushResults = await queue.flushAll();
            const flushFailed =
                flushResults.includes('err') || !queue.isHealthy();
            if (!flushFailed) {
                const watermark =
                    newestSeen ?? padIsoToMicroseconds(Date.now());
                await setCursor(SCOPE_TRADES, POISONED_SENTINEL, watermark);
            }
            throw new Error(
                flushFailed
                    ? 'trades pass got a stale cursor back AND batch flush failed; cursor NOT quarantined to allow row recovery on retry'
                    : 'trades pass got a stale cursor back — server-side loop suspected; cursor quarantined',
            );
        }
        prevCursor = cursor;
        cursor = nextCursor;
        if (!cursor) break;
    }

    if (newestSeen) {
        // Flush BEFORE advancing the watermark so the next cycle's `min_ts`
        // never moves past rows that haven't landed in CH. Mirrors the
        // refresh-pass guard via `flushAndMarkRan`.
        const results = await queue.flushAll();
        if (results.includes('err') || !queue.isHealthy()) {
            throw new Error(
                'trades pass: batch flush failed; watermark not advanced',
            );
        }
        // `last_cursor` is unused on the read side (cycle-local), so persist
        // an empty string and let `last_processed_ts` carry the resume signal.
        await setCursor(SCOPE_TRADES, '', newestSeen);
    }

    log.info('trades-live cycle', {
        pages,
        inserted,
        hasMoreCursor: !!cursor,
        newestSeen,
    });
}

interface RefreshPassOpts<P, T> {
    label: string;
    scope: string;
    intervalSec: number;
    table: string;
    fetch: (cursor: string | undefined, minUpdatedTs: number) => Promise<P>;
    items: (page: P) => T[];
    nextCursor: (page: P) => string | undefined;
    mapper: (item: T) => Record<string, unknown>;
    /** Optional predicate: return a reason string to skip the item, or
     * undefined to keep it. Used to drop entries whose sentinel timestamps
     * would null-out into a non-nullable column on insert. */
    skip?: (item: T) => string | undefined;
}

async function runRefreshPass<P, T>(
    queue: Queue,
    prev: CursorCheckpoint | undefined,
    opts: RefreshPassOpts<P, T>,
): Promise<void> {
    const minUpdatedTs = prev
        ? Math.floor(prev.last_processed_ts_ms / 1000)
        : Math.floor(Date.now() / 1000) - opts.intervalSec;

    let cursor: string | undefined;
    let prevCursor: string | undefined;
    let pages = 0;
    let inserted = 0;
    let skipped = 0;
    while (true) {
        if (pages >= PAGE_HARD_LIMIT) {
            throw new Error(
                `${opts.label} refresh exceeded ${PAGE_HARD_LIMIT} pages — possible cursor loop`,
            );
        }
        const page = await opts.fetch(cursor, minUpdatedTs);
        incrementPagesReceived(opts.scope);
        for (const item of opts.items(page)) {
            const skipReason = opts.skip?.(item);
            if (skipReason) {
                log.warn(`skipping ${opts.label} item`, {
                    reason: skipReason,
                });
                incrementItemsSkipped(opts.table, skipReason);
                skipped++;
                continue;
            }
            await queue.add(opts.table, opts.mapper(item));
            inserted++;
        }
        pages++;
        const nextCursor = opts.nextCursor(page);
        const isLoop =
            !!nextCursor &&
            (nextCursor === cursor || nextCursor === prevCursor);
        if (isLoop) {
            const flushResults = await queue.flushAll();
            const flushFailed =
                flushResults.includes('err') || !queue.isHealthy();
            if (!flushFailed) {
                await setCursor(
                    opts.scope,
                    POISONED_SENTINEL,
                    padIsoToMicroseconds(Date.now()),
                );
            }
            throw new Error(
                flushFailed
                    ? `${opts.label} refresh got a stale cursor back AND batch flush failed; cursor NOT quarantined to allow row recovery on retry`
                    : `${opts.label} refresh got a stale cursor back — server-side loop suspected; cursor quarantined`,
            );
        }
        prevCursor = cursor;
        cursor = nextCursor;
        if (!cursor) break;
    }
    log.info(`${opts.label} refresh`, {
        pages,
        inserted,
        skipped,
        minUpdatedTs,
    });
}

function runMarketsPass(
    client: KalshiClient,
    queue: Queue,
    prev: CursorCheckpoint | undefined,
): Promise<void> {
    return runRefreshPass(queue, prev, {
        label: 'markets',
        scope: SCOPE_MARKETS,
        intervalSec: MARKETS_REFRESH_S,
        table: 'markets',
        fetch: (cursor, minUpdatedTs) =>
            client.getMarkets({
                min_updated_ts: minUpdatedTs,
                limit: 1000,
                cursor,
            }),
        items: (p) => p.markets,
        nextCursor: (p) => p.cursor || undefined,
        mapper: marketRow,
        // markets.created_time + markets.updated_time are non-nullable in CH.
        // `ts()` would coerce the Kalshi sentinel to null and the batch insert
        // would then fail; drop the row before it reaches the queue.
        // Skip reason strings double as `scraper_items_skipped_total.reason`
        // labels — use snake_case to stay consistent with the same skip
        // condition in kalshi-backfill's markets pass.
        skip: (m) => {
            if (m.created_time?.startsWith(SENTINEL_TS_PREFIX)) {
                return 'sentinel_created_time';
            }
            if (m.updated_time?.startsWith(SENTINEL_TS_PREFIX)) {
                return 'sentinel_updated_time';
            }
            return undefined;
        },
    });
}

function runEventsPass(
    client: KalshiClient,
    queue: Queue,
    prev: CursorCheckpoint | undefined,
): Promise<void> {
    return runRefreshPass(queue, prev, {
        label: 'events',
        scope: SCOPE_EVENTS,
        intervalSec: EVENTS_REFRESH_S,
        table: 'events',
        fetch: (cursor, minUpdatedTs) =>
            client.getEvents({
                min_updated_ts: minUpdatedTs,
                limit: 200,
                cursor,
            }),
        items: (p) => p.events,
        nextCursor: (p) => p.cursor || undefined,
        mapper: eventRow,
    });
}

async function runSeriesPass(
    client: KalshiClient,
    queue: Queue,
): Promise<void> {
    const page = await client.getSeries();
    for (const s of page.series) {
        await queue.add('series', seriesRow(s));
    }
    log.info('series refresh', { inserted: page.series.length });
}

async function runCandlesPass(
    client: KalshiClient,
    queue: Queue,
): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const startTs = now - CANDLES_LOOKBACK_S;

    const { data } = await query<{ ticker: string }>(
        `SELECT ticker
         FROM trades
         WHERE created_time >= now() - INTERVAL {lookback:UInt32} SECOND
         GROUP BY ticker
         ORDER BY count() DESC
         LIMIT {limit:UInt32}`,
        { lookback: CANDLES_LOOKBACK_S, limit: CANDLES_MAX_TICKERS },
    );
    const tickers = data.map((r) => r.ticker);

    if (tickers.length === 0) {
        log.info('candles refresh', { tickers: 0, inserted: 0 });
        return;
    }

    const page = await client.getBulkCandlesticks({
        market_tickers: tickers,
        start_ts: startTs,
        end_ts: now,
        period_interval: 1,
    });

    let inserted = 0;
    for (const block of page.markets) {
        for (const c of block.candlesticks) {
            await queue.add(
                'candlesticks',
                candleRow(block.market_ticker, 1, c),
            );
            inserted++;
        }
    }
    log.info('candles refresh', { tickers: tickers.length, inserted });
}

// Kalshi live tip-following scraper. One `run()` call = one polling cycle;
// the CLI runner loops with `AUTO_RESTART_DELAY` between iterations.

import {
    getBatchInsertQueue,
    shutdownBatchInsertQueue,
} from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import { createLogger } from '../../lib/logger';
import { incrementError, incrementSuccess } from '../../lib/prometheus';
import { initService } from '../../lib/service-init';
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

    try {
        const cursors = await getCursors([
            SCOPE_TRADES,
            SCOPE_MARKETS,
            SCOPE_EVENTS,
            SCOPE_SERIES,
            SCOPE_CANDLES,
        ]);

        await wrap('trades', () =>
            runTradesPass(client, queue, cursors.get(SCOPE_TRADES)),
        );

        if (
            isDue(
                cursors.get(SCOPE_MARKETS)?.last_processed_ts_ms,
                MARKETS_REFRESH_S,
            )
        ) {
            await wrap('markets', async () => {
                await runMarketsPass(client, queue, cursors.get(SCOPE_MARKETS));
                await markRan(SCOPE_MARKETS);
            });
        }
        if (
            isDue(
                cursors.get(SCOPE_EVENTS)?.last_processed_ts_ms,
                EVENTS_REFRESH_S,
            )
        ) {
            await wrap('events', async () => {
                await runEventsPass(client, queue, cursors.get(SCOPE_EVENTS));
                await markRan(SCOPE_EVENTS);
            });
        }
        if (
            isDue(
                cursors.get(SCOPE_SERIES)?.last_processed_ts_ms,
                SERIES_REFRESH_S,
            )
        ) {
            await wrap('series', async () => {
                await runSeriesPass(client, queue);
                await markRan(SCOPE_SERIES);
            });
        }
        if (
            isDue(
                cursors.get(SCOPE_CANDLES)?.last_processed_ts_ms,
                CANDLES_REFRESH_S,
            )
        ) {
            await wrap('candles', async () => {
                await runCandlesPass(client, queue);
                await markRan(SCOPE_CANDLES);
            });
        }

        incrementSuccess(serviceName);
    } catch (error) {
        const err = error as Error & { pass?: string };
        log.error('kalshi-live cycle failed', {
            pass: err?.pass,
            message: err?.message ?? String(error),
            stack: err?.stack,
        });
        incrementError(serviceName);
        throw error;
    } finally {
        await shutdownBatchInsertQueue();
    }
}

/** Tag thrown errors with the pass name so the cycle catch can report which pass blew up. */
async function wrap<T>(pass: string, fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (err) {
        (err as Error & { pass?: string }).pass = pass;
        throw err;
    }
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

        if (page.trades.length === 0) break;

        for (const t of page.trades) {
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
        if (nextCursor && nextCursor === prevCursor) {
            throw new Error(
                'trades pass got the same cursor twice — server-side loop suspected',
            );
        }
        prevCursor = cursor;
        cursor = nextCursor;
        if (!cursor) break;
    }

    if (newestSeen) {
        await setCursor(SCOPE_TRADES, cursor ?? '', newestSeen);
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
    intervalSec: number;
    table: string;
    fetch: (cursor: string | undefined, minUpdatedTs: number) => Promise<P>;
    items: (page: P) => T[];
    nextCursor: (page: P) => string | undefined;
    mapper: (item: T) => Record<string, unknown>;
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
    while (true) {
        if (pages >= PAGE_HARD_LIMIT) {
            throw new Error(
                `${opts.label} refresh exceeded ${PAGE_HARD_LIMIT} pages — possible cursor loop`,
            );
        }
        const page = await opts.fetch(cursor, minUpdatedTs);
        for (const item of opts.items(page)) {
            await queue.add(opts.table, opts.mapper(item));
            inserted++;
        }
        pages++;
        const nextCursor = opts.nextCursor(page);
        if (nextCursor && nextCursor === prevCursor) {
            throw new Error(
                `${opts.label} refresh got the same cursor twice — server-side loop suspected`,
            );
        }
        prevCursor = cursor;
        cursor = nextCursor;
        if (!cursor) break;
    }
    log.info(`${opts.label} refresh`, { pages, inserted, minUpdatedTs });
}

function runMarketsPass(
    client: KalshiClient,
    queue: Queue,
    prev: CursorCheckpoint | undefined,
): Promise<void> {
    return runRefreshPass(queue, prev, {
        label: 'markets',
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
    });
}

function runEventsPass(
    client: KalshiClient,
    queue: Queue,
    prev: CursorCheckpoint | undefined,
): Promise<void> {
    return runRefreshPass(queue, prev, {
        label: 'events',
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

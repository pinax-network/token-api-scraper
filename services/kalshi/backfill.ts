// Kalshi historical-trade backfill. Walks `/historical/trades` newest-first
// from the cutoff backward, checkpointing per page so any process restart
// resumes from the same cursor. One `run()` call = one bounded chunk
// (`MAX_PAGES_PER_CYCLE`); the CLI runner cycles until the archive is drained.

import {
    getBatchInsertQueue,
    shutdownBatchInsertQueue,
} from '../../lib/batch-insert';
import { createLogger } from '../../lib/logger';
import {
    incrementError,
    incrementItemsSkipped,
    incrementPagesReceived,
    incrementSuccess,
    setBackfillDrained,
    setScopePoisoned,
} from '../../lib/prometheus';
import { initService, markServiceAlive } from '../../lib/service-init';
import { KalshiClient } from './client';
import { getCursor, setCursor } from './cursor';
import { padIsoToMicroseconds } from './live';
import { SENTINEL_TS_PREFIX, tradeRow } from './normalize';

const serviceName = 'kalshi-backfill';
const log = createLogger(serviceName);

const SCOPE = 'trades_backfill';

/** Stored in `cursor_state.last_cursor` once the archive returns no further
 * pages on a productive cycle. Subsequent cycles short-circuit on this value
 * and idle quietly. */
export const DRAINED_SENTINEL = '__DRAINED__';

/** Stored in `cursor_state.last_cursor` when the server returned a cursor we
 * already used (immediate self-loop or 2-hop alternation). Quarantines the
 * cursor so the next cycle doesn't re-enter the loop. Operator must clear
 * the row to resume backfilling. */
export const POISONED_SENTINEL = '__POISONED__';

const SENTINELS = new Set([DRAINED_SENTINEL, POISONED_SENTINEL]);

/** Bounds the wall-clock work of a single `run()` call. The walker flushes
 * the batch queue and persists the resume cursor every page, so an interrupt
 * is always resumable from the last checkpoint. */
const MAX_PAGES_PER_CYCLE = 1000;

type Queue = ReturnType<typeof getBatchInsertQueue>;

export async function run(): Promise<void> {
    initService({ serviceName });

    const client = new KalshiClient();
    const queue = getBatchInsertQueue();

    let primaryError: unknown;

    try {
        const prev = await getCursor(SCOPE);
        // Reassert state gauges every cycle. If an operator clears the
        // row the next cycle resets these to 0 without code changes.
        setBackfillDrained(SCOPE, prev?.last_cursor === DRAINED_SENTINEL);
        setScopePoisoned(SCOPE, prev?.last_cursor === POISONED_SENTINEL);
        if (prev?.last_cursor === DRAINED_SENTINEL) {
            log.info('backfill archive drained, idling', {
                oldest_seen: prev.last_processed_ts_iso,
            });
            markServiceAlive();
        } else if (prev?.last_cursor === POISONED_SENTINEL) {
            log.warn(
                'backfill quarantined — manual intervention required to resume',
                { oldest_seen: prev.last_processed_ts_iso },
            );
            markServiceAlive();
        } else {
            await runTradesBackfill(
                client,
                queue,
                (cursor, iso) => setCursor(SCOPE, cursor, iso),
                prev?.last_cursor,
                prev?.last_processed_ts_iso,
            );
            // Bump heartbeat once the walker returns cleanly — distinguishes
            // an empty/no-progress cycle from a cycle that threw on a flush
            // error (which deliberately leaves the heartbeat stale so the
            // probe can catch silent insert loss).
            markServiceAlive();
        }
    } catch (error) {
        primaryError = error;
        const err = error as Error;
        log.error('kalshi-backfill cycle failed', {
            message: err?.message ?? String(error),
            stack: err?.stack,
        });
    }

    // Shutdown must run on both success and failure paths to flush in-flight
    // rows. If the shutdown itself throws AND there's already a primary error,
    // log+swallow the shutdown error so the original root cause survives.
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
    incrementSuccess(serviceName);
}

/** Callback that durably persists the current pagination cursor + oldest
 * trade-ts ISO seen so far. Injected so the walker is testable without
 * mocking the cursor module. */
export type PersistCheckpoint = (
    cursor: string,
    oldestSeenIso: string,
) => Promise<void>;

export async function runTradesBackfill(
    client: KalshiClient,
    queue: Queue,
    persist: PersistCheckpoint,
    initialCursor: string | undefined,
    initialOldestSeen: string | undefined,
): Promise<{
    pages: number;
    inserted: number;
    drained: boolean;
    oldestSeen: string | undefined;
}> {
    // Defense-in-depth: the run() guard above already short-circuits on
    // sentinel values; this catches direct callers that forgot to mirror it.
    // Forwarding a sentinel to the Kalshi API would either 4xx or, worse,
    // silently restart the walk from the cutoff.
    if (initialCursor && SENTINELS.has(initialCursor)) {
        throw new Error(
            `runTradesBackfill called with sentinel cursor ${initialCursor}; caller must short-circuit instead`,
        );
    }

    let cursor: string | undefined = initialCursor || undefined;
    let prevCursor: string | undefined;
    let oldestSeen: string | undefined = initialOldestSeen;
    let pages = 0;
    let inserted = 0;
    let drained = false;

    while (pages < MAX_PAGES_PER_CYCLE) {
        const page = await client.getTradesHistorical({ cursor, limit: 1000 });
        incrementPagesReceived(SCOPE);

        // Server hiccups (empty body / brief 200 with no content) return
        // {trades: [], cursor: ''}. Distinguishing a true drain from a
        // transient is impossible from a single empty response, so defer to
        // the next CLI cycle instead of committing DRAINED_SENTINEL on flaky
        // input. Matches the early-exit in live.ts.
        if (page.trades.length === 0) {
            log.info('backfill empty page, deferring drain decision', {
                pages,
                cursor_was: cursor,
            });
            break;
        }

        for (const t of page.trades) {
            // Kalshi documents `0001-01-01T00:00:00Z` as a "never set"
            // sentinel for unset timestamps. tradeRow() coerces it to null,
            // which would then fail to insert into trades.created_time
            // (non-nullable). Skip + warn so the cycle keeps advancing
            // instead of poisoning the watermark and dropping a whole batch.
            if (t.created_time.startsWith(SENTINEL_TS_PREFIX)) {
                log.warn('skipping trade with sentinel created_time', {
                    trade_id: t.trade_id,
                    ticker: t.ticker,
                });
                incrementItemsSkipped('trades', 'sentinel_created_time');
                continue;
            }
            await queue.add('trades', tradeRow(t));
            inserted++;
            if (!oldestSeen || t.created_time < oldestSeen) {
                oldestSeen = t.created_time;
            }
        }
        pages++;

        const nextCursor = page.cursor || undefined;

        // Detect both immediate self-loop (server returns the cursor we just
        // sent) and 2-hop alternation (A → B → A).
        const isLoop =
            !!nextCursor &&
            (nextCursor === cursor || nextCursor === prevCursor);
        if (isLoop) {
            // Flush buffered trades for this page before quarantining the
            // cursor. If the flush itself failed, do NOT persist
            // POISONED_SENTINEL: the spliced-out rows weren't written to CH
            // and quarantining would block the next cycle from re-fetching
            // and re-inserting them. Throw with both signals so the operator
            // sees both the loop and the flush failure. Mirror shutdown's
            // check by also catching a lingering periodic-timer flush error
            // (`!queue.isHealthy()`) that a subsequent partial-success flush
            // hasn't cleared.
            const flushResults = await queue.flushAll();
            const flushFailed =
                flushResults.includes('err') || !queue.isHealthy();
            if (!flushFailed) {
                const watermark =
                    oldestSeen ?? padIsoToMicroseconds(Date.now());
                await persist(POISONED_SENTINEL, watermark);
            }
            throw new Error(
                flushFailed
                    ? 'backfill got a stale cursor back AND batch flush failed; cursor NOT quarantined to allow row recovery on retry'
                    : 'backfill got a stale cursor back — server-side loop suspected; cursor quarantined',
            );
        }

        prevCursor = cursor;
        cursor = nextCursor;

        // Flush buffered trades to CH before persisting the cursor advance.
        // queue.add() only buffers — without this flush, a SIGKILL between
        // persist and the next periodic batch tick would lose the just-
        // enqueued rows while the persisted cursor has already advanced
        // past them (unrecoverable on opaque-cursor pagination).
        // BatchInsertQueue catches and tags per-table flush errors as 'err'
        // rather than throwing; abort the cycle on any err so the cursor
        // doesn't advance past lost rows. Also check `!queue.isHealthy()`
        // to catch a periodic-timer flush error that occurred between our
        // explicit flushes and that the current batch's success didn't
        // happen to clear (mirrors shutdown's combined check).
        const results = await queue.flushAll();
        if (results.includes('err') || !queue.isHealthy()) {
            throw new Error(
                'backfill aborting cycle — batch flush failed; cursor not advanced',
            );
        }

        // `oldestSeen` is normally set after the first non-sentinel trade.
        // The fallback handles the very rare case where every trade in the
        // last productive page was a sentinel (we still need *some* value
        // for the non-nullable CH column).
        const watermark = oldestSeen ?? padIsoToMicroseconds(Date.now());
        await persist(cursor ?? DRAINED_SENTINEL, watermark);

        if (!cursor) {
            drained = true;
            break;
        }
    }

    log.info('backfill cycle', {
        pages,
        inserted,
        drained,
        oldest_seen: oldestSeen,
        hasMoreCursor: !drained,
    });

    return { pages, inserted, drained, oldestSeen };
}

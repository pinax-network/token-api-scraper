// Kalshi historical backfill — one process draining all of the public
// "cold start" data we need to ship historical responses: trades (via
// `/historical/trades`), settled markets (via `/historical/markets`), and
// events (via the live `/events` endpoint without `min_updated_ts`, because
// Kalshi exempts events from the cutoff partitioning — see
// reference_kalshi_api.md `Live vs historical split`).
//
// Each pass walks its own scope independently; one `run()` call advances
// each pass by at most `MAX_PAGES_PER_CYCLE` pages, then yields. The CLI
// runner cycles until all three scopes hit `__DRAINED__`, after which the
// service idles.

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
import { type CursorCheckpoint, getCursors, setCursor } from './cursor';
import { padIsoToMicroseconds } from './live';
import { eventRow, marketRow, SENTINEL_TS_PREFIX, tradeRow } from './normalize';
import type {
    EventEntity,
    EventsPage,
    Market,
    MarketsPage,
    Trade,
    TradesPage,
} from './types';

const serviceName = 'kalshi-backfill';
const log = createLogger(serviceName);

export const SCOPE_TRADES = 'trades_backfill';
export const SCOPE_MARKETS = 'markets_backfill';
export const SCOPE_EVENTS = 'events_backfill';
const ALL_SCOPES = [SCOPE_TRADES, SCOPE_MARKETS, SCOPE_EVENTS] as const;

/** Stored in `cursor_state.last_cursor` once a pass returns no further pages
 * on a productive cycle. Subsequent cycles short-circuit on this value and
 * idle quietly. */
export const DRAINED_SENTINEL = '__DRAINED__';

/** Stored in `cursor_state.last_cursor` when the server returned a cursor we
 * already used (immediate self-loop or 2-hop alternation). Quarantines the
 * cursor so the next cycle doesn't re-enter the loop. Operator must clear
 * the row to resume the pass. */
export const POISONED_SENTINEL = '__POISONED__';

const SENTINELS = new Set([DRAINED_SENTINEL, POISONED_SENTINEL]);

/** Per-pass page budget within one `run()` call. Each pass flushes the batch
 * queue and persists its cursor every page, so an interrupt is always
 * resumable from the last checkpoint. */
const MAX_PAGES_PER_CYCLE = 1000;

/** When true, the three backfill passes run concurrently within one cycle
 * (via `Promise.allSettled`). Default sequential — concurrent mode is
 * faster when upstream RTT dominates but shares the BatchInsertQueue's
 * `lastFlushError` health across passes (one pass's flush failure forces
 * the others' next-page check to abort too). Opt in via the env var. */
function isParallelEnabled(): boolean {
    return process.env.KALSHI_BACKFILL_PARALLEL === 'true';
}

type Queue = ReturnType<typeof getBatchInsertQueue>;

/** Callback that durably persists the current pagination cursor + watermark
 * for a single scope. Injected so each pass is testable without mocking the
 * cursor module. */
export type PersistCheckpoint = (
    cursor: string,
    watermarkIso: string,
) => Promise<void>;

export async function run(): Promise<void> {
    initService({ serviceName });

    const client = new KalshiClient();
    const queue = getBatchInsertQueue();
    const parallel = isParallelEnabled();

    let primaryError: unknown;

    try {
        const cursors = await getCursors([...ALL_SCOPES]);
        // Reassert gauges every cycle so an operator clearing the row is
        // reflected immediately on the next /metrics scrape.
        for (const scope of ALL_SCOPES) {
            const c = cursors.get(scope);
            setBackfillDrained(scope, c?.last_cursor === DRAINED_SENTINEL);
            setScopePoisoned(scope, c?.last_cursor === POISONED_SENTINEL);
        }

        await runPasses(client, queue, cursors, parallel);

        // Heartbeat on every cycle — even when all three passes are drained
        // (no walker ran). Without the bump an idle-but-healthy service
        // would trip the liveness probe after the stale threshold.
        markServiceAlive();
    } catch (error) {
        primaryError = error;
        const err = error as Error & { pass?: string };
        log.error('kalshi-backfill cycle failed', {
            pass: err?.pass,
            message: err?.message ?? String(error),
            stack: err?.stack,
        });
    }

    // Shutdown runs on both paths to flush in-flight rows. If shutdown
    // throws AND we already have a primary error, log+swallow so the
    // original cycle error survives propagation.
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

/** Build the three pass invocations + run them either sequentially or
 * concurrently based on `parallel`. Exported for unit testing. */
export async function runPasses(
    client: KalshiClient,
    queue: Queue,
    cursors: Map<string, CursorCheckpoint>,
    parallel: boolean,
): Promise<void> {
    const passes: Array<{
        scope: string;
        label: string;
        body: () => Promise<unknown>;
    }> = [
        {
            scope: SCOPE_TRADES,
            label: 'trades',
            body: () =>
                runTradesBackfill(
                    client,
                    queue,
                    (c, t) => setCursor(SCOPE_TRADES, c, t),
                    cursors.get(SCOPE_TRADES)?.last_cursor,
                    cursors.get(SCOPE_TRADES)?.last_processed_ts_iso,
                ),
        },
        {
            scope: SCOPE_MARKETS,
            label: 'markets',
            body: () =>
                runMarketsBackfill(
                    client,
                    queue,
                    (c, t) => setCursor(SCOPE_MARKETS, c, t),
                    cursors.get(SCOPE_MARKETS)?.last_cursor,
                    cursors.get(SCOPE_MARKETS)?.last_processed_ts_iso,
                ),
        },
        {
            scope: SCOPE_EVENTS,
            label: 'events',
            body: () =>
                runEventsBackfill(
                    client,
                    queue,
                    (c, t) => setCursor(SCOPE_EVENTS, c, t),
                    cursors.get(SCOPE_EVENTS)?.last_cursor,
                    cursors.get(SCOPE_EVENTS)?.last_processed_ts_iso,
                ),
        },
    ];

    if (parallel) {
        // `allSettled` so a failure in one pass doesn't cancel the others
        // — passes write to independent CH tables + cursor scopes, so
        // partial-cycle progress is durable per-pass. Aggregate failures
        // afterward; the first one carries through with its pass label.
        const results = await Promise.allSettled(
            passes.map((p) => runPass(p.scope, p.label, cursors, p.body)),
        );
        const failures = results
            .map((r, i) => ({ r, label: passes[i]?.label ?? '' }))
            .filter(({ r }) => r.status === 'rejected');
        if (failures.length > 1) {
            for (const f of failures) {
                const reason = (f.r as PromiseRejectedResult).reason;
                log.error('parallel backfill pass failed', {
                    pass: f.label,
                    message: (reason as Error)?.message ?? String(reason),
                });
            }
        }
        if (failures.length > 0) {
            throw (failures[0]!.r as PromiseRejectedResult).reason;
        }
        return;
    }

    for (const p of passes) {
        await runPass(p.scope, p.label, cursors, p.body);
    }
}

/** Run one pass with quarantine + drained short-circuits + per-pass error
 * tagging. */
async function runPass(
    scope: string,
    label: string,
    cursors: Map<string, CursorCheckpoint>,
    body: () => Promise<unknown>,
): Promise<void> {
    const c = cursors.get(scope);
    if (c?.last_cursor === DRAINED_SENTINEL) {
        log.info(`${label} pass drained, idling`, {
            scope,
            oldest_seen: c.last_processed_ts_iso,
        });
        return;
    }
    if (c?.last_cursor === POISONED_SENTINEL) {
        log.warn(
            `${label} pass quarantined — manual intervention required to resume`,
            { scope, oldest_seen: c.last_processed_ts_iso },
        );
        return;
    }
    try {
        await body();
    } catch (err) {
        (err as Error & { pass?: string }).pass = label;
        throw err;
    }
}

interface BackfillPassDeps<P, T> {
    label: string;
    scope: string;
    table: string;
    fetchPage: (cursor: string | undefined) => Promise<P>;
    itemsOf: (page: P) => T[];
    nextCursorOf: (page: P) => string | undefined;
    mapper: (item: T) => Record<string, unknown>;
    /** Returns a non-empty reason if the item must be dropped before
     * `queue.add()` (sentinel timestamps that would null-out into a
     * non-nullable CH column). */
    skip?: (item: T) => string | undefined;
    /** Returns the chronological timestamp used to advance the persisted
     * watermark. Undefined for items without a meaningful timestamp — the
     * pass falls back to the previous watermark or `now()`. */
    watermarkOf: (item: T) => string | undefined;
}

interface PassResult {
    pages: number;
    inserted: number;
    drained: boolean;
    oldestSeen: string | undefined;
}

/** Generic cursor-paginated backfill walker shared by trades / markets /
 * events. The shape is identical across the three: cursor-paginate from an
 * optional resume token, write rows to a table, persist `cursor + watermark`
 * after every page, detect server-side loops, commit DRAINED_SENTINEL when
 * the upstream cursor empties on a productive cycle. */
async function runBackfillPass<P, T>(
    queue: Queue,
    persist: PersistCheckpoint,
    initialCursor: string | undefined,
    initialOldestSeen: string | undefined,
    deps: BackfillPassDeps<P, T>,
): Promise<PassResult> {
    // Defense-in-depth: `runPass()` above already short-circuits on
    // sentinel values; this catches direct callers that forgot to mirror it.
    // Forwarding a sentinel to the Kalshi API would either 4xx or, worse,
    // silently restart the walk from the cutoff.
    if (initialCursor && SENTINELS.has(initialCursor)) {
        throw new Error(
            `${deps.label} backfill called with sentinel cursor ${initialCursor}; caller must short-circuit instead`,
        );
    }

    let cursor: string | undefined = initialCursor || undefined;
    let prevCursor: string | undefined;
    let oldestSeen: string | undefined = initialOldestSeen;
    let pages = 0;
    let inserted = 0;
    let drained = false;

    while (pages < MAX_PAGES_PER_CYCLE) {
        const page = await deps.fetchPage(cursor);
        incrementPagesReceived(deps.scope);

        const items = deps.itemsOf(page);
        // Server hiccups (empty body / brief 200 with no content) return an
        // empty items array with empty cursor. Distinguishing a true drain
        // from a transient is impossible from a single empty response, so
        // defer to the next cycle instead of committing DRAINED_SENTINEL on
        // flaky input.
        if (items.length === 0) {
            log.info(
                `${deps.label} backfill empty page, deferring drain decision`,
                { pages, cursor_was: cursor },
            );
            break;
        }

        for (const item of items) {
            const skipReason = deps.skip?.(item);
            if (skipReason) {
                log.warn(`skipping ${deps.label} item`, { reason: skipReason });
                incrementItemsSkipped(deps.table, skipReason);
                continue;
            }
            await queue.add(deps.table, deps.mapper(item));
            inserted++;
            const ts = deps.watermarkOf(item);
            if (ts && (!oldestSeen || ts < oldestSeen)) {
                oldestSeen = ts;
            }
        }
        pages++;

        const nextCursor = deps.nextCursorOf(page);

        // Detect both immediate self-loop (server returns the cursor we just
        // sent) and 2-hop alternation (A → B → A).
        const isLoop =
            !!nextCursor &&
            (nextCursor === cursor || nextCursor === prevCursor);
        if (isLoop) {
            // Flush buffered rows for this page before quarantining the
            // cursor. If the flush itself failed, do NOT persist
            // POISONED_SENTINEL: the spliced-out rows weren't written to CH
            // and quarantining would block the next cycle from re-fetching
            // and re-inserting them.
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
                    ? `${deps.label} backfill got a stale cursor back AND batch flush failed; cursor NOT quarantined to allow row recovery on retry`
                    : `${deps.label} backfill got a stale cursor back — server-side loop suspected; cursor quarantined`,
            );
        }

        prevCursor = cursor;
        cursor = nextCursor;

        // Flush buffered rows to CH before persisting the cursor advance.
        // `queue.add()` only buffers — without this flush, a SIGKILL between
        // persist and the next periodic batch tick would lose the just-
        // enqueued rows while the persisted cursor has already advanced
        // past them. Also check `isHealthy()` to catch a periodic-timer
        // flush error that this success didn't happen to clear.
        const results = await queue.flushAll();
        if (results.includes('err') || !queue.isHealthy()) {
            throw new Error(
                `${deps.label} backfill aborting cycle — batch flush failed; cursor not advanced`,
            );
        }

        // `oldestSeen` is normally set after the first non-sentinel item.
        // Fallback handles the rare case where every item on the final
        // productive page was skipped (still need *some* value for the
        // non-nullable CH column).
        const watermark = oldestSeen ?? padIsoToMicroseconds(Date.now());
        await persist(cursor ?? DRAINED_SENTINEL, watermark);

        if (!cursor) {
            drained = true;
            break;
        }
    }

    log.info(`${deps.label} backfill cycle`, {
        pages,
        inserted,
        drained,
        oldest_seen: oldestSeen,
        hasMoreCursor: !drained,
    });

    return { pages, inserted, drained, oldestSeen };
}

export function runTradesBackfill(
    client: KalshiClient,
    queue: Queue,
    persist: PersistCheckpoint,
    initialCursor: string | undefined,
    initialOldestSeen: string | undefined,
): Promise<PassResult> {
    return runBackfillPass<TradesPage, Trade>(
        queue,
        persist,
        initialCursor,
        initialOldestSeen,
        {
            label: 'trades',
            scope: SCOPE_TRADES,
            table: 'trades',
            fetchPage: (cursor) =>
                client.getTradesHistorical({ cursor, limit: 1000 }),
            itemsOf: (p) => p.trades,
            nextCursorOf: (p) => p.cursor || undefined,
            mapper: tradeRow,
            // Kalshi documents `0001-01-01T00:00:00Z` as a "never set"
            // sentinel. tradeRow() coerces to null, which fails to insert
            // into trades.created_time (non-nullable).
            skip: (t) =>
                t.created_time.startsWith(SENTINEL_TS_PREFIX)
                    ? 'sentinel_created_time'
                    : undefined,
            watermarkOf: (t) => t.created_time,
        },
    );
}

export function runMarketsBackfill(
    client: KalshiClient,
    queue: Queue,
    persist: PersistCheckpoint,
    initialCursor: string | undefined,
    initialOldestSeen: string | undefined,
): Promise<PassResult> {
    return runBackfillPass<MarketsPage, Market>(
        queue,
        persist,
        initialCursor,
        initialOldestSeen,
        {
            label: 'markets',
            scope: SCOPE_MARKETS,
            table: 'markets',
            fetchPage: (cursor) =>
                client.getMarketsHistorical({ cursor, limit: 1000 }),
            itemsOf: (p) => p.markets,
            nextCursorOf: (p) => p.cursor || undefined,
            mapper: marketRow,
            // markets.created_time + markets.updated_time are non-nullable;
            // skip rows whose sentinel timestamps would null-out on insert.
            skip: (m) => {
                if (m.created_time?.startsWith(SENTINEL_TS_PREFIX)) {
                    return 'sentinel_created_time';
                }
                if (m.updated_time?.startsWith(SENTINEL_TS_PREFIX)) {
                    return 'sentinel_updated_time';
                }
                return undefined;
            },
            watermarkOf: (m) => m.created_time,
        },
    );
}

export function runEventsBackfill(
    client: KalshiClient,
    queue: Queue,
    persist: PersistCheckpoint,
    initialCursor: string | undefined,
    initialOldestSeen: string | undefined,
): Promise<PassResult> {
    return runBackfillPass<EventsPage, EventEntity>(
        queue,
        persist,
        initialCursor,
        initialOldestSeen,
        {
            label: 'events',
            scope: SCOPE_EVENTS,
            table: 'events',
            // No `min_updated_ts` — Kalshi exempts events from the cutoff
            // partitioning, so paginating live `/events` from cold-start
            // walks the entire historical set. Live's events-refresh pass
            // takes over via `min_updated_ts` once we drain.
            fetchPage: (cursor) => client.getEvents({ cursor, limit: 200 }),
            itemsOf: (p) => p.events,
            nextCursorOf: (p) => p.cursor || undefined,
            mapper: eventRow,
            // eventRow() handles `0001-01-01` via ts() → null and
            // events.last_updated_ts is Nullable, so no skip needed.
            watermarkOf: (e) => e.last_updated_ts,
        },
    );
}

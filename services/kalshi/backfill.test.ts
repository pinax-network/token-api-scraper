import { describe, expect, mock, test } from 'bun:test';
import {
    DRAINED_SENTINEL,
    POISONED_SENTINEL,
    runEventsBackfill,
    runMarketsBackfill,
    runPasses,
    runTradesBackfill,
} from './backfill';
import type { CursorCheckpoint } from './cursor';
import type { EventEntity, Market, Trade } from './types';

function trade(overrides: Partial<Trade>): Trade {
    return {
        trade_id: 't',
        ticker: 'KX-EX-1',
        created_time: '2026-03-01T00:00:00.000000Z',
        count_fp: '1.00',
        yes_price_dollars: '0.50',
        no_price_dollars: '0.50',
        taker_outcome_side: 'yes',
        taker_book_side: 'bid',
        ...overrides,
    };
}

interface PageSpec {
    trades: Trade[];
    cursor: string;
}

/** Build a fake KalshiClient whose `getTradesHistorical` walks a scripted set
 * of pages in order. Running off the end of the script throws to make
 * missing-stub failures loud. */
function fakeClient(pages: PageSpec[]) {
    let i = 0;
    const calls: Array<{ cursor: string | undefined }> = [];
    return {
        calls,
        getTradesHistorical: (params: { cursor?: string }) => {
            calls.push({ cursor: params.cursor });
            const p = pages[i++];
            if (!p) throw new Error(`fakeClient: no more pages (call #${i})`);
            return Promise.resolve(p);
        },
    } as unknown as Parameters<typeof runTradesBackfill>[0] & {
        calls: Array<{ cursor: string | undefined }>;
    };
}

/**
 * `flushSequence` is a list of per-call results — flushAll() pops one entry
 * per invocation. Default ([] every call) means "no rows, no error" matching
 * the real BatchInsertQueue's behavior on an empty queue. `healthSequence`
 * controls per-call `isHealthy()` return values (default true) — used to
 * simulate a lingering periodic-timer flush error between explicit flushes.
 */
function fakeQueue(
    flushSequence: Array<Array<'noop' | 'ok' | 'err'>> | undefined = undefined,
    healthSequence: boolean[] | undefined = undefined,
) {
    const rows: Array<{ table: string; row: unknown }> = [];
    const flushCalls: number[] = [];
    let i = 0;
    let h = 0;
    return {
        rows,
        flushCalls,
        add: (table: string, row: unknown) => {
            rows.push({ table, row });
            return Promise.resolve();
        },
        flushAll: () => {
            flushCalls.push(rows.length);
            const result = flushSequence?.[i++] ?? [];
            return Promise.resolve(result);
        },
        isHealthy: () => healthSequence?.[h++] ?? true,
    } as unknown as Parameters<typeof runTradesBackfill>[1] & {
        rows: Array<{ table: string; row: unknown }>;
        flushCalls: number[];
    };
}

function spyPersist() {
    return mock((_cursor: string, _iso: string) =>
        Promise.resolve(),
    ) as Parameters<typeof runTradesBackfill>[2] & {
        mock: { calls: Array<[string, string]> };
    };
}

describe('runTradesBackfill — cursor / page handling', () => {
    test('cold start sends no cursor on the first call', async () => {
        const t1 = trade({
            trade_id: 'a',
            created_time: '2026-03-02T00:00:00.000000Z',
        });
        const client = fakeClient([{ trades: [t1], cursor: '' }]);
        await runTradesBackfill(
            client,
            fakeQueue(),
            spyPersist(),
            undefined,
            undefined,
        );
        expect(client.calls[0]?.cursor).toBeUndefined();
    });

    test('resume passes the persisted cursor on the first call', async () => {
        const t1 = trade({
            trade_id: 'a',
            created_time: '2026-03-02T00:00:00.000000Z',
        });
        const client = fakeClient([{ trades: [t1], cursor: '' }]);
        await runTradesBackfill(
            client,
            fakeQueue(),
            spyPersist(),
            'resume-token',
            undefined,
        );
        expect(client.calls[0]?.cursor).toBe('resume-token');
    });
});

describe('runTradesBackfill — drained sentinel commit', () => {
    test('persists DRAINED_SENTINEL when last productive page has no next cursor', async () => {
        const t1 = trade({
            trade_id: 'a',
            created_time: '2026-03-02T00:00:00.000000Z',
        });
        const client = fakeClient([{ trades: [t1], cursor: '' }]);
        const persist = spyPersist();
        const result = await runTradesBackfill(
            client,
            fakeQueue(),
            persist,
            undefined,
            undefined,
        );
        expect(result.drained).toBe(true);
        expect(result.inserted).toBe(1);
        const lastCall = persist.mock.calls.at(-1);
        expect(lastCall?.[0]).toBe(DRAINED_SENTINEL);
        expect(lastCall?.[1]).toBe('2026-03-02T00:00:00.000000Z');
    });

    test('cold-start empty response defers to next cycle (does NOT commit DRAINED_SENTINEL)', async () => {
        const client = fakeClient([{ trades: [], cursor: '' }]);
        const persist = spyPersist();
        const result = await runTradesBackfill(
            client,
            fakeQueue(),
            persist,
            undefined,
            undefined,
        );
        expect(result.inserted).toBe(0);
        expect(result.drained).toBe(false);
        // No checkpoint written on empty input — the next cycle retries from
        // the cutoff. Committing the sentinel here would brick on a transient.
        expect(persist.mock.calls.length).toBe(0);
    });

    test('resume empty response defers to next cycle (does NOT overwrite cursor with DRAINED_SENTINEL)', async () => {
        const client = fakeClient([{ trades: [], cursor: '' }]);
        const persist = spyPersist();
        const result = await runTradesBackfill(
            client,
            fakeQueue(),
            persist,
            'resume-token',
            '2026-03-01T00:00:00.000000Z',
        );
        expect(result.drained).toBe(false);
        expect(persist.mock.calls.length).toBe(0);
    });
});

describe('runTradesBackfill — sentinel trade timestamps', () => {
    test('skips trades with `0001-01-01...` created_time instead of poisoning oldestSeen', async () => {
        const realTrade = trade({
            trade_id: 'real',
            created_time: '2026-03-02T00:00:00.000000Z',
        });
        const sentinelTrade = trade({
            trade_id: 'sent',
            created_time: '0001-01-01T00:00:00.000000Z',
        });
        const client = fakeClient([
            { trades: [realTrade, sentinelTrade], cursor: '' },
        ]);
        const queue = fakeQueue();
        const persist = spyPersist();
        const result = await runTradesBackfill(
            client,
            queue,
            persist,
            undefined,
            undefined,
        );
        // Only the real trade reaches the queue.
        expect(result.inserted).toBe(1);
        expect(queue.rows.length).toBe(1);
        expect(result.oldestSeen).toBe('2026-03-02T00:00:00.000000Z');
        // Sentinel did not poison the persisted watermark.
        expect(persist.mock.calls.at(-1)?.[1]).toBe(
            '2026-03-02T00:00:00.000000Z',
        );
    });
});

describe('runTradesBackfill — watermark', () => {
    test('oldestSeen is the min across all pages, not the last-page min', async () => {
        // Oldest is on the SECOND-to-last page so a buggy "last-page only"
        // impl would set the wrong value.
        const oldest = trade({
            trade_id: 'oldest',
            created_time: '2026-01-15T00:00:00.000000Z',
        });
        const middle = trade({
            trade_id: 'middle',
            created_time: '2026-03-01T12:00:00.000000Z',
        });
        const newest = trade({
            trade_id: 'newest',
            created_time: '2026-04-01T00:00:00.000000Z',
        });
        const client = fakeClient([
            { trades: [newest], cursor: 'c1' },
            { trades: [oldest], cursor: 'c2' },
            { trades: [middle], cursor: '' },
        ]);
        const result = await runTradesBackfill(
            client,
            fakeQueue(),
            spyPersist(),
            undefined,
            undefined,
        );
        expect(result.oldestSeen).toBe('2026-01-15T00:00:00.000000Z');
        expect(result.pages).toBe(3);
        expect(result.inserted).toBe(3);
    });

    test('seeds oldestSeen from caller-provided prior watermark', async () => {
        const t1 = trade({
            trade_id: 'a',
            // Newer than the prior watermark — must not overwrite oldestSeen.
            created_time: '2026-04-01T00:00:00.000000Z',
        });
        const client = fakeClient([{ trades: [t1], cursor: '' }]);
        const result = await runTradesBackfill(
            client,
            fakeQueue(),
            spyPersist(),
            undefined,
            '2026-02-01T00:00:00.000000Z',
        );
        expect(result.oldestSeen).toBe('2026-02-01T00:00:00.000000Z');
    });
});

describe('runTradesBackfill — durability', () => {
    test('flushes the queue before persisting the cursor advance', async () => {
        const t1 = trade({
            trade_id: 'a',
            created_time: '2026-03-02T00:00:00.000000Z',
        });
        const t2 = trade({
            trade_id: 'b',
            created_time: '2026-03-01T00:00:00.000000Z',
        });
        const client = fakeClient([
            { trades: [t1], cursor: 'next-1' },
            { trades: [t2], cursor: '' },
        ]);
        const queue = fakeQueue();
        const persist = mock((_c: string, _i: string) => Promise.resolve());

        // Track ordering: every persist call should be preceded by a
        // flushAll() with at least the page's rows already enqueued.
        let lastFlushRowCount = -1;
        const persistRowCountAtCallTime: number[] = [];
        persist.mockImplementation((_c, _i) => {
            persistRowCountAtCallTime.push(queue.rows.length);
            return Promise.resolve();
        });

        await runTradesBackfill(
            client,
            queue,
            persist as Parameters<typeof runTradesBackfill>[2],
            undefined,
            undefined,
        );

        // flushAll() called once per page (before each persist).
        expect(queue.flushCalls.length).toBe(2);
        // At each persist, the row count seen by persist equals what was
        // flushed (no rows added between flush and persist).
        for (let i = 0; i < persistRowCountAtCallTime.length; i++) {
            expect(queue.flushCalls[i]).toBe(persistRowCountAtCallTime[i]);
            lastFlushRowCount = queue.flushCalls[i] ?? lastFlushRowCount;
        }
        expect(lastFlushRowCount).toBe(2);
    });

    test('aborts the cycle and skips persist when flushAll reports err', async () => {
        const t1 = trade({
            trade_id: 'a',
            created_time: '2026-03-02T00:00:00.000000Z',
        });
        const client = fakeClient([{ trades: [t1], cursor: 'next-1' }]);
        const queue = fakeQueue([['err']]);
        const persist = spyPersist();
        await expect(
            runTradesBackfill(client, queue, persist, undefined, undefined),
        ).rejects.toThrow(/batch flush failed; cursor not advanced/);
        expect(persist.mock.calls.length).toBe(0);
    });

    test('aborts the cycle when an explicit flushAll is `ok` but queue.isHealthy() reports a lingering periodic-flush error', async () => {
        // Simulates: a periodic-timer flush failed between this page's add()
        // calls (setting `lastFlushError`), but the explicit flushAll our
        // walker calls happens to return `ok` (because the failed timer
        // already spliced + lost the prior batch). Without checking
        // isHealthy(), the walker would advance the cursor past lost rows.
        const t1 = trade({
            trade_id: 'a',
            created_time: '2026-03-02T00:00:00.000000Z',
        });
        const client = fakeClient([{ trades: [t1], cursor: 'next-1' }]);
        const queue = fakeQueue([['ok']], [false]);
        const persist = spyPersist();
        await expect(
            runTradesBackfill(client, queue, persist, undefined, undefined),
        ).rejects.toThrow(/batch flush failed; cursor not advanced/);
        expect(persist.mock.calls.length).toBe(0);
    });
});

describe('runTradesBackfill — loop quarantine', () => {
    test('throws on immediate self-loop (server returns the cursor we just sent)', async () => {
        const t = trade({ trade_id: 'a' });
        // Iter 1: cold start, send cursor=undefined, get 'loop'. Pass guard.
        // Iter 2: send 'loop', get 'loop'. nextCursor === cursor → throw.
        const client = fakeClient([
            { trades: [t], cursor: 'loop' },
            { trades: [t], cursor: 'loop' },
        ]);
        const persist = spyPersist();
        await expect(
            runTradesBackfill(
                client,
                fakeQueue(),
                persist,
                undefined,
                undefined,
            ),
        ).rejects.toThrow(/stale cursor back/);
        // POISONED_SENTINEL persisted before throw, so next cycle won't loop.
        const lastCall = persist.mock.calls.at(-1);
        expect(lastCall?.[0]).toBe(POISONED_SENTINEL);
    });

    test('throws on 2-hop cursor alternation (A → B → A)', async () => {
        const t = trade({ trade_id: 'a' });
        // Iter 1: send undefined, get 'A'. prevCursor=undefined, cursor='A'.
        // Iter 2: send 'A', get 'B'. prevCursor='A', cursor='B'.
        // Iter 3: send 'B', get 'A'. nextCursor === prevCursor ('A') → throw.
        const client = fakeClient([
            { trades: [t], cursor: 'A' },
            { trades: [t], cursor: 'B' },
            { trades: [t], cursor: 'A' },
        ]);
        await expect(
            runTradesBackfill(
                client,
                fakeQueue(),
                spyPersist(),
                undefined,
                undefined,
            ),
        ).rejects.toThrow(/stale cursor back/);
    });

    test('skips quarantine if the page flush also failed so rows can be re-fetched on retry', async () => {
        const t = trade({ trade_id: 'a' });
        // Iter 1: send undefined, get 'loop'. Normal path: flushAll → ['ok'].
        // Iter 2: send 'loop', get 'loop'. Self-loop detected → quarantine
        //         path runs flushAll which returns ['err'] in this test.
        const client = fakeClient([
            { trades: [t], cursor: 'loop' },
            { trades: [t], cursor: 'loop' },
        ]);
        const queue = fakeQueue([['ok'], ['err']]);
        const persist = spyPersist();
        await expect(
            runTradesBackfill(client, queue, persist, undefined, undefined),
        ).rejects.toThrow(/stale cursor back AND batch flush failed/);
        // POISONED_SENTINEL is NOT persisted when the flush failed —
        // otherwise the spliced-out rows would be lost on retry.
        for (const call of persist.mock.calls) {
            expect(call[0]).not.toBe(POISONED_SENTINEL);
        }
    });
});

describe('runTradesBackfill — defensive sentinel input', () => {
    test('throws if called directly with DRAINED_SENTINEL as initialCursor', async () => {
        const client = fakeClient([]);
        await expect(
            runTradesBackfill(
                client,
                fakeQueue(),
                spyPersist(),
                DRAINED_SENTINEL,
                undefined,
            ),
        ).rejects.toThrow(/sentinel cursor/);
    });

    test('throws if called directly with POISONED_SENTINEL as initialCursor', async () => {
        const client = fakeClient([]);
        await expect(
            runTradesBackfill(
                client,
                fakeQueue(),
                spyPersist(),
                POISONED_SENTINEL,
                undefined,
            ),
        ).rejects.toThrow(/sentinel cursor/);
    });
});

// ---------------------------------------------------------------------------
// Markets pass — mirrors a slim subset of the trades suite to validate the
// generic walker is correctly parameterized for /historical/markets. The
// trades suite covers the shared cursor / flush / quarantine machinery; here
// we only re-prove what's pass-specific: endpoint, mapper, skip predicate,
// and watermark source.
// ---------------------------------------------------------------------------

function market(overrides: Partial<Market>): Market {
    return {
        ticker: 'KXEX-1',
        event_ticker: 'KXEX',
        market_type: 'binary',
        status: 'finalized',
        title: 'Example',
        created_time: '2026-03-01T00:00:00.000000Z',
        updated_time: '2026-03-02T00:00:00.000000Z',
        yes_bid_dollars: '0.50',
        yes_ask_dollars: '0.50',
        no_bid_dollars: '0.50',
        no_ask_dollars: '0.50',
        last_price_dollars: '0.50',
        ...overrides,
    };
}

interface MarketsPageSpec {
    markets: Market[];
    cursor: string;
}

function fakeMarketsClient(pages: MarketsPageSpec[]) {
    let i = 0;
    const calls: Array<{ cursor: string | undefined }> = [];
    return {
        calls,
        getMarketsHistorical: (params: { cursor?: string }) => {
            calls.push({ cursor: params.cursor });
            const p = pages[i++];
            if (!p) throw new Error(`fakeClient: no more pages (call #${i})`);
            return Promise.resolve(p);
        },
    } as unknown as Parameters<typeof runMarketsBackfill>[0] & {
        calls: Array<{ cursor: string | undefined }>;
    };
}

describe('runMarketsBackfill', () => {
    test('cold start sends no cursor and writes to the markets table', async () => {
        const m = market({ ticker: 'KXEX-A' });
        const client = fakeMarketsClient([{ markets: [m], cursor: '' }]);
        const queue = fakeQueue();
        const persist = spyPersist();
        const result = await runMarketsBackfill(
            client,
            queue,
            persist,
            undefined,
            undefined,
        );
        expect(client.calls[0]?.cursor).toBeUndefined();
        expect(result.drained).toBe(true);
        expect(queue.rows.at(-1)?.table).toBe('markets');
        expect(persist.mock.calls.at(-1)?.[0]).toBe(DRAINED_SENTINEL);
    });

    test('skips markets with sentinel created_time AND sentinel updated_time', async () => {
        const realMarket = market({ ticker: 'KXEX-REAL' });
        const sentinelCreated = market({
            ticker: 'KXEX-SC',
            created_time: '0001-01-01T00:00:00.000000Z',
        });
        const sentinelUpdated = market({
            ticker: 'KXEX-SU',
            updated_time: '0001-01-01T00:00:00.000000Z',
        });
        const client = fakeMarketsClient([
            {
                markets: [realMarket, sentinelCreated, sentinelUpdated],
                cursor: '',
            },
        ]);
        const queue = fakeQueue();
        const result = await runMarketsBackfill(
            client,
            queue,
            spyPersist(),
            undefined,
            undefined,
        );
        expect(result.inserted).toBe(1);
        expect(queue.rows.length).toBe(1);
    });

    test('watermark advances to the oldest created_time seen across pages', async () => {
        const oldest = market({
            ticker: 'KXEX-OLD',
            created_time: '2026-01-15T00:00:00.000000Z',
        });
        const newer = market({
            ticker: 'KXEX-NEW',
            created_time: '2026-04-01T00:00:00.000000Z',
        });
        const client = fakeMarketsClient([
            { markets: [newer], cursor: 'c1' },
            { markets: [oldest], cursor: '' },
        ]);
        const result = await runMarketsBackfill(
            client,
            fakeQueue(),
            spyPersist(),
            undefined,
            undefined,
        );
        expect(result.oldestSeen).toBe('2026-01-15T00:00:00.000000Z');
    });

    test('quarantines on cursor loop and persists POISONED_SENTINEL', async () => {
        const m = market({ ticker: 'KXEX-LOOP' });
        const client = fakeMarketsClient([
            { markets: [m], cursor: 'loop' },
            { markets: [m], cursor: 'loop' },
        ]);
        const persist = spyPersist();
        await expect(
            runMarketsBackfill(
                client,
                fakeQueue(),
                persist,
                undefined,
                undefined,
            ),
        ).rejects.toThrow(/stale cursor back/);
        expect(persist.mock.calls.at(-1)?.[0]).toBe(POISONED_SENTINEL);
    });
});

// ---------------------------------------------------------------------------
// Events pass — events have an optional `last_updated_ts`, no skip predicate,
// and write to the events table.
// ---------------------------------------------------------------------------

function eventItem(overrides: Partial<EventEntity>): EventEntity {
    return {
        event_ticker: 'KXEX-EVT',
        series_ticker: 'KXEX',
        title: 'Example event',
        last_updated_ts: '2026-03-01T00:00:00.000000Z',
        ...overrides,
    };
}

interface EventsPageSpec {
    events: EventEntity[];
    cursor: string;
}

function fakeEventsClient(pages: EventsPageSpec[]) {
    let i = 0;
    const calls: Array<{ cursor: string | undefined }> = [];
    return {
        calls,
        getEvents: (params: { cursor?: string; min_updated_ts?: number }) => {
            calls.push({ cursor: params.cursor });
            if (params.min_updated_ts !== undefined) {
                throw new Error(
                    'events backfill must not send min_updated_ts (would gate to recent only)',
                );
            }
            const p = pages[i++];
            if (!p) throw new Error(`fakeClient: no more pages (call #${i})`);
            return Promise.resolve(p);
        },
    } as unknown as Parameters<typeof runEventsBackfill>[0] & {
        calls: Array<{ cursor: string | undefined }>;
    };
}

describe('runEventsBackfill', () => {
    test('cold start sends no cursor and no min_updated_ts; writes to events', async () => {
        const e = eventItem({ event_ticker: 'KXEX-A' });
        const client = fakeEventsClient([{ events: [e], cursor: '' }]);
        const queue = fakeQueue();
        const persist = spyPersist();
        const result = await runEventsBackfill(
            client,
            queue,
            persist,
            undefined,
            undefined,
        );
        expect(client.calls[0]?.cursor).toBeUndefined();
        expect(result.drained).toBe(true);
        expect(queue.rows.at(-1)?.table).toBe('events');
        expect(persist.mock.calls.at(-1)?.[0]).toBe(DRAINED_SENTINEL);
    });

    test('events without last_updated_ts do not crash the pass — watermark falls back', async () => {
        const e = eventItem({ event_ticker: 'KXEX-NO-TS' });
        e.last_updated_ts = undefined;
        const client = fakeEventsClient([{ events: [e], cursor: '' }]);
        const persist = spyPersist();
        const result = await runEventsBackfill(
            client,
            fakeQueue(),
            persist,
            undefined,
            undefined,
        );
        expect(result.inserted).toBe(1);
        // Last persist call still happened with DRAINED + a fallback ISO
        // string (now()-derived) — the watermark column is non-null.
        const lastCall = persist.mock.calls.at(-1);
        expect(lastCall?.[0]).toBe(DRAINED_SENTINEL);
        expect(lastCall?.[1]).toMatch(/^2\d{3}-/);
    });
});

// ---------------------------------------------------------------------------
// runPasses — sequential vs parallel orchestration. The shared per-pass
// machinery is already covered above; here we only assert the cross-pass
// scheduling + error-handling semantics that differ between modes.
// ---------------------------------------------------------------------------

interface GateClient {
    getTradesHistorical: () => Promise<{ trades: Trade[]; cursor: string }>;
    getMarketsHistorical: () => Promise<{ markets: Market[]; cursor: string }>;
    getEvents: (params: {
        min_updated_ts?: number;
        cursor?: string;
    }) => Promise<{ events: EventEntity[]; cursor: string }>;
}

/** Promise that resolves only when `release()` is called. Tracks observers
 * for assertions like "did this fetch even start?". */
function gate<T>(value: T) {
    let resolveFn!: () => void;
    let started = false;
    const promise = new Promise<T>((res) => {
        resolveFn = () => res(value);
    });
    return {
        wait: () => {
            started = true;
            return promise;
        },
        release: () => resolveFn(),
        get started() {
            return started;
        },
    };
}

async function flushMicrotasks(n = 8): Promise<void> {
    for (let i = 0; i < n; i++) {
        await Promise.resolve();
    }
}

const EMPTY_CURSORS = new Map<string, CursorCheckpoint>();

describe('runPasses — scheduling', () => {
    test('parallel mode kicks off all three passes before any completes', async () => {
        const tradesGate = gate({ trades: [], cursor: '' });
        const marketsGate = gate({ markets: [], cursor: '' });
        const eventsGate = gate({ events: [], cursor: '' });
        const client: GateClient = {
            getTradesHistorical: () => tradesGate.wait(),
            getMarketsHistorical: () => marketsGate.wait(),
            getEvents: () => eventsGate.wait(),
        };

        const promise = runPasses(
            client as unknown as Parameters<typeof runPasses>[0],
            fakeQueue(),
            EMPTY_CURSORS,
            true,
        );
        await flushMicrotasks();

        // All three fetchPage calls have hit the gate before any resolved.
        expect(tradesGate.started).toBe(true);
        expect(marketsGate.started).toBe(true);
        expect(eventsGate.started).toBe(true);

        tradesGate.release();
        marketsGate.release();
        eventsGate.release();
        await promise;
    });

    test('sequential mode runs passes one at a time', async () => {
        const tradesGate = gate({ trades: [], cursor: '' });
        const marketsGate = gate({ markets: [], cursor: '' });
        const eventsGate = gate({ events: [], cursor: '' });
        const client: GateClient = {
            getTradesHistorical: () => tradesGate.wait(),
            getMarketsHistorical: () => marketsGate.wait(),
            getEvents: () => eventsGate.wait(),
        };

        const promise = runPasses(
            client as unknown as Parameters<typeof runPasses>[0],
            fakeQueue(),
            EMPTY_CURSORS,
            false,
        );
        await flushMicrotasks();

        // Only trades has started — markets + events must wait.
        expect(tradesGate.started).toBe(true);
        expect(marketsGate.started).toBe(false);
        expect(eventsGate.started).toBe(false);

        tradesGate.release();
        await flushMicrotasks();
        expect(marketsGate.started).toBe(true);
        expect(eventsGate.started).toBe(false);

        marketsGate.release();
        await flushMicrotasks();
        expect(eventsGate.started).toBe(true);

        eventsGate.release();
        await promise;
    });
});

describe('runPasses — error propagation', () => {
    test('parallel mode: failure in one pass does NOT cancel the others', async () => {
        let marketsStarted = false;
        let eventsStarted = false;
        const client = {
            getTradesHistorical: () => Promise.reject(new Error('trades boom')),
            getMarketsHistorical: () => {
                marketsStarted = true;
                return Promise.resolve({ markets: [], cursor: '' });
            },
            getEvents: (_p: { min_updated_ts?: number; cursor?: string }) => {
                eventsStarted = true;
                return Promise.resolve({ events: [], cursor: '' });
            },
        };

        await expect(
            runPasses(
                client as unknown as Parameters<typeof runPasses>[0],
                fakeQueue(),
                EMPTY_CURSORS,
                true,
            ),
        ).rejects.toThrow(/trades boom/);

        // markets + events still ran to completion (their fetches happened)
        // even though trades rejected first — `allSettled` semantic.
        expect(marketsStarted).toBe(true);
        expect(eventsStarted).toBe(true);
    });

    test('sequential mode: failure in one pass halts subsequent passes', async () => {
        let marketsStarted = false;
        let eventsStarted = false;
        const client = {
            getTradesHistorical: () => Promise.reject(new Error('trades boom')),
            getMarketsHistorical: () => {
                marketsStarted = true;
                return Promise.resolve({ markets: [], cursor: '' });
            },
            getEvents: (_p: { min_updated_ts?: number; cursor?: string }) => {
                eventsStarted = true;
                return Promise.resolve({ events: [], cursor: '' });
            },
        };

        await expect(
            runPasses(
                client as unknown as Parameters<typeof runPasses>[0],
                fakeQueue(),
                EMPTY_CURSORS,
                false,
            ),
        ).rejects.toThrow(/trades boom/);

        // Sequential mode short-circuits on first failure.
        expect(marketsStarted).toBe(false);
        expect(eventsStarted).toBe(false);
    });

    test('error carries the failing pass label (parallel)', async () => {
        const client = {
            getTradesHistorical: () =>
                Promise.resolve({ trades: [], cursor: '' }),
            getMarketsHistorical: () =>
                Promise.reject(new Error('markets boom')),
            getEvents: () => Promise.resolve({ events: [], cursor: '' }),
        };

        try {
            await runPasses(
                client as unknown as Parameters<typeof runPasses>[0],
                fakeQueue(),
                EMPTY_CURSORS,
                true,
            );
            throw new Error('expected runPasses to throw');
        } catch (e) {
            expect((e as Error & { pass?: string }).pass).toBe('markets');
        }
    });
});

describe('runPasses — sentinel short-circuits apply in both modes', () => {
    function buildClient() {
        const tradesCalled = { v: false };
        const marketsCalled = { v: false };
        const eventsCalled = { v: false };
        const client = {
            getTradesHistorical: () => {
                tradesCalled.v = true;
                return Promise.resolve({ trades: [], cursor: '' });
            },
            getMarketsHistorical: () => {
                marketsCalled.v = true;
                return Promise.resolve({ markets: [], cursor: '' });
            },
            getEvents: (_p: { min_updated_ts?: number; cursor?: string }) => {
                eventsCalled.v = true;
                return Promise.resolve({ events: [], cursor: '' });
            },
        };
        return { client, tradesCalled, marketsCalled, eventsCalled };
    }

    function buildCursors(
        overrides: Record<string, Partial<CursorCheckpoint>> = {},
    ): Map<string, CursorCheckpoint> {
        const m = new Map<string, CursorCheckpoint>();
        for (const [scope, partial] of Object.entries(overrides)) {
            m.set(scope, {
                scope,
                last_cursor: '',
                last_processed_ts_ms: 0,
                last_processed_ts_iso: '2026-01-01T00:00:00.000000Z',
                ...partial,
            });
        }
        return m;
    }

    for (const parallel of [true, false]) {
        test(`drained scope is skipped (parallel=${parallel})`, async () => {
            const { client, tradesCalled, marketsCalled, eventsCalled } =
                buildClient();
            const cursors = buildCursors({
                trades_backfill: { last_cursor: DRAINED_SENTINEL },
            });
            await runPasses(
                client as unknown as Parameters<typeof runPasses>[0],
                fakeQueue(),
                cursors,
                parallel,
            );
            expect(tradesCalled.v).toBe(false);
            expect(marketsCalled.v).toBe(true);
            expect(eventsCalled.v).toBe(true);
        });

        test(`poisoned scope is skipped (parallel=${parallel})`, async () => {
            const { client, tradesCalled, marketsCalled, eventsCalled } =
                buildClient();
            const cursors = buildCursors({
                markets_backfill: { last_cursor: POISONED_SENTINEL },
            });
            await runPasses(
                client as unknown as Parameters<typeof runPasses>[0],
                fakeQueue(),
                cursors,
                parallel,
            );
            expect(tradesCalled.v).toBe(true);
            expect(marketsCalled.v).toBe(false);
            expect(eventsCalled.v).toBe(true);
        });
    }
});

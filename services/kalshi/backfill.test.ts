import { describe, expect, mock, test } from 'bun:test';
import {
    DRAINED_SENTINEL,
    POISONED_SENTINEL,
    runTradesBackfill,
} from './backfill';
import type { Trade } from './types';

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

function fakeQueue() {
    const rows: Array<{ table: string; row: unknown }> = [];
    const flushCalls: number[] = [];
    return {
        rows,
        flushCalls,
        add: (table: string, row: unknown) => {
            rows.push({ table, row });
            return Promise.resolve();
        },
        flushAll: () => {
            flushCalls.push(rows.length);
            return Promise.resolve([]);
        },
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

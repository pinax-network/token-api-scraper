import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const mockInsert = mock(() => Promise.resolve());
const mockQuery = mock(() =>
    Promise.resolve({
        data: [] as { outcome_id: string }[],
        metrics: { httpRequestTimeMs: 0, dataFetchTimeMs: 0, totalTimeMs: 0 },
    }),
);
const mockIncrementSuccess = mock(() => {});
const mockIncrementError = mock(() => {});
const mockInitService = mock(() => {});
const mockMarkServiceAlive = mock(() => {});

// Mock only the `lib/clickhouse` exports this service imports
// (`insertClient` + `query`). `mock.module` is process-wide, so providing
// fields beyond what's needed would risk shadowing real exports for other
// suites.
mock.module('../../lib/clickhouse', () => ({
    insertClient: { insert: mockInsert },
    query: mockQuery,
}));

mock.module('../../lib/prometheus', () => ({
    incrementSuccess: mockIncrementSuccess,
    incrementError: mockIncrementError,
}));

mock.module('../../lib/service-init', () => ({
    initService: mockInitService,
    markServiceAlive: mockMarkServiceAlive,
}));

const liveBody = {
    outcomes: [
        {
            outcome: 104,
            name: 'June Fed rate change',
            description: 'Resolves to ...',
            sideSpecs: [{ name: 'Change' }, { name: 'No Change' }],
            quoteToken: 'USDC',
        },
        {
            outcome: 172,
            name: 'Algeria',
            description: 'Resolves Yes if ...',
            sideSpecs: [{ name: 'Yes' }, { name: 'No' }],
            quoteToken: 'USDC',
        },
    ],
    questions: [
        {
            question: 32,
            name: '2026 World Cup Champion',
            description: 'Each ...',
            fallbackOutcome: 171,
            namedOutcomes: [172],
            settledNamedOutcomes: [],
        },
    ],
};

const settledBody = {
    spec: {
        outcome: 0,
        name: 'Recurring',
        description: 'class:priceBinary|underlying:BTC',
        sideSpecs: [{ name: 'Yes' }, { name: 'No' }],
        quoteToken: 'USDH',
    },
    settleFraction: '0.0',
    details: 'price:78212.4',
};

interface InsertCallArg {
    table: string;
    values: Array<Record<string, unknown>>;
    format: string;
}

/**
 * Build a `mockQuery` implementation that routes to different result sets
 * depending on which CH table the SQL references. Tests need this because
 * the service fires two reads per cycle — `outcome_fills` for the known
 * universe and `state_outcome_meta` for already-settled ids — and feeding
 * both the same rows would mark every known id as already-settled and
 * suppress the settled-lookup probes the test is verifying.
 */
function mockQueryRouter(routes: {
    knownIds?: string[];
    alreadySettled?: string[];
}) {
    return (sql: string) => {
        let rows: { outcome_id: string }[] = [];
        if (sql.includes('outcome_fills')) {
            rows = (routes.knownIds ?? []).map((id) => ({ outcome_id: id }));
        } else if (sql.includes('state_outcome_meta')) {
            rows = (routes.alreadySettled ?? []).map((id) => ({
                outcome_id: id,
            }));
        }
        return Promise.resolve({
            data: rows,
            metrics: {
                httpRequestTimeMs: 0,
                dataFetchTimeMs: 0,
                totalTimeMs: 0,
            },
        });
    };
}

describe('hyperliquid-outcomes run()', () => {
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.HYPERLIQUID_INFO_URL;

    beforeEach(() => {
        mockInsert.mockClear();
        mockQuery.mockClear();
        mockIncrementSuccess.mockClear();
        mockIncrementError.mockClear();
        mockInitService.mockClear();
        mockMarkServiceAlive.mockClear();
        mockQuery.mockImplementation(() =>
            Promise.resolve({
                data: [] as { outcome_id: string }[],
                metrics: {
                    httpRequestTimeMs: 0,
                    dataFetchTimeMs: 0,
                    totalTimeMs: 0,
                },
            }),
        );
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        if (originalUrl === undefined) {
            delete process.env.HYPERLIQUID_INFO_URL;
        } else {
            process.env.HYPERLIQUID_INFO_URL = originalUrl;
        }
    });

    test('throws when HYPERLIQUID_INFO_URL is unset', async () => {
        delete process.env.HYPERLIQUID_INFO_URL;
        const { run } = await import('./index');
        await expect(run()).rejects.toThrow(/HYPERLIQUID_INFO_URL/);
    });

    test('inserts live + settled outcomes and questions in one cycle', async () => {
        process.env.HYPERLIQUID_INFO_URL = 'http://example/info';
        // outcome_fills knows 104, 172, and a settled 0 — 0 is missing from
        // the live snapshot and not in already-settled, so the cycle must
        // probe settledOutcome for it.
        mockQuery.mockImplementation(
            mockQueryRouter({
                knownIds: ['104', '172', '0'],
                alreadySettled: [],
            }),
        );

        globalThis.fetch = mock((_url: string, init: RequestInit) => {
            const body = JSON.parse(init.body as string);
            if (body.type === 'outcomeMeta') {
                return Promise.resolve(
                    new Response(JSON.stringify(liveBody), { status: 200 }),
                );
            }
            if (body.type === 'settledOutcome' && body.outcome === 0) {
                return Promise.resolve(
                    new Response(JSON.stringify(settledBody), { status: 200 }),
                );
            }
            return Promise.resolve(new Response('null', { status: 200 }));
        }) as unknown as typeof fetch;

        const { run } = await import('./index');
        await run();

        expect(mockInsert).toHaveBeenCalledTimes(2);
        const calls = mockInsert.mock.calls.map((c) => c[0] as InsertCallArg);

        const outcomeCall = calls.find((c) => c.table === 'state_outcome_meta');
        const questionCall = calls.find(
            (c) => c.table === 'state_question_meta',
        );
        expect(outcomeCall).toBeDefined();
        expect(questionCall).toBeDefined();
        expect(outcomeCall!.format).toBe('JSONEachRow');

        // 2 live + 1 settled
        expect(outcomeCall!.values).toHaveLength(3);
        const live104 = outcomeCall!.values.find((r) => r.outcome_id === 104);
        const settled0 = outcomeCall!.values.find((r) => r.outcome_id === 0);
        const live172 = outcomeCall!.values.find((r) => r.outcome_id === 172);
        expect(live104?.status).toBe('live');
        expect(settled0?.status).toBe('settled');
        expect(settled0?.settle_fraction).toBe(0);
        expect(settled0?.settle_details).toBe('price:78212.4');
        // 172 belongs to question 32 via namedOutcomes — reverse map must apply.
        expect(live172?.question_id).toBe(32);
        // 104 is standalone.
        expect(live104?.question_id).toBeNull();

        expect(questionCall!.values).toHaveLength(1);
        expect(questionCall!.values[0]!.question_id).toBe(32);

        expect(mockIncrementSuccess).toHaveBeenCalledTimes(1);
        expect(mockIncrementError).not.toHaveBeenCalled();
        // Direct-insert services bump the wall-clock heartbeat so the
        // liveness probe reflects progress (batch queue is unused here).
        expect(mockMarkServiceAlive).toHaveBeenCalledTimes(1);
    });

    test('proceeds when known-ids query fails (cold cluster)', async () => {
        process.env.HYPERLIQUID_INFO_URL = 'http://example/info';
        mockQuery.mockImplementation(() =>
            Promise.reject(new Error('table not found')),
        );
        globalThis.fetch = mock(() =>
            Promise.resolve(
                new Response(JSON.stringify(liveBody), { status: 200 }),
            ),
        ) as unknown as typeof fetch;

        const { run } = await import('./index');
        await run();

        // Still inserted live outcomes + questions.
        expect(mockInsert).toHaveBeenCalledTimes(2);
        expect(mockIncrementSuccess).toHaveBeenCalledTimes(1);
        expect(mockIncrementError).not.toHaveBeenCalled();
    });

    test('continues past per-id settledOutcome failures without aborting the cycle', async () => {
        process.env.HYPERLIQUID_INFO_URL = 'http://example/info';
        mockQuery.mockImplementation(
            mockQueryRouter({
                knownIds: ['999'],
                alreadySettled: [],
            }),
        );
        globalThis.fetch = mock((_url: string, init: RequestInit) => {
            const body = JSON.parse(init.body as string);
            if (body.type === 'outcomeMeta') {
                return Promise.resolve(
                    new Response(JSON.stringify(liveBody), { status: 200 }),
                );
            }
            // settledOutcome lookups fail — cycle should still complete with
            // the live snapshot.
            return Promise.resolve(new Response('boom', { status: 502 }));
        }) as unknown as typeof fetch;

        const { run } = await import('./index');
        await run();

        expect(mockInsert).toHaveBeenCalledTimes(2);
        const outcomeCall = mockInsert.mock.calls
            .map((c) => c[0] as InsertCallArg)
            .find((c) => c.table === 'state_outcome_meta');
        // Only the 2 live outcomes — settled lookup failed and was skipped.
        expect(outcomeCall!.values).toHaveLength(2);
        expect(mockIncrementSuccess).toHaveBeenCalledTimes(1);
    });

    test('skips settledOutcome probes for ids already captured as settled', async () => {
        process.env.HYPERLIQUID_INFO_URL = 'http://example/info';
        // outcome_fills has 104, 172, and a historically-settled 0; but our
        // own `state_outcome_meta` already contains 0 with status='settled',
        // so the cycle must NOT re-probe HL for it.
        mockQuery.mockImplementation(
            mockQueryRouter({
                knownIds: ['104', '172', '0'],
                alreadySettled: ['0'],
            }),
        );
        const settledProbed: number[] = [];
        globalThis.fetch = mock((_url: string, init: RequestInit) => {
            const body = JSON.parse(init.body as string);
            if (body.type === 'outcomeMeta') {
                return Promise.resolve(
                    new Response(JSON.stringify(liveBody), { status: 200 }),
                );
            }
            if (body.type === 'settledOutcome') {
                settledProbed.push(body.outcome);
            }
            return Promise.resolve(new Response('null', { status: 200 }));
        }) as unknown as typeof fetch;

        const { run } = await import('./index');
        await run();

        expect(settledProbed).toEqual([]);
        const outcomeCall = mockInsert.mock.calls
            .map((c) => c[0] as InsertCallArg)
            .find((c) => c.table === 'state_outcome_meta');
        // Only the 2 live outcomes inserted this cycle — settled 0 stayed in
        // the table from the prior cycle's insert (RMT keeps the older row).
        expect(outcomeCall!.values).toHaveLength(2);
        expect(mockIncrementSuccess).toHaveBeenCalledTimes(1);
        expect(mockMarkServiceAlive).toHaveBeenCalledTimes(1);
    });

    test('returns early without success metric when outcomeMeta is empty', async () => {
        process.env.HYPERLIQUID_INFO_URL = 'http://example/info';
        globalThis.fetch = mock(() =>
            Promise.resolve(
                new Response(JSON.stringify({ outcomes: [], questions: [] }), {
                    status: 200,
                }),
            ),
        ) as unknown as typeof fetch;

        const { run } = await import('./index');
        await run();

        // Empty universe is a soft anomaly — don't insert, don't claim
        // success, but also don't throw. Next cycle retries.
        expect(mockInsert).not.toHaveBeenCalled();
        expect(mockIncrementSuccess).not.toHaveBeenCalled();
        expect(mockIncrementError).not.toHaveBeenCalled();
        expect(mockMarkServiceAlive).not.toHaveBeenCalled();
    });

    test('records an error metric and rethrows when outcomeMeta fetch fails', async () => {
        process.env.HYPERLIQUID_INFO_URL = 'http://example/info';
        globalThis.fetch = mock(() =>
            Promise.resolve(new Response('nope', { status: 502 })),
        ) as unknown as typeof fetch;

        const { run } = await import('./index');
        await expect(run()).rejects.toThrow();
        expect(mockIncrementError).toHaveBeenCalledTimes(1);
        expect(mockInsert).not.toHaveBeenCalled();
        // Liveness heartbeat must NOT advance on a failed cycle, so silent
        // upstream failures still surface via the `/live` probe.
        expect(mockMarkServiceAlive).not.toHaveBeenCalled();
    });
});

import { afterEach, describe, expect, mock, test } from 'bun:test';
import { KalshiClient } from './client';

const originalFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = originalFetch;
});

function mockJson(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response;
}

/** Install a fetch mock for the current test; returns the mock for assertions. */
function installFetch(
    impl: (url: string) => Promise<Response>,
): ReturnType<typeof mock> {
    const m = mock(impl);
    globalThis.fetch = m as unknown as typeof fetch;
    return m;
}

const fastClient = (overrides: Record<string, unknown> = {}) =>
    new KalshiClient({
        baseDelayMs: 1,
        maxDelayMs: 5,
        requestTimeoutMs: 1000,
        ...overrides,
    });

describe('KalshiClient.get', () => {
    test('returns parsed JSON on first success', async () => {
        const m = installFetch(() => Promise.resolve(mockJson({ ok: 1 })));
        const out = await fastClient({ maxRetries: 0 }).get<{ ok: number }>(
            '/test',
        );
        expect(out).toEqual({ ok: 1 });
        expect(m).toHaveBeenCalledTimes(1);
    });

    test('retries on 429 with exponential backoff up to maxRetries', async () => {
        let calls = 0;
        installFetch(() => {
            calls++;
            return Promise.resolve(
                calls < 3
                    ? mockJson({ msg: 'rate-limited' }, 429)
                    : mockJson({ ok: 1 }),
            );
        });
        const out = await fastClient({ maxRetries: 5 }).get<{ ok: number }>(
            '/test',
        );
        expect(out).toEqual({ ok: 1 });
        expect(calls).toBe(3);
    });

    test('retries on 503 and other transient 5xx', async () => {
        let calls = 0;
        installFetch(() => {
            calls++;
            return Promise.resolve(
                calls < 2
                    ? mockJson({ msg: 'busy' }, 503)
                    : mockJson({ ok: 1 }),
            );
        });
        await fastClient({ maxRetries: 3 }).get('/test');
        expect(calls).toBe(2);
    });

    test('does NOT retry on 400 bad request', async () => {
        let calls = 0;
        installFetch(() => {
            calls++;
            return Promise.resolve(mockJson({ msg: 'bad' }, 400));
        });
        await expect(
            fastClient({ maxRetries: 5 }).get('/test'),
        ).rejects.toThrow(/Kalshi 400 on GET \/test/);
        expect(calls).toBe(1);
    });

    test('does NOT retry on 404', async () => {
        let calls = 0;
        installFetch(() => {
            calls++;
            return Promise.resolve(mockJson({ msg: 'nope' }, 404));
        });
        await expect(
            fastClient({ maxRetries: 5 }).get('/test'),
        ).rejects.toThrow(/Kalshi 404 on GET \/test/);
        expect(calls).toBe(1);
    });

    test('gives up after maxRetries and surfaces the last response body', async () => {
        const m = installFetch(() =>
            Promise.resolve(mockJson({ msg: 'still busy' }, 503)),
        );
        await expect(
            fastClient({ maxRetries: 2 }).get('/test'),
        ).rejects.toThrow(/Kalshi 503/);
        // attempts = maxRetries + 1 (initial + retries)
        expect(m).toHaveBeenCalledTimes(3);
    });

    test('retries on transport errors (fetch failed)', async () => {
        let calls = 0;
        installFetch(() => {
            calls++;
            if (calls < 2) return Promise.reject(new Error('fetch failed'));
            return Promise.resolve(mockJson({ ok: 1 }));
        });
        const out = await fastClient({ maxRetries: 3 }).get<{ ok: number }>(
            '/test',
        );
        expect(out).toEqual({ ok: 1 });
        expect(calls).toBe(2);
    });

    test('does NOT retry on non-transient errors (TypeError, syntax errors, etc.)', async () => {
        let calls = 0;
        installFetch(() => {
            calls++;
            return Promise.reject(new TypeError('unexpected token in JSON'));
        });
        await expect(
            fastClient({ maxRetries: 5 }).get('/test'),
        ).rejects.toThrow(/unexpected token/);
        expect(calls).toBe(1);
    });

    test('drops undefined/empty params from the query string', async () => {
        let captured: string | undefined;
        installFetch((url) => {
            captured = url;
            return Promise.resolve(mockJson({ ok: 1 }));
        });
        await fastClient().get('/test', {
            limit: 100,
            ticker: '',
            cursor: undefined,
        });
        expect(captured).toMatch(/limit=100/);
        expect(captured).not.toMatch(/ticker=/);
        expect(captured).not.toMatch(/cursor=/);
    });
});

describe('per-endpoint defaults', () => {
    test('getTradesLive defaults limit=1000', async () => {
        let captured: string | undefined;
        installFetch((url) => {
            captured = url;
            return Promise.resolve(mockJson({ trades: [], cursor: '' }));
        });
        await fastClient().getTradesLive();
        expect(captured).toMatch(/\/markets\/trades\?limit=1000/);
    });

    test('getEvents defaults limit=200 (server max)', async () => {
        let captured: string | undefined;
        installFetch((url) => {
            captured = url;
            return Promise.resolve(mockJson({ events: [], cursor: '' }));
        });
        await fastClient().getEvents();
        expect(captured).toMatch(/\/events\?limit=200/);
    });

    test('getBulkCandlesticks joins market_tickers with commas', async () => {
        let captured: string | undefined;
        installFetch((url) => {
            captured = url;
            return Promise.resolve(mockJson({ markets: [] }));
        });
        await fastClient().getBulkCandlesticks({
            market_tickers: ['A', 'B', 'C'],
            start_ts: 100,
            end_ts: 200,
            period_interval: 1,
        });
        expect(captured).toMatch(/market_tickers=A%2CB%2CC/);
    });
});

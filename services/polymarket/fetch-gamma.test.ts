import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
    fetchEventFromApi,
    fetchGammaApi,
    fetchMarketFromApi,
    fetchMarketsFromApi,
} from './gamma';

// LOG_LEVEL=error keeps warn/info noise out of the test output.
process.env.LOG_LEVEL = 'error';

const mockFetch = mock(() =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ markets: [], events: [] }),
    }),
);
globalThis.fetch = mockFetch as unknown as typeof fetch;

const conditionId = (i: number) => `0x${i.toString(16).padStart(64, '0')}`;

const marketStub = (id: number) => ({
    id: String(id),
    conditionId: conditionId(id),
    question: `Q${id}`,
});

describe('fetchGammaApi', () => {
    beforeEach(() => {
        mockFetch.mockClear();
    });

    test('unwraps the configured wrapper key', async () => {
        mockFetch.mockReturnValueOnce(
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({
                        markets: [marketStub(1), marketStub(2)],
                    }),
            }),
        );
        const result = await fetchGammaApi(
            '/markets/keyset?condition_ids=x',
            'markets',
            {},
        );
        expect(result).toHaveLength(2);
    });

    test('returns [] when the wrapper key is missing', async () => {
        mockFetch.mockReturnValueOnce(
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ data: [marketStub(1)] }),
            }),
        );
        const result = await fetchGammaApi(
            '/markets/keyset?slug=x',
            'markets',
            {},
        );
        expect(result).toEqual([]);
    });

    test('returns [] when the wrapper value is not an array', async () => {
        mockFetch.mockReturnValueOnce(
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ markets: { id: 'oops' } }),
            }),
        );
        const result = await fetchGammaApi(
            '/markets/keyset?slug=x',
            'markets',
            {},
        );
        expect(result).toEqual([]);
    });

    test('returns [] on non-OK HTTP status', async () => {
        mockFetch.mockReturnValueOnce(
            Promise.resolve({
                ok: false,
                status: 503,
                statusText: 'Service Unavailable',
                json: () => Promise.resolve({}),
            }),
        );
        const result = await fetchGammaApi(
            '/markets/keyset?slug=x',
            'markets',
            {},
        );
        expect(result).toEqual([]);
    });
});

describe('fetchMarketsFromApi chunking', () => {
    beforeEach(() => {
        mockFetch.mockClear();
    });

    test('issues a single request when batch fits within the keyset limit', async () => {
        const ids = Array.from({ length: 50 }, (_, i) => conditionId(i));
        mockFetch.mockReturnValue(
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({
                        markets: ids.map((_, i) => marketStub(i)),
                    }),
            }),
        );
        const result = await fetchMarketsFromApi(ids);
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(result).toHaveLength(50);
    });

    test('splits batches above the keyset limit into 1000-id chunks', async () => {
        const ids = Array.from({ length: 2500 }, (_, i) => conditionId(i));

        const calls: string[] = [];
        mockFetch.mockImplementation((url: string) => {
            calls.push(url);
            const params = new URL(url).searchParams.getAll('condition_ids');
            const markets = params.map((_, i) =>
                marketStub(calls.length * 10000 + i),
            );
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ markets }),
            }) as ReturnType<typeof globalThis.fetch>;
        });

        const result = await fetchMarketsFromApi(ids);

        // 2500 ids => 3 chunks (1000 + 1000 + 500). Each chunk fits in one
        // request because the call returns a full page (no closed-retry).
        expect(mockFetch).toHaveBeenCalledTimes(3);
        const chunkSizes = calls.map(
            (u) => new URL(u).searchParams.getAll('condition_ids').length,
        );
        expect(chunkSizes).toEqual([1000, 1000, 500]);
        expect(result).toHaveLength(2500);
    });

    test('preserves the closed-retry path within each chunk', async () => {
        // 1500 ids => 2 chunks. Chunk 1's open call returns 999 of 1000,
        // triggering the closed-retry for the 1 missing id; chunk 2 fits.
        const ids = Array.from({ length: 1500 }, (_, i) => conditionId(i));

        let call = 0;
        mockFetch.mockImplementation((url: string) => {
            call++;
            const reqIds = new URL(url).searchParams.getAll('condition_ids');
            const returned = call === 1 ? reqIds.slice(0, 999) : reqIds;
            const markets = returned.map((cid, i) => ({
                id: String(call * 10000 + i),
                conditionId: cid,
                question: 'q',
            }));
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ markets }),
            }) as ReturnType<typeof globalThis.fetch>;
        });

        const result = await fetchMarketsFromApi(ids);

        expect(mockFetch).toHaveBeenCalledTimes(3);
        expect(result).toHaveLength(1500);
    });
});

/** Route mocked responses by URL substring; unmatched URLs return 404. */
function routeFetch(
    routes: Record<string, { status?: number; body: unknown }>,
) {
    mockFetch.mockImplementation((url: string) => {
        const match = Object.entries(routes).find(([key]) => url.includes(key));
        const status = match ? (match[1].status ?? 200) : 404;
        return Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            statusText: String(status),
            json: () => Promise.resolve(match?.[1].body ?? {}),
        }) as ReturnType<typeof globalThis.fetch>;
    });
}

describe('fetchMarketFromApi placeholder fallback', () => {
    const cid = conditionId(7);

    beforeEach(() => {
        mockFetch.mockClear();
    });

    test('resolves markets keyset omits via CLOB market_slug', async () => {
        routeFetch({
            '/markets/keyset': { body: { markets: [] } },
            [`clob.polymarket.com/markets/${cid}`]: {
                body: { condition_id: cid, market_slug: 'will-app-d-win' },
            },
            '/markets/slug/will-app-d-win': {
                body: { ...marketStub(7), active: false, events: [] },
            },
        });

        const market = await fetchMarketFromApi(cid);

        expect(market?.conditionId).toBe(cid);
        expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    test('returns null when CLOB does not know the condition', async () => {
        routeFetch({ '/markets/keyset': { body: { markets: [] } } });

        expect(await fetchMarketFromApi(cid)).toBeNull();
        expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    test('rejects a slug lookup that resolves to a different condition', async () => {
        routeFetch({
            '/markets/keyset': { body: { markets: [] } },
            [`clob.polymarket.com/markets/${cid}`]: {
                body: { market_slug: 'reused-slug' },
            },
            '/markets/slug/reused-slug': { body: marketStub(8) },
        });

        expect(await fetchMarketFromApi(cid)).toBeNull();
    });

    test('skips the fallback when keyset finds the market', async () => {
        routeFetch({
            '/markets/keyset': { body: { markets: [marketStub(7)] } },
        });

        expect((await fetchMarketFromApi(cid))?.conditionId).toBe(cid);
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });
});

describe('fetchEventFromApi', () => {
    beforeEach(() => {
        mockFetch.mockClear();
    });

    test('returns the keyset event without a slug lookup', async () => {
        routeFetch({
            '/events/keyset': { body: { events: [{ id: '1', slug: 'e' }] } },
        });

        expect(await fetchEventFromApi('e')).toMatchObject({ slug: 'e' });
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('falls back to the slug endpoint when keyset is empty', async () => {
        routeFetch({
            '/events/keyset': { body: { events: [] } },
            '/events/slug/e': { body: { id: '1', slug: 'e', markets: [] } },
        });

        expect(await fetchEventFromApi('e')).toMatchObject({ slug: 'e' });
    });

    test("returns 'not_found' when the slug endpoint 404s", async () => {
        routeFetch({ '/events/keyset': { body: { events: [] } } });

        expect(await fetchEventFromApi('gone')).toBe('not_found');
    });

    test('returns null on transient failures', async () => {
        routeFetch({
            '/events/keyset': { status: 503, body: {} },
            '/events/slug/e': { status: 503, body: {} },
        });

        expect(await fetchEventFromApi('e')).toBeNull();
    });
});

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// LOG_LEVEL=error keeps warn/info noise out of the test output. We don't
// mock `lib/logger` here because `services/polymarket/index.test.ts` (run in
// the same process) already imports `./index` with the real logger, and
// `mock.module` doesn't retroactively rewire bindings captured at import time.
process.env.LOG_LEVEL = 'error';

const mockFetch = mock(() =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ markets: [], events: [] }),
    }),
);
globalThis.fetch = mockFetch as unknown as typeof fetch;

const { fetchGammaApi, fetchMarketsFromApi } = await import('./index');

const conditionId = (i: number) =>
    `0x${i.toString(16).padStart(64, '0')}`;

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
                    Promise.resolve({ markets: [marketStub(1), marketStub(2)] }),
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

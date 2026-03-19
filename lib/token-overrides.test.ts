import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const mockQuery = mock(() =>
    Promise.resolve({
        data: [],
        metrics: { httpRequestTimeMs: 0, dataFetchTimeMs: 0, totalTimeMs: 0 },
    }),
);
const mockInsertRow = mock(() => Promise.resolve(true));
const mockFetch = mock(() =>
    Promise.resolve(
        new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }),
    ),
);

mock.module('./clickhouse', () => ({
    query: mockQuery,
}));

mock.module('../src/insert', () => ({
    insertRow: mockInsertRow,
}));

const originalFetch = globalThis.fetch;

const { initTokenOverrides, resetTokenOverridesForTests } = await import(
    './token-overrides'
);

describe('token overrides startup application', () => {
    beforeEach(() => {
        resetTokenOverridesForTests();
        globalThis.fetch = mockFetch as typeof fetch;
        process.env.TOKEN_OVERRIDES_URL = 'https://example.com/tokens.json';
        process.env.CLICKHOUSE_DATABASE = 'mainnet:metadata';

        mockQuery.mockClear();
        mockInsertRow.mockClear();
        mockFetch.mockClear();

        mockInsertRow.mockReturnValue(Promise.resolve(true));
        mockQuery.mockReturnValue(
            Promise.resolve({
                data: [],
                metrics: {
                    httpRequestTimeMs: 0,
                    dataFetchTimeMs: 0,
                    totalTimeMs: 0,
                },
            }),
        );
        mockFetch.mockReturnValue(
            Promise.resolve(
                new Response(JSON.stringify([]), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                }),
            ),
        );
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        delete process.env.TOKEN_OVERRIDES_URL;
        delete process.env.CLICKHOUSE_DATABASE;
    });

    test('should apply overrides and insert missing tokens at startup', async () => {
        mockFetch.mockReturnValue(
            Promise.resolve(
                new Response(
                    JSON.stringify([
                        {
                            network: 'mainnet',
                            contract: '0xAbC123',
                            name: 'CoinGecko Name',
                            symbol: '',
                        },
                        {
                            network: 'mainnet',
                            contract: '0xdef456',
                            name: '',
                            symbol: 'CGK',
                            decimals: 8,
                        },
                        {
                            network: 'polygon',
                            contract: '0x999999',
                            name: 'Polygon Token',
                            symbol: 'POLY',
                        },
                        {
                            network: 'mainnet',
                            contract: '0x987654',
                            name: 'Override Only Token',
                        },
                    ]),
                    {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    },
                ),
            ),
        );

        mockQuery.mockReturnValue(
            Promise.resolve({
                data: [
                    {
                        network: 'mainnet',
                        normalized_contract: '0xabc123',
                        contract: '0xabc123',
                        decimals: 18,
                        name: 'Onchain Name',
                        symbol: 'ONC',
                        block_num: 123,
                    },
                    {
                        network: 'mainnet',
                        normalized_contract: '0xdef456',
                        contract: '0xdef456',
                        decimals: 6,
                        name: 'Stablecoin',
                        symbol: 'USDT',
                        block_num: 77,
                    },
                ],
                metrics: {
                    httpRequestTimeMs: 0,
                    dataFetchTimeMs: 0,
                    totalTimeMs: 0,
                },
            }),
        );

        await initTokenOverrides();

        expect(mockQuery).toHaveBeenCalledWith(
            expect.stringContaining('FROM metadata'),
            {
                network: 'mainnet',
                contracts: ['0xabc123', '0xdef456', '0x987654'],
            },
        );
        expect(mockInsertRow).toHaveBeenCalledTimes(3);
        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            expect.objectContaining({
                network: 'mainnet',
                contract: '0xabc123',
                block_num: 124,
                decimals: 18,
                name: 'CoinGecko Name',
                symbol: 'ONC',
            }),
            expect.any(String),
            expect.objectContaining({ contract: '0xabc123' }),
        );
        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            expect.objectContaining({
                network: 'mainnet',
                contract: '0xdef456',
                block_num: 78,
                decimals: 8,
                name: 'Stablecoin',
                symbol: 'CGK',
            }),
            expect.any(String),
            expect.objectContaining({ contract: '0xdef456' }),
        );
        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            expect.objectContaining({
                network: 'mainnet',
                contract: '0x987654',
                block_num: 0,
                decimals: 18,
                name: 'Override Only Token',
                symbol: '',
            }),
            expect.any(String),
            expect.objectContaining({ contract: '0x987654' }),
        );
    });

    test('should skip inserts when override values already match stored metadata', async () => {
        mockFetch.mockReturnValue(
            Promise.resolve(
                new Response(
                    JSON.stringify([
                        {
                            network: 'mainnet',
                            contract: '0xabc123',
                            name: 'CoinGecko Name',
                            symbol: 'CGK',
                        },
                    ]),
                    {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    },
                ),
            ),
        );

        mockQuery.mockReturnValue(
            Promise.resolve({
                data: [
                    {
                        network: 'mainnet',
                        normalized_contract: '0xabc123',
                        contract: '0xabc123',
                        decimals: 18,
                        name: 'CoinGecko Name',
                        symbol: 'CGK',
                        block_num: 123,
                    },
                ],
                metrics: {
                    httpRequestTimeMs: 0,
                    dataFetchTimeMs: 0,
                    totalTimeMs: 0,
                },
            }),
        );

        await initTokenOverrides();

        expect(mockInsertRow).not.toHaveBeenCalled();
    });

    test('should skip insert when block_num is already at UInt32 max', async () => {
        mockFetch.mockReturnValue(
            Promise.resolve(
                new Response(
                    JSON.stringify([
                        {
                            network: 'mainnet',
                            contract: '0xabc123',
                            name: 'CoinGecko Name',
                            symbol: 'CGK',
                        },
                    ]),
                    {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    },
                ),
            ),
        );

        mockQuery.mockReturnValue(
            Promise.resolve({
                data: [
                    {
                        network: 'mainnet',
                        normalized_contract: '0xabc123',
                        contract: '0xabc123',
                        decimals: 18,
                        name: 'Onchain Name',
                        symbol: 'ONC',
                        block_num: 0xffffffff,
                    },
                ],
                metrics: {
                    httpRequestTimeMs: 0,
                    dataFetchTimeMs: 0,
                    totalTimeMs: 0,
                },
            }),
        );

        await initTokenOverrides();

        expect(mockInsertRow).not.toHaveBeenCalled();
    });

    test('should continue when inserting an override row fails', async () => {
        mockFetch.mockReturnValue(
            Promise.resolve(
                new Response(
                    JSON.stringify([
                        {
                            network: 'mainnet',
                            contract: '0xabc123',
                            name: 'CoinGecko Name',
                            symbol: 'CGK',
                        },
                    ]),
                    {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    },
                ),
            ),
        );

        mockQuery.mockReturnValue(
            Promise.resolve({
                data: [
                    {
                        network: 'mainnet',
                        normalized_contract: '0xabc123',
                        contract: '0xabc123',
                        decimals: 18,
                        name: 'Onchain Name',
                        symbol: 'ONC',
                        block_num: 123,
                    },
                ],
                metrics: {
                    httpRequestTimeMs: 0,
                    dataFetchTimeMs: 0,
                    totalTimeMs: 0,
                },
            }),
        );
        mockInsertRow.mockReturnValue(Promise.resolve(false));

        await initTokenOverrides();

        expect(mockInsertRow).toHaveBeenCalledTimes(1);
        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            expect.objectContaining({
                contract: '0xabc123',
                block_num: 124,
                name: 'CoinGecko Name',
                symbol: 'CGK',
            }),
            expect.any(String),
            expect.objectContaining({ contract: '0xabc123' }),
        );
    });

    test('should insert missing override tokens with provided decimals', async () => {
        mockFetch.mockReturnValue(
            Promise.resolve(
                new Response(
                    JSON.stringify([
                        {
                            network: 'mainnet',
                            contract: '0xabc123',
                            name: 'CoinGecko Name',
                            symbol: 'CGK',
                            decimals: 6,
                        },
                    ]),
                    {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    },
                ),
            ),
        );

        await initTokenOverrides();

        expect(mockInsertRow).toHaveBeenCalledTimes(1);
        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            expect.objectContaining({
                network: 'mainnet',
                contract: '0xabc123',
                block_num: 0,
                decimals: 6,
                name: 'CoinGecko Name',
                symbol: 'CGK',
            }),
            expect.any(String),
            expect.objectContaining({ contract: '0xabc123' }),
        );
    });

    test('should only apply overrides once per process startup', async () => {
        await initTokenOverrides();
        await initTokenOverrides();

        expect(mockFetch).toHaveBeenCalledTimes(1);
    });
});

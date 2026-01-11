import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * Tests for polymarket-markets service
 * Verifies that the service correctly fetches and stores Polymarket market data
 */

// Mock dependencies
const mockQuery = mock(() =>
    Promise.resolve({
        data: [],
        metrics: { httpRequestTimeMs: 0, dataFetchTimeMs: 0, totalTimeMs: 0 },
    }),
);
const mockInsertRow = mock(() => Promise.resolve(true));
const mockIncrementSuccess = mock(() => {});
const mockIncrementError = mock(() => {});
const mockInitService = mock(() => {});
const mockShutdownBatchInsertQueue = mock(() => Promise.resolve());

// Mock fetch for Polymarket API
const mockFetch = mock(() =>
    Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
    }),
);

mock.module('../../lib/clickhouse', () => ({
    query: mockQuery,
}));

mock.module('../../src/insert', () => ({
    insertRow: mockInsertRow,
}));

mock.module('../../lib/prometheus', () => ({
    incrementSuccess: mockIncrementSuccess,
    incrementError: mockIncrementError,
}));

mock.module('../../lib/service-init', () => ({
    initService: mockInitService,
}));

mock.module('../../lib/batch-insert', () => ({
    shutdownBatchInsertQueue: mockShutdownBatchInsertQueue,
}));

// Replace global fetch
globalThis.fetch = mockFetch as unknown as typeof fetch;

describe('Polymarket markets service', () => {
    beforeEach(() => {
        mockQuery.mockClear();
        mockInsertRow.mockClear();
        mockIncrementSuccess.mockClear();
        mockIncrementError.mockClear();
        mockInitService.mockClear();
        mockShutdownBatchInsertQueue.mockClear();
        mockFetch.mockClear();

        // Reset fetch mock
        mockFetch.mockReturnValue(
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([]),
            }),
        );
    });

    test('should handle empty result when no condition_ids to process', async () => {
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

        const { run } = await import('./index');

        await run();

        expect(mockQuery).toHaveBeenCalled();
        expect(mockInsertRow).not.toHaveBeenCalled();
        expect(mockShutdownBatchInsertQueue).toHaveBeenCalled();
    });

    test('should fetch market data and insert into tables', async () => {
        const registeredTokens = [
            {
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                token0: '73573462648297901921820359655254719595698016068614764024444333650003658804359',
                token1: '40994777680727308978134257890301046935140301632248767098913980978862053200065',
            },
        ];

        const mockMarket = {
            id: '1137135',
            conditionId:
                '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
            question: 'Will this happen?',
            description: 'A test market',
            slug: 'test-market',
            outcomes: '["Yes", "No"]',
            resolutionSource: 'https://example.com',
            image: 'https://example.com/image.png',
            icon: 'https://example.com/icon.png',
            questionID:
                '0xb66ff94419161a6877f128059eb8d45f5eaeb3789f3d7b5e9071b0777926272a',
            clobTokenIds:
                '["73573462648297901921820359655254719595698016068614764024444333650003658804359"]',
            submitted_by: '0x91430CaD2d3975766499717fA0D66A78D814E5c5',
            enableOrderBook: true,
            orderPriceMinTickSize: 0.001,
            orderMinSize: 5,
            negRisk: false,
            negRiskRequestID: '',
            archived: false,
            startDate: '2025-01-01T00:00:00Z',
            endDate: '2025-12-31T00:00:00Z',
            startDateIso: '2025-01-01',
            endDateIso: '2025-12-31',
            umaEndDate: '2025-12-31T17:00:00Z',
            createdAt: '2025-01-01T00:00:00Z',
        };

        mockQuery.mockReturnValue(
            Promise.resolve({
                data: registeredTokens,
                metrics: {
                    httpRequestTimeMs: 0,
                    dataFetchTimeMs: 0,
                    totalTimeMs: 0,
                },
            }),
        );

        mockFetch.mockReturnValue(
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([mockMarket]),
            }),
        );

        const { run } = await import('./index');

        await run();

        expect(mockQuery).toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalled();
        // Should insert market and both assets
        expect(mockInsertRow).toHaveBeenCalledTimes(3);
        expect(mockInsertRow).toHaveBeenCalledWith(
            'polymarket_markets',
            expect.objectContaining({
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                question: 'Will this happen?',
            }),
            expect.any(String),
            expect.any(Object),
        );
        expect(mockInsertRow).toHaveBeenCalledWith(
            'polymarket_assets',
            expect.objectContaining({
                asset_id:
                    '73573462648297901921820359655254719595698016068614764024444333650003658804359',
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
            }),
            expect.any(String),
            expect.any(Object),
        );
        expect(mockInsertRow).toHaveBeenCalledWith(
            'polymarket_assets',
            expect.objectContaining({
                asset_id:
                    '40994777680727308978134257890301046935140301632248767098913980978862053200065',
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
            }),
            expect.any(String),
            expect.any(Object),
        );
        expect(mockIncrementSuccess).toHaveBeenCalled();
        expect(mockShutdownBatchInsertQueue).toHaveBeenCalled();
    });

    test('should handle API error and increment error counter', async () => {
        const registeredTokens = [
            {
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                token0: '73573462648297901921820359655254719595698016068614764024444333650003658804359',
                token1: '40994777680727308978134257890301046935140301632248767098913980978862053200065',
            },
        ];

        mockQuery.mockReturnValue(
            Promise.resolve({
                data: registeredTokens,
                metrics: {
                    httpRequestTimeMs: 0,
                    dataFetchTimeMs: 0,
                    totalTimeMs: 0,
                },
            }),
        );

        // Return empty array (no market found)
        mockFetch.mockReturnValue(
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([]),
            }),
        );

        const { run } = await import('./index');

        await run();

        expect(mockQuery).toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalled();
        expect(mockInsertRow).not.toHaveBeenCalled();
        expect(mockIncrementError).toHaveBeenCalled();
        expect(mockShutdownBatchInsertQueue).toHaveBeenCalled();
    });

    test('should handle API non-OK response', async () => {
        const registeredTokens = [
            {
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                token0: '73573462648297901921820359655254719595698016068614764024444333650003658804359',
                token1: '40994777680727308978134257890301046935140301632248767098913980978862053200065',
            },
        ];

        mockQuery.mockReturnValue(
            Promise.resolve({
                data: registeredTokens,
                metrics: {
                    httpRequestTimeMs: 0,
                    dataFetchTimeMs: 0,
                    totalTimeMs: 0,
                },
            }),
        );

        // Return non-OK response
        mockFetch.mockReturnValue(
            Promise.resolve({
                ok: false,
                status: 500,
                statusText: 'Internal Server Error',
            }),
        );

        const { run } = await import('./index');

        await run();

        expect(mockQuery).toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalled();
        expect(mockInsertRow).not.toHaveBeenCalled();
        expect(mockIncrementError).toHaveBeenCalled();
        expect(mockShutdownBatchInsertQueue).toHaveBeenCalled();
    });

    test('should try token1 if token0 returns no results', async () => {
        const registeredTokens = [
            {
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                token0: '73573462648297901921820359655254719595698016068614764024444333650003658804359',
                token1: '40994777680727308978134257890301046935140301632248767098913980978862053200065',
            },
        ];

        const mockMarket = {
            id: '1137135',
            conditionId:
                '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
            question: 'Will this happen?',
            description: 'A test market',
            slug: 'test-market',
            outcomes: '["Yes", "No"]',
            resolutionSource: 'https://example.com',
            image: 'https://example.com/image.png',
            icon: 'https://example.com/icon.png',
            questionID:
                '0xb66ff94419161a6877f128059eb8d45f5eaeb3789f3d7b5e9071b0777926272a',
            clobTokenIds:
                '["73573462648297901921820359655254719595698016068614764024444333650003658804359"]',
            submitted_by: '0x91430CaD2d3975766499717fA0D66A78D814E5c5',
            enableOrderBook: true,
            orderPriceMinTickSize: 0.001,
            orderMinSize: 5,
            negRisk: false,
            negRiskRequestID: '',
            archived: false,
            startDate: '2025-01-01T00:00:00Z',
            endDate: '2025-12-31T00:00:00Z',
            startDateIso: '2025-01-01',
            endDateIso: '2025-12-31',
            umaEndDate: '2025-12-31T17:00:00Z',
            createdAt: '2025-01-01T00:00:00Z',
        };

        mockQuery.mockReturnValue(
            Promise.resolve({
                data: registeredTokens,
                metrics: {
                    httpRequestTimeMs: 0,
                    dataFetchTimeMs: 0,
                    totalTimeMs: 0,
                },
            }),
        );

        // First call (token0) returns empty, second call (token1) returns market
        let callCount = 0;
        mockFetch.mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
                // token0 - no results
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([]),
                });
            }
            // token1 - has results
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve([mockMarket]),
            });
        });

        const { run } = await import('./index');

        await run();

        expect(mockQuery).toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledTimes(2); // Called twice - once for token0, once for token1
        expect(mockInsertRow).toHaveBeenCalledTimes(3); // Market + 2 assets
        expect(mockIncrementSuccess).toHaveBeenCalled();
        expect(mockShutdownBatchInsertQueue).toHaveBeenCalled();
    });

    test('should handle insert failure and increment error', async () => {
        const registeredTokens = [
            {
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                token0: '73573462648297901921820359655254719595698016068614764024444333650003658804359',
                token1: '40994777680727308978134257890301046935140301632248767098913980978862053200065',
            },
        ];

        const mockMarket = {
            id: '1137135',
            conditionId:
                '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
            question: 'Will this happen?',
            description: 'A test market',
            slug: 'test-market',
            outcomes: '["Yes", "No"]',
            resolutionSource: '',
            image: '',
            icon: '',
            questionID: '',
            clobTokenIds: '[]',
            submitted_by: '',
            enableOrderBook: true,
            orderPriceMinTickSize: 0,
            orderMinSize: 0,
            negRisk: false,
            negRiskRequestID: '',
            archived: false,
            startDate: '',
            endDate: '',
            startDateIso: '',
            endDateIso: '',
            umaEndDate: '',
            createdAt: '',
        };

        mockQuery.mockReturnValue(
            Promise.resolve({
                data: registeredTokens,
                metrics: {
                    httpRequestTimeMs: 0,
                    dataFetchTimeMs: 0,
                    totalTimeMs: 0,
                },
            }),
        );

        mockFetch.mockReturnValue(
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([mockMarket]),
            }),
        );

        mockInsertRow.mockReturnValue(Promise.resolve(false)); // Insert fails

        const { run } = await import('./index');

        await run();

        expect(mockInsertRow).toHaveBeenCalled();
        expect(mockIncrementError).toHaveBeenCalled();
        expect(mockIncrementSuccess).not.toHaveBeenCalled();
    });
});

import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * Tests for polymarket service
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

const baseMockMarket = {
    id: '1', conditionId: '0xaaa', question: 'Test?', description: '',
    slug: 'test', outcomes: '["Yes", "No"]', outcomePrices: '["0.5", "0.5"]',
    resolutionSource: '', image: '', icon: '', questionID: '',
    clobTokenIds: '["111", "222"]', submitted_by: '', marketMakerAddress: '',
    enableOrderBook: true, orderPriceMinTickSize: 0.001, orderMinSize: 5,
    negRisk: false, negRiskRequestID: '', negRiskOther: false,
    archived: false, new: false, featured: false, resolvedBy: '',
    restricted: false, hasReviewedDates: false, umaBond: '', umaReward: '',
    customLiveness: 0, acceptingOrders: true, ready: true, funded: true,
    acceptingOrdersTimestamp: '', cyom: false, competitive: 0,
    pagerDutyNotificationEnabled: false, approved: true, rewardsMinSize: 0,
    rewardsMaxSpread: 0, spread: 0, automaticallyActive: true,
    clearBookOnStart: false, manualActivation: false, pendingDeployment: false,
    deploying: false, deployingTimestamp: '', rfqEnabled: false,
    eventStartTime: '', holdingRewardsEnabled: false, feesEnabled: false,
    requiresTranslation: false, startDate: '', endDate: '', startDateIso: '',
    endDateIso: '', umaEndDate: '', createdAt: '', events: [] as any[],
    liquidity: '', volume: '', volumeNum: 0, liquidityNum: 0,
    volume24hr: 0, volume1wk: 0, volume1mo: 0, volume1yr: 0,
    volume24hrClob: 0, volume1wkClob: 0, volume1moClob: 0, volume1yrClob: 0,
    volumeClob: 0, liquidityClob: 0, active: true, closed: false,
    oneDayPriceChange: 0, oneHourPriceChange: 0, lastTradePrice: 0,
    bestBid: 0, bestAsk: 0, umaResolutionStatuses: '',
};

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

        // Reset insertRow mock to return true by default
        mockInsertRow.mockReturnValue(Promise.resolve(true));

        // Default query response: empty data (enrichment pass gets this when no Once values remain)
        mockQuery.mockReturnValue(
            Promise.resolve({
                data: [],
                metrics: { httpRequestTimeMs: 0, dataFetchTimeMs: 0, totalTimeMs: 0 },
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
                timestamp: '2025-01-01 00:00:00',
                block_hash:
                    '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                block_num: 12345678,
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
            outcomePrices: '["0.5", "0.5"]',
            resolutionSource: 'https://example.com',
            image: 'https://example.com/image.png',
            icon: 'https://example.com/icon.png',
            questionID:
                '0xb66ff94419161a6877f128059eb8d45f5eaeb3789f3d7b5e9071b0777926272a',
            clobTokenIds:
                '["73573462648297901921820359655254719595698016068614764024444333650003658804359"]',
            submitted_by: '0x91430CaD2d3975766499717fA0D66A78D814E5c5',
            marketMakerAddress: '0x1234567890123456789012345678901234567890',
            enableOrderBook: true,
            orderPriceMinTickSize: 0.001,
            orderMinSize: 5,
            negRisk: false,
            negRiskRequestID: '',
            negRiskOther: false,
            archived: false,
            new: false,
            featured: false,
            resolvedBy: '',
            restricted: false,
            hasReviewedDates: false,
            umaBond: '500',
            umaReward: '2',
            customLiveness: 3600,
            acceptingOrders: true,
            ready: true,
            funded: true,
            acceptingOrdersTimestamp: '2025-01-01T00:00:00Z',
            cyom: false,
            competitive: 0.5,
            pagerDutyNotificationEnabled: false,
            approved: true,
            rewardsMinSize: 0,
            rewardsMaxSpread: 0,
            spread: 0.01,
            automaticallyActive: true,
            clearBookOnStart: false,
            manualActivation: false,
            pendingDeployment: false,
            deploying: false,
            deployingTimestamp: '',
            rfqEnabled: false,
            eventStartTime: '',
            holdingRewardsEnabled: false,
            feesEnabled: false,
            requiresTranslation: false,
            startDate: '2025-01-01T00:00:00Z',
            endDate: '2025-12-31T00:00:00Z',
            startDateIso: '2025-01-01',
            endDateIso: '2025-12-31',
            umaEndDate: '2025-12-31T17:00:00Z',
            createdAt: '2025-01-01T00:00:00Z',
        };

        mockQuery.mockReturnValueOnce(
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
        // Should insert market data (polymarket_assets is populated via MV)
        expect(mockInsertRow).toHaveBeenCalledTimes(1);
        expect(mockInsertRow).toHaveBeenCalledWith(
            'polymarket_markets',
            expect.objectContaining({
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                question: 'Will this happen?',
                token0: '73573462648297901921820359655254719595698016068614764024444333650003658804359',
                token1: '40994777680727308978134257890301046935140301632248767098913980978862053200065',
            }),
            expect.any(String),
            expect.any(Object),
        );
        expect(mockIncrementSuccess).toHaveBeenCalled();
        expect(mockShutdownBatchInsertQueue).toHaveBeenCalled();
    });

    test('should handle API error, insert error record and increment error counter', async () => {
        const registeredTokens = [
            {
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                token0: '73573462648297901921820359655254719595698016068614764024444333650003658804359',
                token1: '40994777680727308978134257890301046935140301632248767098913980978862053200065',
                timestamp: '2025-01-01 00:00:00',
                block_hash:
                    '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                block_num: 12345678,
            },
        ];

        mockQuery.mockReturnValueOnce(
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
        // Should insert error record when market not found
        expect(mockInsertRow).toHaveBeenCalledTimes(1);
        expect(mockInsertRow).toHaveBeenCalledWith(
            'polymarket_markets_errors',
            expect.objectContaining({
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                error: 'Market not found',
            }),
            expect.any(String),
            expect.any(Object),
        );
        expect(mockIncrementError).toHaveBeenCalled();
        expect(mockShutdownBatchInsertQueue).toHaveBeenCalled();
    });

    test('should handle API non-OK response, insert error record and increment error counter', async () => {
        const registeredTokens = [
            {
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                token0: '73573462648297901921820359655254719595698016068614764024444333650003658804359',
                token1: '40994777680727308978134257890301046935140301632248767098913980978862053200065',
                timestamp: '2025-01-01 00:00:00',
                block_hash:
                    '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                block_num: 12345678,
            },
        ];

        mockQuery.mockReturnValueOnce(
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
        // Should insert error record when API returns non-OK response
        expect(mockInsertRow).toHaveBeenCalledTimes(1);
        expect(mockInsertRow).toHaveBeenCalledWith(
            'polymarket_markets_errors',
            expect.objectContaining({
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                error: 'Market not found',
            }),
            expect.any(String),
            expect.any(Object),
        );
        expect(mockIncrementError).toHaveBeenCalled();
        expect(mockShutdownBatchInsertQueue).toHaveBeenCalled();
    });

    test('should handle insert failure and increment error', async () => {
        const registeredTokens = [
            {
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                token0: '73573462648297901921820359655254719595698016068614764024444333650003658804359',
                token1: '40994777680727308978134257890301046935140301632248767098913980978862053200065',
                timestamp: '2025-01-01 00:00:00',
                block_hash:
                    '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                block_num: 12345678,
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
            outcomePrices: '[]',
            resolutionSource: '',
            image: '',
            icon: '',
            questionID: '',
            clobTokenIds: '[]',
            submitted_by: '',
            marketMakerAddress: '',
            enableOrderBook: true,
            orderPriceMinTickSize: 0,
            orderMinSize: 0,
            negRisk: false,
            negRiskRequestID: '',
            negRiskOther: false,
            archived: false,
            new: false,
            featured: false,
            resolvedBy: '',
            restricted: false,
            hasReviewedDates: false,
            umaBond: '',
            umaReward: '',
            customLiveness: 0,
            acceptingOrders: false,
            ready: false,
            funded: false,
            acceptingOrdersTimestamp: '',
            cyom: false,
            competitive: 0,
            pagerDutyNotificationEnabled: false,
            approved: false,
            rewardsMinSize: 0,
            rewardsMaxSpread: 0,
            spread: 0,
            automaticallyActive: false,
            clearBookOnStart: false,
            manualActivation: false,
            pendingDeployment: false,
            deploying: false,
            deployingTimestamp: '',
            rfqEnabled: false,
            eventStartTime: '',
            holdingRewardsEnabled: false,
            feesEnabled: false,
            requiresTranslation: false,
            startDate: '',
            endDate: '',
            startDateIso: '',
            endDateIso: '',
            umaEndDate: '',
            createdAt: '',
        };

        mockQuery.mockReturnValueOnce(
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

    test('should process multiple condition_ids with individual API requests', async () => {
        const registeredTokens = [
            {
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                token0: '73573462648297901921820359655254719595698016068614764024444333650003658804359',
                token1: '40994777680727308978134257890301046935140301632248767098913980978862053200065',
                timestamp: '2025-01-01 00:00:00',
                block_hash:
                    '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                block_num: 12345678,
            },
            {
                condition_id:
                    '0xabc123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd',
                token0: '11111111111111111111111111111111111111111111111111111111111111111',
                token1: '22222222222222222222222222222222222222222222222222222222222222222',
                timestamp: '2025-01-02 00:00:00',
                block_hash:
                    '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
                block_num: 12345679,
            },
        ];

        const mockMarket1 = {
            id: '1137135',
            conditionId:
                '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
            question: 'Will this happen?',
            description: 'A test market',
            slug: 'test-market',
            outcomes: '["Yes", "No"]',
            outcomePrices: '["0.5", "0.5"]',
            resolutionSource: 'https://example.com',
            image: 'https://example.com/image.png',
            icon: 'https://example.com/icon.png',
            questionID:
                '0xb66ff94419161a6877f128059eb8d45f5eaeb3789f3d7b5e9071b0777926272a',
            clobTokenIds:
                '["73573462648297901921820359655254719595698016068614764024444333650003658804359"]',
            submitted_by: '0x91430CaD2d3975766499717fA0D66A78D814E5c5',
            marketMakerAddress: '0x1234567890123456789012345678901234567890',
            enableOrderBook: true,
            orderPriceMinTickSize: 0.001,
            orderMinSize: 5,
            negRisk: false,
            negRiskRequestID: '',
            negRiskOther: false,
            archived: false,
            new: false,
            featured: false,
            resolvedBy: '',
            restricted: false,
            hasReviewedDates: false,
            umaBond: '500',
            umaReward: '2',
            customLiveness: 3600,
            acceptingOrders: true,
            ready: true,
            funded: true,
            acceptingOrdersTimestamp: '2025-01-01T00:00:00Z',
            cyom: false,
            competitive: 0.5,
            pagerDutyNotificationEnabled: false,
            approved: true,
            rewardsMinSize: 0,
            rewardsMaxSpread: 0,
            spread: 0.01,
            automaticallyActive: true,
            clearBookOnStart: false,
            manualActivation: false,
            pendingDeployment: false,
            deploying: false,
            deployingTimestamp: '',
            rfqEnabled: false,
            eventStartTime: '',
            holdingRewardsEnabled: false,
            feesEnabled: false,
            requiresTranslation: false,
            startDate: '2025-01-01T00:00:00Z',
            endDate: '2025-12-31T00:00:00Z',
            startDateIso: '2025-01-01',
            endDateIso: '2025-12-31',
            umaEndDate: '2025-12-31T17:00:00Z',
            createdAt: '2025-01-01T00:00:00Z',
        };

        const mockMarket2 = {
            id: '1137136',
            conditionId:
                '0xabc123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd',
            question: 'Another market question?',
            description: 'Another test market',
            slug: 'another-test-market',
            outcomes: '["Yes", "No"]',
            outcomePrices: '["0.6", "0.4"]',
            resolutionSource: 'https://example.com',
            image: 'https://example.com/image2.png',
            icon: 'https://example.com/icon2.png',
            questionID:
                '0xc77ff94419161a6877f128059eb8d45f5eaeb3789f3d7b5e9071b0777926272b',
            clobTokenIds:
                '["11111111111111111111111111111111111111111111111111111111111111111"]',
            submitted_by: '0x91430CaD2d3975766499717fA0D66A78D814E5c5',
            marketMakerAddress: '0x1234567890123456789012345678901234567890',
            enableOrderBook: true,
            orderPriceMinTickSize: 0.001,
            orderMinSize: 5,
            negRisk: false,
            negRiskRequestID: '',
            negRiskOther: false,
            archived: false,
            new: false,
            featured: false,
            resolvedBy: '',
            restricted: false,
            hasReviewedDates: false,
            umaBond: '500',
            umaReward: '2',
            customLiveness: 3600,
            acceptingOrders: true,
            ready: true,
            funded: true,
            acceptingOrdersTimestamp: '2025-01-01T00:00:00Z',
            cyom: false,
            competitive: 0.5,
            pagerDutyNotificationEnabled: false,
            approved: true,
            rewardsMinSize: 0,
            rewardsMaxSpread: 0,
            spread: 0.01,
            automaticallyActive: true,
            clearBookOnStart: false,
            manualActivation: false,
            pendingDeployment: false,
            deploying: false,
            deployingTimestamp: '',
            rfqEnabled: false,
            eventStartTime: '',
            holdingRewardsEnabled: false,
            feesEnabled: false,
            requiresTranslation: false,
            startDate: '2025-01-01T00:00:00Z',
            endDate: '2025-12-31T00:00:00Z',
            startDateIso: '2025-01-01',
            endDateIso: '2025-12-31',
            umaEndDate: '2025-12-31T17:00:00Z',
            createdAt: '2025-01-01T00:00:00Z',
        };

        mockQuery.mockReturnValueOnce(
            Promise.resolve({
                data: registeredTokens,
                metrics: {
                    httpRequestTimeMs: 0,
                    dataFetchTimeMs: 0,
                    totalTimeMs: 0,
                },
            }),
        );

        // Return different markets for each individual request
        mockFetch
            .mockReturnValueOnce(
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([mockMarket1]),
                }),
            )
            .mockReturnValueOnce(
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([mockMarket2]),
                }),
            );

        const { run } = await import('./index');

        await run();

        expect(mockQuery).toHaveBeenCalled();
        // Should make TWO fetch calls (one per condition_id)
        expect(mockFetch).toHaveBeenCalledTimes(2);
        // Should insert market data for both tokens
        expect(mockInsertRow).toHaveBeenCalledTimes(2);
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
            'polymarket_markets',
            expect.objectContaining({
                condition_id:
                    '0xabc123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd',
                question: 'Another market question?',
            }),
            expect.any(String),
            expect.any(Object),
        );
        expect(mockIncrementSuccess).toHaveBeenCalledTimes(2);
        expect(mockShutdownBatchInsertQueue).toHaveBeenCalled();
    });

    test('should handle some markets not found with individual API requests', async () => {
        const registeredTokens = [
            {
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                token0: '73573462648297901921820359655254719595698016068614764024444333650003658804359',
                token1: '40994777680727308978134257890301046935140301632248767098913980978862053200065',
                timestamp: '2025-01-01 00:00:00',
                block_hash:
                    '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                block_num: 12345678,
            },
            {
                condition_id:
                    '0xnotfound1234567890123456789012345678901234567890123456789012345',
                token0: '33333333333333333333333333333333333333333333333333333333333333333',
                token1: '44444444444444444444444444444444444444444444444444444444444444444',
                timestamp: '2025-01-02 00:00:00',
                block_hash:
                    '0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321',
                block_num: 12345679,
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
            outcomePrices: '[]',
            resolutionSource: '',
            image: '',
            icon: '',
            questionID: '',
            clobTokenIds: '[]',
            submitted_by: '',
            marketMakerAddress: '',
            enableOrderBook: true,
            orderPriceMinTickSize: 0,
            orderMinSize: 0,
            negRisk: false,
            negRiskRequestID: '',
            negRiskOther: false,
            archived: false,
            new: false,
            featured: false,
            resolvedBy: '',
            restricted: false,
            hasReviewedDates: false,
            umaBond: '',
            umaReward: '',
            customLiveness: 0,
            acceptingOrders: false,
            ready: false,
            funded: false,
            acceptingOrdersTimestamp: '',
            cyom: false,
            competitive: 0,
            pagerDutyNotificationEnabled: false,
            approved: false,
            rewardsMinSize: 0,
            rewardsMaxSpread: 0,
            spread: 0,
            automaticallyActive: false,
            clearBookOnStart: false,
            manualActivation: false,
            pendingDeployment: false,
            deploying: false,
            deployingTimestamp: '',
            rfqEnabled: false,
            eventStartTime: '',
            holdingRewardsEnabled: false,
            feesEnabled: false,
            requiresTranslation: false,
            startDate: '',
            endDate: '',
            startDateIso: '',
            endDateIso: '',
            umaEndDate: '',
            createdAt: '',
        };

        mockQuery.mockReturnValueOnce(
            Promise.resolve({
                data: registeredTokens,
                metrics: {
                    httpRequestTimeMs: 0,
                    dataFetchTimeMs: 0,
                    totalTimeMs: 0,
                },
            }),
        );

        // First request returns market; second returns empty (not found),
        // then retry with closed=true also returns empty
        mockFetch
            .mockReturnValueOnce(
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([mockMarket]),
                }),
            )
            .mockReturnValueOnce(
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([]),
                }),
            )
            .mockReturnValueOnce(
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([]),
                }),
            );

        const { run } = await import('./index');

        await run();

        expect(mockQuery).toHaveBeenCalled();
        // 3 fetch calls: found market, not-found market, not-found retry with closed=true
        expect(mockFetch).toHaveBeenCalledTimes(3);
        // Should insert 1 market and 1 error
        expect(mockInsertRow).toHaveBeenCalledTimes(2);
        expect(mockInsertRow).toHaveBeenCalledWith(
            'polymarket_markets',
            expect.objectContaining({
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
            }),
            expect.any(String),
            expect.any(Object),
        );
        expect(mockInsertRow).toHaveBeenCalledWith(
            'polymarket_markets_errors',
            expect.objectContaining({
                condition_id:
                    '0xnotfound1234567890123456789012345678901234567890123456789012345',
                error: 'Market not found',
            }),
            expect.any(String),
            expect.any(Object),
        );
        expect(mockIncrementSuccess).toHaveBeenCalledTimes(1);
        expect(mockIncrementError).toHaveBeenCalledTimes(1);
        expect(mockShutdownBatchInsertQueue).toHaveBeenCalled();
    });

    test('should find closed market on retry with closed=true', async () => {
        const registeredTokens = [
            {
                condition_id: '0xclosed111111111111111111111111111111111111111111111111111111111',
                token0: '111',
                token1: '222',
                timestamp: '2025-06-01 00:00:00',
                block_hash: '0xaaa',
                block_num: 99999,
            },
        ];

        const closedMarket = {
            ...baseMockMarket,
            id: '999',
            conditionId: '0xclosed111111111111111111111111111111111111111111111111111111111',
            question: 'Resolved market?',
            slug: 'resolved-market',
            closed: true,
            active: false,
        };

        mockQuery.mockReturnValueOnce(
            Promise.resolve({
                data: registeredTokens,
                metrics: { httpRequestTimeMs: 0, dataFetchTimeMs: 0, totalTimeMs: 0 },
            }),
        );

        // First fetch (open markets) returns empty, retry with closed=true finds it
        mockFetch
            .mockReturnValueOnce(
                Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
            )
            .mockReturnValueOnce(
                Promise.resolve({ ok: true, json: () => Promise.resolve([closedMarket]) }),
            );

        const { run } = await import('./index');
        await run();

        // 2 fetch calls: initial (empty) + retry with closed=true (found)
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockInsertRow).toHaveBeenCalledWith(
            'polymarket_markets',
            expect.objectContaining({
                condition_id: '0xclosed111111111111111111111111111111111111111111111111111111111',
                closed: true,
            }),
            expect.any(String),
            expect.any(Object),
        );
        expect(mockIncrementSuccess).toHaveBeenCalledTimes(1);
        expect(mockIncrementError).not.toHaveBeenCalled();
    });

    test('should handle negative commentCount by converting to 0', async () => {
        const registeredTokens = [
            {
                condition_id:
                    '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
                token0: '73573462648297901921820359655254719595698016068614764024444333650003658804359',
                token1: '40994777680727308978134257890301046935140301632248767098913980978862053200065',
                timestamp: '2025-01-01 00:00:00',
                block_hash:
                    '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
                block_num: 12345678,
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
            outcomePrices: '["0.5", "0.5"]',
            resolutionSource: 'https://example.com',
            image: 'https://example.com/image.png',
            icon: 'https://example.com/icon.png',
            questionID:
                '0xb66ff94419161a6877f128059eb8d45f5eaeb3789f3d7b5e9071b0777926272a',
            clobTokenIds:
                '["73573462648297901921820359655254719595698016068614764024444333650003658804359"]',
            submitted_by: '0x91430CaD2d3975766499717fA0D66A78D814E5c5',
            marketMakerAddress: '0x1234567890123456789012345678901234567890',
            enableOrderBook: true,
            orderPriceMinTickSize: 0.001,
            orderMinSize: 5,
            negRisk: false,
            negRiskRequestID: '',
            negRiskOther: false,
            archived: false,
            new: false,
            featured: false,
            resolvedBy: '',
            restricted: false,
            hasReviewedDates: false,
            umaBond: '500',
            umaReward: '2',
            customLiveness: 3600,
            acceptingOrders: true,
            ready: true,
            funded: true,
            acceptingOrdersTimestamp: '2025-01-01T00:00:00Z',
            cyom: false,
            competitive: 0.5,
            pagerDutyNotificationEnabled: false,
            approved: true,
            rewardsMinSize: 0,
            rewardsMaxSpread: 0,
            spread: 0.01,
            automaticallyActive: true,
            clearBookOnStart: false,
            manualActivation: false,
            pendingDeployment: false,
            deploying: false,
            deployingTimestamp: '',
            rfqEnabled: false,
            eventStartTime: '',
            holdingRewardsEnabled: false,
            feesEnabled: false,
            requiresTranslation: false,
            startDate: '2025-01-01T00:00:00Z',
            endDate: '2025-12-31T00:00:00Z',
            startDateIso: '2025-01-01',
            endDateIso: '2025-12-31',
            umaEndDate: '2025-12-31T17:00:00Z',
            createdAt: '2025-01-01T00:00:00Z',
            // Events with negative commentCount
            events: [
                {
                    id: 'event1',
                    ticker: 'TEST',
                    slug: 'test-event',
                    title: 'Test Event',
                    description: 'A test event',
                    resolutionSource: '',
                    startDate: '',
                    creationDate: '',
                    endDate: '',
                    image: '',
                    icon: '',
                    active: true,
                    closed: false,
                    archived: false,
                    new: false,
                    featured: false,
                    restricted: false,
                    liquidity: 1000,
                    volume: 5000,
                    openInterest: 100,
                    createdAt: '',
                    updatedAt: '',
                    competitive: 0,
                    volume24hr: 0,
                    volume1wk: 0,
                    volume1mo: 0,
                    volume1yr: 0,
                    enableOrderBook: true,
                    liquidityClob: 0,
                    negRisk: false,
                    commentCount: -5, // Negative commentCount
                    cyom: false,
                    showAllOutcomes: false,
                    showMarketImages: false,
                    enableNegRisk: false,
                    automaticallyActive: false,
                    seriesSlug: '',
                    negRiskAugmented: false,
                    pendingDeployment: false,
                    deploying: false,
                    requiresTranslation: false,
                    series: [
                        {
                            id: 'series1',
                            ticker: 'SERIES',
                            slug: 'test-series',
                            title: 'Test Series',
                            seriesType: 'single',
                            recurrence: '',
                            image: '',
                            icon: '',
                            active: true,
                            closed: false,
                            archived: false,
                            featured: false,
                            restricted: false,
                            createdAt: '',
                            updatedAt: '',
                            volume: 1000,
                            liquidity: 500,
                            commentCount: -10, // Negative commentCount
                            requiresTranslation: false,
                        },
                    ],
                },
            ],
        };

        mockQuery.mockReturnValueOnce(
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
        // Should insert market, event, and series
        expect(mockInsertRow).toHaveBeenCalledTimes(3);
        // Verify event is inserted with comment_count = 0 (not -5)
        expect(mockInsertRow).toHaveBeenCalledWith(
            'polymarket_events',
            expect.objectContaining({
                event_id: 'event1',
                comment_count: 0,
            }),
            expect.any(String),
            expect.any(Object),
        );
        // Verify series is inserted with comment_count = 0 (not -10)
        expect(mockInsertRow).toHaveBeenCalledWith(
            'polymarket_series',
            expect.objectContaining({
                series_id: 'series1',
                comment_count: 0,
            }),
            expect.any(String),
            expect.any(Object),
        );
        expect(mockIncrementSuccess).toHaveBeenCalled();
    });

    test('enrichment pass should discover sibling markets from events', async () => {
        // First query: no unprocessed tokens (skip primary pass)
        mockQuery.mockReturnValueOnce(
            Promise.resolve({
                data: [],
                metrics: { httpRequestTimeMs: 0, dataFetchTimeMs: 0, totalTimeMs: 0 },
            }),
        );
        // Second query: one event slug to enrich
        mockQuery.mockReturnValueOnce(
            Promise.resolve({
                data: [{ event_slug: 'test-event' }],
                metrics: { httpRequestTimeMs: 0, dataFetchTimeMs: 0, totalTimeMs: 0 },
            }),
        );
        // Third query: batch existence check returns empty (no existing markets)
        mockQuery.mockReturnValueOnce(
            Promise.resolve({
                data: [],
                metrics: { httpRequestTimeMs: 0, dataFetchTimeMs: 0, totalTimeMs: 0 },
            }),
        );

        // First fetch: Gamma /events returns event with 2 child markets
        mockFetch.mockReturnValueOnce(
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve([
                        {
                            id: 'evt1',
                            slug: 'test-event',
                            title: 'Test Event',
                            markets: [
                                { conditionId: '0xaaa', question: 'Market A?' },
                                { conditionId: '0xbbb', question: 'Market B?' },
                            ],
                        },
                    ]),
            }),
        );

        // Second fetch: batch /markets returns both child markets in one call
        const mockMarketA = { ...baseMockMarket, conditionId: '0xaaa', question: 'Market A?', slug: 'market-a' };
        const mockMarketB = {
            ...baseMockMarket,
            id: '2', conditionId: '0xbbb', question: 'Market B?',
            slug: 'market-b', clobTokenIds: '["333", "444"]',
        };

        mockFetch.mockReturnValueOnce(
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve([mockMarketA, mockMarketB]),
            }),
        );

        const { run } = await import('./index');
        await run();

        // Should insert: market A, market B, enrichment tracking record
        const insertCalls = mockInsertRow.mock.calls.map(
            (call) => call[0],
        );
        expect(insertCalls).toContain('polymarket_markets');
        expect(insertCalls).toContain('polymarket_events_enriched');

        // Verify enrichment tracking record
        expect(mockInsertRow).toHaveBeenCalledWith(
            'polymarket_events_enriched',
            expect.objectContaining({
                slug: 'test-event',
                markets_found: 2,
                markets_inserted: 2,
            }),
            expect.any(String),
            expect.any(Object),
        );
    });

    test('enrichment pass should skip already-existing markets', async () => {
        // Primary pass: no tokens
        mockQuery.mockReturnValueOnce(
            Promise.resolve({
                data: [],
                metrics: { httpRequestTimeMs: 0, dataFetchTimeMs: 0, totalTimeMs: 0 },
            }),
        );
        // Event slugs to enrich
        mockQuery.mockReturnValueOnce(
            Promise.resolve({
                data: [{ event_slug: 'existing-event' }],
                metrics: { httpRequestTimeMs: 0, dataFetchTimeMs: 0, totalTimeMs: 0 },
            }),
        );
        // Batch existence check: one market already exists
        mockQuery.mockReturnValueOnce(
            Promise.resolve({
                data: [{ condition_id: '0xaaa' }],
                metrics: { httpRequestTimeMs: 0, dataFetchTimeMs: 0, totalTimeMs: 0 },
            }),
        );

        // Gamma /events returns event with 2 markets (one already exists)
        mockFetch.mockReturnValueOnce(
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve([
                        {
                            id: 'evt2',
                            slug: 'existing-event',
                            title: 'Existing Event',
                            markets: [
                                { conditionId: '0xaaa', question: 'Already scraped' },
                                { conditionId: '0xbbb', question: 'New market' },
                            ],
                        },
                    ]),
            }),
        );

        // Only one /markets fetch needed (for 0xbbb, since 0xaaa is skipped)
        mockFetch.mockReturnValueOnce(
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve([
                        {
                            ...baseMockMarket,
                            id: '3',
                            conditionId: '0xbbb',
                            question: 'New market',
                            slug: 'new-market',
                            clobTokenIds: '["555", "666"]',
                        },
                    ]),
            }),
        );

        const { run } = await import('./index');
        await run();

        // Only 1 market inserted (0xbbb), not 2
        expect(mockInsertRow).toHaveBeenCalledWith(
            'polymarket_events_enriched',
            expect.objectContaining({
                slug: 'existing-event',
                markets_found: 2,
                markets_inserted: 1,
            }),
            expect.any(String),
            expect.any(Object),
        );
    });
});

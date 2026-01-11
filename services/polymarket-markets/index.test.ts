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
            condition_id:
                '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
            question: 'Will this happen?',
            description: 'A test market',
            market_slug: 'test-market',
            end_date_iso: '2025-12-31T00:00:00Z',
            game_start_time: '',
            seconds_delay: 0,
            fpmm: '0x1234',
            maker_base_fee: 100,
            taker_base_fee: 100,
            clob_rewards: {},
            active: true,
            closed: false,
            archived: false,
            accepting_orders: true,
            accepting_order_timestamp: '2025-01-01T00:00:00Z',
            minimum_order_size: 1,
            minimum_tick_size: 0.01,
            neg_risk: false,
            neg_risk_market_id: '',
            neg_risk_request_id: '',
            notification_preferences: {},
            notifications_enabled: false,
            competitive: 0.5,
            spread: 0.1,
            last_trade_price: 0.5,
            best_bid: 0.49,
            best_ask: 0.51,
            price: 0.5,
            volume: '1000000',
            volume_num: 1000000,
            liquidity: '500000',
            liquidity_num: 500000,
            tokens: [],
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
            condition_id:
                '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
            question: 'Will this happen?',
            description: 'A test market',
            market_slug: 'test-market',
            end_date_iso: '2025-12-31T00:00:00Z',
            game_start_time: '',
            seconds_delay: 0,
            fpmm: '0x1234',
            maker_base_fee: 100,
            taker_base_fee: 100,
            clob_rewards: {},
            active: true,
            closed: false,
            archived: false,
            accepting_orders: true,
            accepting_order_timestamp: '2025-01-01T00:00:00Z',
            minimum_order_size: 1,
            minimum_tick_size: 0.01,
            neg_risk: false,
            neg_risk_market_id: '',
            neg_risk_request_id: '',
            notification_preferences: {},
            notifications_enabled: false,
            competitive: 0.5,
            spread: 0.1,
            last_trade_price: 0.5,
            best_bid: 0.49,
            best_ask: 0.51,
            price: 0.5,
            volume: '1000000',
            volume_num: 1000000,
            liquidity: '500000',
            liquidity_num: 500000,
            tokens: [],
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
            condition_id:
                '0xd0b5c36fd640807d245eca4adff6481fb3ac88bf1acb404782aa0cb3cb4bae09',
            question: 'Will this happen?',
            description: 'A test market',
            market_slug: 'test-market',
            end_date_iso: '',
            game_start_time: '',
            seconds_delay: 0,
            fpmm: '',
            maker_base_fee: 0,
            taker_base_fee: 0,
            clob_rewards: {},
            active: true,
            closed: false,
            archived: false,
            accepting_orders: true,
            accepting_order_timestamp: '',
            minimum_order_size: 0,
            minimum_tick_size: 0,
            neg_risk: false,
            neg_risk_market_id: '',
            neg_risk_request_id: '',
            notification_preferences: {},
            notifications_enabled: false,
            competitive: 0,
            spread: 0,
            last_trade_price: 0,
            best_bid: 0,
            best_ask: 0,
            price: 0,
            volume: '0',
            volume_num: 0,
            liquidity: '0',
            liquidity_num: 0,
            tokens: [],
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

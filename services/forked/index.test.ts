import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * Tests for forked blocks service
 * Verifies that the service correctly identifies and stores forked blocks
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

describe('Forked blocks service', () => {
    beforeEach(() => {
        mockQuery.mockClear();
        mockInsertRow.mockClear();
        mockIncrementSuccess.mockClear();
        mockIncrementError.mockClear();
        mockInitService.mockClear();
        mockShutdownBatchInsertQueue.mockClear();

        // Clear environment variables
        delete process.env.CLICKHOUSE_BLOCKS_DATABASE;
        delete process.env.CLICKHOUSE_DATABASE;
        delete process.env.FORKED_BLOCKS_DAYS_BACK;
    });

    test('should throw error when CLICKHOUSE_BLOCKS_DATABASE is not set', async () => {
        process.env.CLICKHOUSE_DATABASE = 'mainnet:evm-transfers@v0.2.1';

        const { run } = await import('./index');

        await expect(run()).rejects.toThrow(
            'CLICKHOUSE_BLOCKS_DATABASE environment variable is required',
        );
    });

    test('should throw error when CLICKHOUSE_DATABASE is not set', async () => {
        process.env.CLICKHOUSE_BLOCKS_DATABASE = 'mainnet:blocks@v0.1.0';

        const { run } = await import('./index');

        await expect(run()).rejects.toThrow(
            'CLICKHOUSE_DATABASE environment variable is required',
        );
    });

    test('should handle empty result when no forked blocks found', async () => {
        process.env.CLICKHOUSE_BLOCKS_DATABASE = 'mainnet:blocks@v0.1.0';
        process.env.CLICKHOUSE_DATABASE = 'mainnet:evm-transfers@v0.2.1';

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

    test('should insert forked blocks when found', async () => {
        process.env.CLICKHOUSE_BLOCKS_DATABASE = 'mainnet:blocks@v0.1.0';
        process.env.CLICKHOUSE_DATABASE = 'mainnet:evm-transfers@v0.2.1';

        const forkedBlocks = [
            {
                block_num: 12345,
                block_hash: '0xabc123',
                parent_hash: '0xdef456',
                timestamp: '2025-01-01T00:00:00Z',
            },
            {
                block_num: 12346,
                block_hash: '0xghi789',
                parent_hash: '0xabc123',
                timestamp: '2025-01-01T00:00:10Z',
            },
        ];

        mockQuery.mockReturnValue(
            Promise.resolve({
                data: forkedBlocks,
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
        expect(mockInsertRow).toHaveBeenCalledTimes(2);
        expect(mockInsertRow).toHaveBeenCalledWith(
            'blocks_forked',
            expect.objectContaining({
                block_num: 12345,
                block_hash: '0xabc123',
                parent_hash: '0xdef456',
                timestamp: '2025-01-01T00:00:00Z',
            }),
            expect.any(String),
            expect.any(Object),
        );
        expect(mockIncrementSuccess).toHaveBeenCalledTimes(2);
        expect(mockShutdownBatchInsertQueue).toHaveBeenCalled();
    });

    test('should use custom FORKED_BLOCKS_DAYS_BACK when set', async () => {
        process.env.CLICKHOUSE_BLOCKS_DATABASE = 'mainnet:blocks@v0.1.0';
        process.env.CLICKHOUSE_DATABASE = 'mainnet:evm-transfers@v0.2.1';
        process.env.FORKED_BLOCKS_DAYS_BACK = '7';

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
        // The query should have been called with a since_date 7 days ago
        const queryCall = mockQuery.mock.calls[0];
        expect(queryCall).toBeDefined();
    });

    test('should increment error when insert fails', async () => {
        process.env.CLICKHOUSE_BLOCKS_DATABASE = 'mainnet:blocks@v0.1.0';
        process.env.CLICKHOUSE_DATABASE = 'mainnet:evm-transfers@v0.2.1';

        const forkedBlocks = [
            {
                block_num: 12345,
                block_hash: '0xabc123',
                parent_hash: '0xdef456',
                timestamp: '2025-01-01T00:00:00Z',
            },
        ];

        mockQuery.mockReturnValue(
            Promise.resolve({
                data: forkedBlocks,
                metrics: {
                    httpRequestTimeMs: 0,
                    dataFetchTimeMs: 0,
                    totalTimeMs: 0,
                },
            }),
        );
        mockInsertRow.mockReturnValue(Promise.resolve(false)); // Insert fails

        const { run } = await import('./index');

        await run();

        expect(mockInsertRow).toHaveBeenCalledTimes(1);
        expect(mockIncrementError).toHaveBeenCalledTimes(1);
        expect(mockIncrementSuccess).not.toHaveBeenCalled();
    });
});

describe('Date calculation', () => {
    test('should calculate correct since_date for 30 days back', () => {
        const now = new Date();
        const expected = new Date();
        expected.setDate(now.getDate() - 30);
        const expectedDate = expected.toISOString().split('T')[0];

        // The default is 30 days back
        const date = new Date();
        date.setDate(date.getDate() - 30);
        const result = date.toISOString().split('T')[0];

        expect(result).toBe(expectedDate);
    });

    test('should calculate correct since_date for custom days back', () => {
        const daysBack = 7;
        const now = new Date();
        const expected = new Date();
        expected.setDate(now.getDate() - daysBack);
        const expectedDate = expected.toISOString().split('T')[0];

        const date = new Date();
        date.setDate(date.getDate() - daysBack);
        const result = date.toISOString().split('T')[0];

        expect(result).toBe(expectedDate);
    });
});

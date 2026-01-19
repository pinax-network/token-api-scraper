import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { run } from './run';

/**
 * Tests for metadata service run function
 * Verifies that network parameter is properly passed to SQL queries
 */

// Mock dependencies
const mockQuery = mock(() =>
    Promise.resolve({
        data: [],
        metrics: { httpRequestTimeMs: 0, dataFetchTimeMs: 0, totalTimeMs: 0 },
    }),
);
const mockInitService = mock(() => {});
const mockGetNetwork = mock(() => 'mainnet');
const mockShutdownBatchInsertQueue = mock(() => Promise.resolve());
const mockStartProgressLogging = mock(() => {});
const mockLogCompletion = mock(() => {});

mock.module('../../lib/clickhouse', () => ({
    query: mockQuery,
}));

mock.module('../../lib/service-init', () => ({
    initService: mockInitService,
}));

mock.module('../../lib/config', () => ({
    getNetwork: mockGetNetwork,
    CONCURRENCY: 40,
}));

mock.module('../../lib/batch-insert', () => ({
    shutdownBatchInsertQueue: mockShutdownBatchInsertQueue,
}));

mock.module('../../lib/processing-stats', () => ({
    ProcessingStats: class {
        startProgressLogging = mockStartProgressLogging;
        logCompletion = mockLogCompletion;
    },
}));

mock.module('.', () => ({
    processMetadata: mock(() => Promise.resolve()),
}));

describe('Metadata service run function', () => {
    beforeEach(() => {
        mockQuery.mockClear();
        mockInitService.mockClear();
        mockGetNetwork.mockClear();
        mockShutdownBatchInsertQueue.mockClear();
        mockStartProgressLogging.mockClear();
        mockLogCompletion.mockClear();

        // Reset mock return values
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
        mockGetNetwork.mockReturnValue('mainnet');
    });

    test('should pass network parameter to query for transfers source', async () => {
        await run('transfers');

        expect(mockQuery).toHaveBeenCalledWith(
            expect.stringContaining('FROM transfers'),
            { network: 'mainnet' },
        );
    });

    test('should pass network parameter to query for swaps source', async () => {
        await run('swaps');

        expect(mockQuery).toHaveBeenCalledWith(
            expect.stringContaining('FROM swaps'),
            { network: 'mainnet' },
        );
    });

    test('should pass network parameter to query for balances source', async () => {
        await run('balances');

        expect(mockQuery).toHaveBeenCalledWith(
            expect.stringContaining('FROM erc20_balances'),
            { network: 'mainnet' },
        );
    });

    test('should use network from getNetwork() function', async () => {
        mockGetNetwork.mockReturnValue('polygon');

        await run('transfers');

        expect(mockQuery).toHaveBeenCalledWith(expect.any(String), {
            network: 'polygon',
        });
    });

    test('should initialize service with correct service name', async () => {
        await run('transfers');

        expect(mockInitService).toHaveBeenCalledWith({
            serviceName: 'metadata-transfers',
        });
    });

    test('should shutdown batch insert queue after completion', async () => {
        await run('transfers');

        expect(mockShutdownBatchInsertQueue).toHaveBeenCalled();
    });
});

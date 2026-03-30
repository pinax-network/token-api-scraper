import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * Tests for metadata service run function
 * Verifies that network parameter is properly passed to SQL queries
 */

// Mock dependencies - shared mocks that both run.ts and index.ts use
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
const mockInitTokenOverrides = mock(() => Promise.resolve());

// Mock processMetadata dependencies to prevent real RPC calls
const mockCallContract = mock(() => Promise.resolve('0x'));
const mockGetContractCode = mock(() => Promise.resolve('0x'));
const mockDecodeSymbolHex = mock(() => '');
const mockDecodeNameHex = mock(() => '');
const mockDecodeNumberHex = mock(() => 18);
const mockInsertRow = mock(() => Promise.resolve(true));
const mockIncrementSuccess = mock(() => {});
const mockIncrementError = mock(() => {});

mock.module('../../lib/clickhouse', () => ({
    query: mockQuery,
}));

mock.module('../../lib/service-init', () => ({
    initService: mockInitService,
}));

mock.module('../../lib/config', () => ({
    getNetwork: mockGetNetwork,
    CONCURRENCY: 40,
    CLICKHOUSE_DATABASE_INSERT: undefined,
}));

const mockFlushAll = mock(() => Promise.resolve());
mock.module('../../lib/batch-insert', () => ({
    shutdownBatchInsertQueue: mockShutdownBatchInsertQueue,
    getBatchInsertQueue: () => ({ flushAll: mockFlushAll }),
}));

mock.module('../../lib/token-overrides', () => ({
    initTokenOverrides: mockInitTokenOverrides,
}));

mock.module('../../lib/processing-stats', () => ({
    ProcessingStats: class {
        startProgressLogging = mockStartProgressLogging;
        logCompletion = mockLogCompletion;
    },
}));

// Mock the dependencies of processMetadata instead of mocking processMetadata itself
// This avoids polluting the module cache for index.test.ts
mock.module('../../lib/rpc', () => ({
    callContract: mockCallContract,
    getContractCode: mockGetContractCode,
}));

mock.module('../../lib/hex-decode', () => ({
    decodeSymbolHex: mockDecodeSymbolHex,
    decodeNameHex: mockDecodeNameHex,
    decodeNumberHex: mockDecodeNumberHex,
}));

mock.module('../../src/insert', () => ({
    insertRow: mockInsertRow,
}));

mock.module('../../lib/prometheus', () => ({
    incrementSuccess: mockIncrementSuccess,
    incrementError: mockIncrementError,
}));

// Import run after mocks are set up
const { run } = await import('./run');

describe('Metadata service run function', () => {
    beforeEach(() => {
        mockQuery.mockClear();
        mockInitService.mockClear();
        mockGetNetwork.mockClear();
        mockShutdownBatchInsertQueue.mockClear();
        mockFlushAll.mockClear();
        mockStartProgressLogging.mockClear();
        mockLogCompletion.mockClear();
        mockInitTokenOverrides.mockClear();
        mockCallContract.mockClear();
        mockGetContractCode.mockClear();
        mockDecodeSymbolHex.mockClear();
        mockDecodeNameHex.mockClear();
        mockDecodeNumberHex.mockClear();
        mockInsertRow.mockClear();
        mockIncrementSuccess.mockClear();
        mockIncrementError.mockClear();

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
        mockDecodeNumberHex.mockReturnValue(18);
        mockInsertRow.mockReturnValue(Promise.resolve(true));
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

    test('should flush batch queue before applying overrides', async () => {
        const callOrder: string[] = [];
        mockFlushAll.mockImplementation(() => {
            callOrder.push('flushAll');
            return Promise.resolve();
        });
        mockInitTokenOverrides.mockImplementation(() => {
            callOrder.push('initTokenOverrides');
            return Promise.resolve();
        });

        await run('transfers');

        expect(mockFlushAll).toHaveBeenCalledTimes(1);
        expect(mockInitTokenOverrides).toHaveBeenCalledTimes(1);
        expect(callOrder).toEqual(['flushAll', 'initTokenOverrides']);
    });

    test('should shutdown batch insert queue after completion', async () => {
        await run('transfers');

        expect(mockShutdownBatchInsertQueue).toHaveBeenCalled();
    });
});

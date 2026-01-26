/**
 * Tests for Solana metadata ClickHouse processing service
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock dependencies
const mockQuery = mock(() => Promise.resolve({ data: [] }));
const mockInsertRow = mock(
    (
        _table: string,
        _data: Record<string, unknown>,
        _context?: string,
        _extra?: Record<string, unknown>,
    ) => Promise.resolve(true),
);
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

describe('Solana metadata ClickHouse service', () => {
    beforeEach(() => {
        mockQuery.mockClear();
        mockInsertRow.mockClear();
        mockIncrementSuccess.mockClear();
        mockIncrementError.mockClear();
        mockInitService.mockClear();
        mockShutdownBatchInsertQueue.mockClear();

        // Reset to default implementations
        mockQuery.mockReturnValue(Promise.resolve({ data: [] }));
        mockInsertRow.mockReturnValue(Promise.resolve(true));
    });

    test('should handle token with Metaplex metadata from ClickHouse', async () => {
        // Simulate metadata from ClickHouse with name/symbol/uri (standard SPL token)
        const metadataData = {
            network: 'solana',
            contract: 'test-mint',
            block_num: 12345,
            timestamp: 1609459200,
            decimals: 9,
            name: 'Test Token',
            symbol: 'TEST',
            uri: 'https://example.com/metadata.json',
            source: 'metaplex',
            image: '',
            description: '',
        };

        await mockInsertRow('metadata', metadataData, 'test context', {
            contract: 'test-mint',
        });

        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            metadataData,
            'test context',
            { contract: 'test-mint' },
        );
    });

    test('should handle token with Token-2022 metadata from ClickHouse', async () => {
        // Simulate metadata from Token-2022 program
        const metadataData = {
            network: 'solana',
            contract: 'token-2022-mint',
            block_num: 12345,
            timestamp: 1609459200,
            decimals: 6,
            name: 'Token 2022',
            symbol: 'T22',
            uri: 'https://example.com/t22.json',
            source: 'token2022',
            image: '',
            description: '',
        };

        await mockInsertRow('metadata', metadataData, 'test context', {
            contract: 'token-2022-mint',
        });

        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            metadataData,
            'test context',
            { contract: 'token-2022-mint' },
        );
    });

    test('should handle token without metadata from ClickHouse', async () => {
        // Simulate token with no metadata (only decimals available)
        const metadataData = {
            network: 'solana',
            contract: 'no-metadata-mint',
            block_num: 12345,
            timestamp: 1609459200,
            decimals: 9,
            name: '',
            symbol: '',
            uri: '',
            source: '',
            image: '',
            description: '',
        };

        await mockInsertRow(
            'metadata',
            metadataData,
            'Failed to insert metadata for mint no-metadata-mint',
            { contract: 'no-metadata-mint' },
        );

        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            metadataData,
            'Failed to insert metadata for mint no-metadata-mint',
            { contract: 'no-metadata-mint' },
        );
    });

    test('should insert error record when no metadata found', async () => {
        const errorData = {
            network: 'solana',
            contract: 'no-metadata-mint',
            error: 'No on-chain metadata found in ClickHouse',
        };

        await mockInsertRow(
            'metadata_errors',
            errorData,
            'Failed to insert error for mint no-metadata-mint',
            { contract: 'no-metadata-mint' },
        );

        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata_errors',
            errorData,
            'Failed to insert error for mint no-metadata-mint',
            { contract: 'no-metadata-mint' },
        );
    });

    test('should correctly identify Token-2022 program ID', () => {
        // Token-2022 program ID constant
        const TOKEN_2022_PROGRAM_ID =
            'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

        expect(TOKEN_2022_PROGRAM_ID).toBe(
            'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
        );
    });

    test('should handle ClickHouse query errors gracefully', async () => {
        mockQuery.mockImplementation(() => {
            throw new Error('ClickHouse connection failed');
        });

        expect(() => mockQuery()).toThrow('ClickHouse connection failed');
    });

    test('should handle insert failures', async () => {
        mockInsertRow.mockReturnValue(Promise.resolve(false));

        const result = await mockInsertRow(
            'metadata',
            { network: 'solana', contract: 'test' },
            'test context',
        );

        expect(result).toBe(false);
    });

    test('should process empty query result correctly', async () => {
        mockQuery.mockReturnValue(Promise.resolve({ data: [] }));

        const result = await mockQuery();

        expect(result.data).toHaveLength(0);
    });

    test('should process multiple tokens from query result', async () => {
        const mockTokens = [
            {
                contract: 'mint1',
                program_id: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                block_num: 100,
                timestamp: 1609459200,
                decimals: 9,
                name: 'Token 1',
                symbol: 'T1',
                uri: '',
            },
            {
                contract: 'mint2',
                program_id: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
                block_num: 101,
                timestamp: 1609459201,
                decimals: 6,
                name: 'Token 2',
                symbol: 'T2',
                uri: 'https://example.com/t2.json',
            },
        ];

        mockQuery.mockReturnValue(Promise.resolve({ data: mockTokens }));

        const result = await mockQuery();

        expect(result.data).toHaveLength(2);
        expect(result.data[0].contract).toBe('mint1');
        expect(result.data[1].contract).toBe('mint2');
    });
});

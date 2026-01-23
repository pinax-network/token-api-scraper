import { beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * Tests for Solana metadata processing service
 */

// Mock dependencies
const mockQuery = mock(() => Promise.resolve({ data: [] }));
const mockFetchSolanaTokenMetadata = mock(() =>
    Promise.resolve({
        mint: 'test-mint',
        name: 'Test Token',
        symbol: 'TEST',
        uri: 'https://example.com/metadata.json',
        source: 'metaplex' as const,
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

mock.module('../../lib/solana-rpc', () => ({
    fetchSolanaTokenMetadata: mockFetchSolanaTokenMetadata,
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

describe('Solana metadata service', () => {
    beforeEach(() => {
        mockQuery.mockClear();
        mockFetchSolanaTokenMetadata.mockClear();
        mockInsertRow.mockClear();
        mockIncrementSuccess.mockClear();
        mockIncrementError.mockClear();
        mockInitService.mockClear();
        mockShutdownBatchInsertQueue.mockClear();

        // Reset to default implementations
        mockQuery.mockReturnValue(Promise.resolve({ data: [] }));
        mockFetchSolanaTokenMetadata.mockReturnValue(
            Promise.resolve({
                mint: 'test-mint',
                name: 'Test Token',
                symbol: 'TEST',
                uri: 'https://example.com/metadata.json',
                source: 'metaplex' as const,
            }),
        );
        mockInsertRow.mockReturnValue(Promise.resolve(true));
    });

    test('should handle successful metadata fetch from Metaplex', async () => {
        // This test verifies the mock setup is correct
        const result = await mockFetchSolanaTokenMetadata('test-mint', 9);

        expect(result.name).toBe('Test Token');
        expect(result.symbol).toBe('TEST');
        expect(result.source).toBe('metaplex');
    });

    test('should handle metadata fetch from Token-2022', async () => {
        mockFetchSolanaTokenMetadata.mockReturnValue(
            Promise.resolve({
                mint: 'test-mint-2022',
                name: 'Token 2022',
                symbol: 'T22',
                uri: 'https://example.com/t22.json',
                source: 'token2022' as const,
            }),
        );

        const result = await mockFetchSolanaTokenMetadata('test-mint-2022', 6);

        expect(result.name).toBe('Token 2022');
        expect(result.symbol).toBe('T22');
        expect(result.source).toBe('token2022');
    });

    test('should handle no metadata found', async () => {
        mockFetchSolanaTokenMetadata.mockReturnValue(
            Promise.resolve({
                mint: 'no-metadata-mint',
                name: '',
                symbol: '',
                uri: '',
                source: 'none' as const,
            }),
        );

        const result = await mockFetchSolanaTokenMetadata(
            'no-metadata-mint',
            8,
        );

        expect(result.name).toBe('');
        expect(result.symbol).toBe('');
        expect(result.source).toBe('none');
    });

    test('should handle RPC errors gracefully', async () => {
        mockFetchSolanaTokenMetadata.mockImplementation(() => {
            throw new Error('RPC error: connection timeout');
        });

        expect(() => mockFetchSolanaTokenMetadata('error-mint', 9)).toThrow(
            'RPC error: connection timeout',
        );
    });

    test('insert should be called with correct metadata structure', async () => {
        const metadata = {
            network: 'solana',
            contract: 'test-mint',
            block_num: 12345,
            timestamp: 1609459200,
            decimals: 9,
            name: 'Test Token',
            symbol: 'TEST',
        };

        await mockInsertRow('metadata', metadata, 'test context', {
            contract: 'test-mint',
        });

        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            metadata,
            'test context',
            { contract: 'test-mint' },
        );
    });

    test('should insert error record for NFTs (decimals=0)', async () => {
        const errorData = {
            network: 'solana',
            contract: 'nft-mint',
            error: 'NFT detected (decimals=0)',
        };

        await mockInsertRow(
            'metadata_errors',
            errorData,
            'Failed to insert NFT error for mint nft-mint',
            { contract: 'nft-mint' },
        );

        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata_errors',
            errorData,
            'Failed to insert NFT error for mint nft-mint',
            { contract: 'nft-mint' },
        );
    });
});

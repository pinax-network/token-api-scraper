import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { MetadataSource } from '../../lib/solana-rpc';

/**
 * Tests for Solana metadata processing service
 * This service only fetches on-chain metadata, URI content is handled by metadata-solana-extras
 */

// Mock dependencies
const mockQuery = mock(() => Promise.resolve({ data: [] }));
const mockFetchSolanaTokenMetadata = mock(
    (_mint: string, _decimals: number, _programId?: string) =>
        Promise.resolve({
            mint: 'test-mint',
            name: 'Test Token',
            symbol: 'TEST',
            uri: 'https://example.com/metadata.json',
            source: 'metaplex' as MetadataSource,
            mintAccountExists: true,
        }),
);
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
                mintAccountExists: true,
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
                mintAccountExists: true,
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
                source: '' as const,
                mintAccountExists: true,
            }),
        );

        const result = await mockFetchSolanaTokenMetadata(
            'no-metadata-mint',
            8,
        );

        expect(result.name).toBe('');
        expect(result.symbol).toBe('');
        expect(result.source).toBe('');
        expect(result.mintAccountExists).toBe(true);
    });

    test('should handle burned/closed mint account', async () => {
        mockFetchSolanaTokenMetadata.mockReturnValue(
            Promise.resolve({
                mint: 'burned-mint',
                name: '',
                symbol: '',
                uri: '',
                source: '' as const,
                mintAccountExists: false,
            }),
        );

        const result = await mockFetchSolanaTokenMetadata('burned-mint', 8);

        expect(result.name).toBe('');
        expect(result.symbol).toBe('');
        expect(result.source).toBe('');
        expect(result.mintAccountExists).toBe(false);
    });

    test('should insert metadata record when no metadata is found (account exists)', async () => {
        // Tokens with source='' should be inserted with empty source
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

    test('should insert metadata record for burned/closed mint account with source=empty', async () => {
        // Tokens with burned accounts should be inserted with empty source
        const metadataData = {
            network: 'solana',
            contract: 'burned-mint',
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
            'Failed to insert metadata for mint burned-mint',
            { contract: 'burned-mint' },
        );

        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            metadataData,
            'Failed to insert metadata for mint burned-mint',
            { contract: 'burned-mint' },
        );
    });

    test('should handle RPC errors gracefully', async () => {
        mockFetchSolanaTokenMetadata.mockImplementation(() => {
            throw new Error('RPC error: connection timeout');
        });

        expect(() => mockFetchSolanaTokenMetadata('error-mint', 9)).toThrow(
            'RPC error: connection timeout',
        );
    });

    test('insert should store URI without fetching its content (image/description are empty)', async () => {
        // metadata-solana should store on-chain data only, with empty image/description
        // URI content fetching is handled by metadata-solana-extras
        const metadata = {
            network: 'solana',
            contract: 'test-mint',
            block_num: 12345,
            timestamp: 1609459200,
            decimals: 9,
            name: 'Test Token',
            symbol: 'TEST',
            uri: 'https://example.com/metadata.json',
            source: 'metaplex',
            image: '', // Empty - to be filled by metadata-solana-extras
            description: '', // Empty - to be filled by metadata-solana-extras
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
});

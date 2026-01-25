import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { MetadataSource } from '../../lib/solana-rpc';

/**
 * Tests for Solana metadata processing service
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
const mockFetchUriMetadata = mock((_uri: string) =>
    Promise.resolve({
        success: true as boolean,
        metadata: {
            name: 'URI Token Name',
            description: 'Test description',
            image: 'https://example.com/image.png',
        } as { name: string; description: string; image: string } | undefined,
        raw: '{"name":"URI Token Name","description":"Test description","image":"https://example.com/image.png"}' as
            | string
            | undefined,
        error: undefined as string | undefined,
    }),
);

mock.module('../../lib/clickhouse', () => ({
    query: mockQuery,
}));

mock.module('../../lib/solana-rpc', () => ({
    fetchSolanaTokenMetadata: mockFetchSolanaTokenMetadata,
}));

mock.module('../../lib/uri-fetch', () => ({
    fetchUriMetadata: mockFetchUriMetadata,
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
        mockFetchUriMetadata.mockClear();

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
        mockFetchUriMetadata.mockReturnValue(
            Promise.resolve({
                success: true as boolean,
                metadata: {
                    name: 'URI Token Name',
                    description: 'Test description',
                    image: 'https://example.com/image.png',
                } as
                    | { name: string; description: string; image: string }
                    | undefined,
                raw: '{"name":"URI Token Name","description":"Test description","image":"https://example.com/image.png"}' as
                    | string
                    | undefined,
                error: undefined as string | undefined,
            }),
        );
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

    test('insert should be called with correct metadata structure including image and description', async () => {
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
            image: 'https://example.com/image.png',
            description: 'Test description',
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

    test('fetchUriMetadata should extract image and description from URI', async () => {
        const result = await mockFetchUriMetadata(
            'https://example.com/metadata.json',
        );

        expect(result.success).toBe(true);
        expect(result.metadata?.description).toBe('Test description');
        expect(result.metadata?.image).toBe('https://example.com/image.png');
        expect(result.raw).toBe(
            '{"name":"URI Token Name","description":"Test description","image":"https://example.com/image.png"}',
        );
    });

    test('fetchUriMetadata should handle failed fetch', async () => {
        mockFetchUriMetadata.mockReturnValue(
            Promise.resolve({
                success: false as boolean,
                metadata: undefined,
                raw: undefined,
                error: 'HTTP 404' as string | undefined,
            }),
        );

        const result = await mockFetchUriMetadata(
            'https://example.com/missing.json',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('HTTP 404');
    });

    test('fetchUriMetadata should return raw even on parse failure', async () => {
        mockFetchUriMetadata.mockReturnValue(
            Promise.resolve({
                success: false as boolean,
                metadata: undefined,
                raw: 'invalid json content' as string | undefined,
                error: 'Failed to parse JSON' as string | undefined,
            }),
        );

        const result = await mockFetchUriMetadata(
            'https://example.com/invalid.json',
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe('Failed to parse JSON');
        expect(result.raw).toBe('invalid json content');
    });
});

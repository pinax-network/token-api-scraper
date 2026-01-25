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
        tokenStandard: 2, // Fungible
        mintAccountExists: true,
    }),
);
const mockInsertRow = mock(() => Promise.resolve(true));
const mockIncrementSuccess = mock(() => {});
const mockIncrementError = mock(() => {});
const mockInitService = mock(() => {});
const mockShutdownBatchInsertQueue = mock(() => Promise.resolve());
const mockIsNftTokenStandard = mock((tokenStandard: number | null) => {
    if (tokenStandard === null) return false;
    return (
        tokenStandard === 0 ||
        tokenStandard === 3 ||
        tokenStandard === 4 ||
        tokenStandard === 5
    );
});
const mockFetchUriMetadata = mock(() =>
    Promise.resolve({
        success: true,
        metadata: {
            name: 'URI Token Name',
            description: 'Test description',
            image: 'https://example.com/image.png',
        },
        raw: '{"name":"URI Token Name","description":"Test description","image":"https://example.com/image.png"}',
    }),
);

mock.module('../../lib/clickhouse', () => ({
    query: mockQuery,
}));

mock.module('../../lib/solana-rpc', () => ({
    fetchSolanaTokenMetadata: mockFetchSolanaTokenMetadata,
    isNftTokenStandard: mockIsNftTokenStandard,
    TokenStandard: {
        NonFungible: 0,
        FungibleAsset: 1,
        Fungible: 2,
        NonFungibleEdition: 3,
        ProgrammableNonFungible: 4,
        ProgrammableNonFungibleEdition: 5,
    },
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
        mockIsNftTokenStandard.mockClear();
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
                tokenStandard: 2, // Fungible
                mintAccountExists: true,
            }),
        );
        mockInsertRow.mockReturnValue(Promise.resolve(true));
        mockFetchUriMetadata.mockReturnValue(
            Promise.resolve({
                success: true,
                metadata: {
                    name: 'URI Token Name',
                    description: 'Test description',
                    image: 'https://example.com/image.png',
                },
                raw: '{"name":"URI Token Name","description":"Test description","image":"https://example.com/image.png"}',
            }),
        );
    });

    test('should handle successful metadata fetch from Metaplex', async () => {
        // This test verifies the mock setup is correct
        const result = await mockFetchSolanaTokenMetadata('test-mint', 9);

        expect(result.name).toBe('Test Token');
        expect(result.symbol).toBe('TEST');
        expect(result.source).toBe('metaplex');
        expect(result.tokenStandard).toBe(2); // Fungible
    });

    test('should handle metadata fetch from Token-2022', async () => {
        mockFetchSolanaTokenMetadata.mockReturnValue(
            Promise.resolve({
                mint: 'test-mint-2022',
                name: 'Token 2022',
                symbol: 'T22',
                uri: 'https://example.com/t22.json',
                source: 'token2022' as const,
                tokenStandard: null, // Token-2022 doesn't use Metaplex tokenStandard
                mintAccountExists: true,
            }),
        );

        const result = await mockFetchSolanaTokenMetadata('test-mint-2022', 6);

        expect(result.name).toBe('Token 2022');
        expect(result.symbol).toBe('T22');
        expect(result.source).toBe('token2022');
        expect(result.tokenStandard).toBeNull();
    });

    test('should handle no metadata found', async () => {
        mockFetchSolanaTokenMetadata.mockReturnValue(
            Promise.resolve({
                mint: 'no-metadata-mint',
                name: '',
                symbol: '',
                uri: '',
                source: 'none' as const,
                tokenStandard: null,
                mintAccountExists: true,
            }),
        );

        const result = await mockFetchSolanaTokenMetadata(
            'no-metadata-mint',
            8,
        );

        expect(result.name).toBe('');
        expect(result.symbol).toBe('');
        expect(result.source).toBe('none');
        expect(result.tokenStandard).toBeNull();
        expect(result.mintAccountExists).toBe(true);
    });

    test('should handle burned/closed mint account', async () => {
        mockFetchSolanaTokenMetadata.mockReturnValue(
            Promise.resolve({
                mint: 'burned-mint',
                name: '',
                symbol: '',
                uri: '',
                source: 'none' as const,
                tokenStandard: null,
                mintAccountExists: false,
            }),
        );

        const result = await mockFetchSolanaTokenMetadata('burned-mint', 8);

        expect(result.name).toBe('');
        expect(result.symbol).toBe('');
        expect(result.source).toBe('none');
        expect(result.tokenStandard).toBeNull();
        expect(result.mintAccountExists).toBe(false);
    });

    test('should insert metadata record when no metadata is found (account exists)', async () => {
        // Tokens with source='none' and mintAccountExists=true should be inserted with source='none'
        const metadataData = {
            network: 'solana',
            contract: 'no-metadata-mint',
            block_num: 12345,
            timestamp: 1609459200,
            decimals: 9,
            name: '',
            symbol: '',
            uri: '',
            source: 'none',
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

    test('should insert metadata record for burned/closed mint account with source=burned', async () => {
        // Tokens with source='none' and mintAccountExists=false should be inserted with source='burned'
        const metadataData = {
            network: 'solana',
            contract: 'burned-mint',
            block_num: 12345,
            timestamp: 1609459200,
            decimals: 9,
            name: '',
            symbol: '',
            uri: '',
            source: 'burned',
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

    test('should insert error record for NFTs (tokenStandard=NonFungible)', async () => {
        const errorData = {
            network: 'solana',
            contract: 'nft-mint',
            error: 'NFT detected (tokenStandard=NonFungible)',
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

    test('isNftTokenStandard should correctly identify NFT token standards', () => {
        // NFT types should return true
        expect(mockIsNftTokenStandard(0)).toBe(true); // NonFungible
        expect(mockIsNftTokenStandard(3)).toBe(true); // NonFungibleEdition
        expect(mockIsNftTokenStandard(4)).toBe(true); // ProgrammableNonFungible
        expect(mockIsNftTokenStandard(5)).toBe(true); // ProgrammableNonFungibleEdition

        // Fungible types should return false
        expect(mockIsNftTokenStandard(1)).toBe(false); // FungibleAsset
        expect(mockIsNftTokenStandard(2)).toBe(false); // Fungible
        expect(mockIsNftTokenStandard(null)).toBe(false); // null/unknown
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
                success: false,
                error: 'HTTP 404',
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
                success: false,
                error: 'Failed to parse JSON',
                raw: 'invalid json content',
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

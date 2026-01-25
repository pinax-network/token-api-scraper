/**
 * Tests for Solana metadata query service
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock dependencies
const mockGetAccountInfo = mock(() => Promise.resolve(null));
const mockDecodeMetaplexMetadata = mock(() => null);
const mockParseToken2022Extensions = mock(() => null);
const mockFindMetadataPda = mock(() => 'test-pda');
const mockIsPumpAmmLpToken = mock(() =>
    Promise.resolve({ isLpToken: false, poolAddress: null }),
);
const mockDerivePumpAmmLpMetadata = mock(() => Promise.resolve(null));
const mockIsMeteoraDlmmLpToken = mock(() =>
    Promise.resolve({ isLpToken: false, poolAddress: null }),
);
const mockDeriveMeteoraDlmmLpMetadata = mock(() => Promise.resolve(null));
const mockIsRaydiumAmmLpToken = mock(() =>
    Promise.resolve({ isLpToken: false, poolAddress: null, poolType: null }),
);
const mockDeriveRaydiumLpMetadata = mock(() => Promise.resolve(null));

mock.module('../../lib/solana-rpc', () => ({
    getAccountInfo: mockGetAccountInfo,
    decodeMetaplexMetadata: mockDecodeMetaplexMetadata,
    parseToken2022Extensions: mockParseToken2022Extensions,
    findMetadataPda: mockFindMetadataPda,
    isPumpAmmLpToken: mockIsPumpAmmLpToken,
    derivePumpAmmLpMetadata: mockDerivePumpAmmLpMetadata,
    isMeteoraDlmmLpToken: mockIsMeteoraDlmmLpToken,
    deriveMeteoraDlmmLpMetadata: mockDeriveMeteoraDlmmLpMetadata,
    isRaydiumAmmLpToken: mockIsRaydiumAmmLpToken,
    deriveRaydiumLpMetadata: mockDeriveRaydiumLpMetadata,
    TOKEN_PROGRAM_ID: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    TOKEN_2022_PROGRAM_ID: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    METAPLEX_PROGRAM_ID: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
    PUMP_AMM_PROGRAM_ID: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
    METEORA_DLMM_PROGRAM_ID: '24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi',
    RAYDIUM_AMM_PROGRAM_ID: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    RAYDIUM_CPMM_PROGRAM_ID: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
}));

// Import the queryMetadata function after mocking
const { queryMetadata } = await import('./query');

describe('Solana metadata query service', () => {
    beforeEach(() => {
        mockGetAccountInfo.mockClear();
        mockDecodeMetaplexMetadata.mockClear();
        mockParseToken2022Extensions.mockClear();
        mockFindMetadataPda.mockClear();
        mockIsPumpAmmLpToken.mockClear();
        mockDerivePumpAmmLpMetadata.mockClear();
        mockIsMeteoraDlmmLpToken.mockClear();
        mockDeriveMeteoraDlmmLpMetadata.mockClear();
        mockIsRaydiumAmmLpToken.mockClear();
        mockDeriveRaydiumLpMetadata.mockClear();

        // Reset to default implementations
        mockGetAccountInfo.mockReturnValue(Promise.resolve(null));
        mockDecodeMetaplexMetadata.mockReturnValue(null);
        mockParseToken2022Extensions.mockReturnValue(null);
        mockFindMetadataPda.mockReturnValue('test-pda');
        mockIsPumpAmmLpToken.mockReturnValue(
            Promise.resolve({ isLpToken: false, poolAddress: null }),
        );
        mockDerivePumpAmmLpMetadata.mockReturnValue(Promise.resolve(null));
        mockIsMeteoraDlmmLpToken.mockReturnValue(
            Promise.resolve({ isLpToken: false, poolAddress: null }),
        );
        mockDeriveMeteoraDlmmLpMetadata.mockReturnValue(Promise.resolve(null));
        mockIsRaydiumAmmLpToken.mockReturnValue(
            Promise.resolve({
                isLpToken: false,
                poolAddress: null,
                poolType: null,
            }),
        );
        mockDeriveRaydiumLpMetadata.mockReturnValue(Promise.resolve(null));
    });

    test('should validate mint address format', async () => {
        // Test with valid mint address (44 chars)
        mockGetAccountInfo.mockReturnValue(Promise.resolve(null));
        await queryMetadata('So11111111111111111111111111111111111111112');
        expect(mockFindMetadataPda).toHaveBeenCalled();
    });

    test('should reject invalid mint address (too short)', async () => {
        await queryMetadata('short');
        // Should not proceed to PDA lookup
        expect(mockFindMetadataPda).not.toHaveBeenCalled();
    });

    test('should detect standard SPL token', async () => {
        mockGetAccountInfo.mockReturnValue(
            Promise.resolve({
                data: 'test-data',
                executable: false,
                lamports: 1000000,
                owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                rentEpoch: 0,
            }),
        );

        await queryMetadata('So11111111111111111111111111111111111111112');

        // Should check for Metaplex metadata
        expect(mockGetAccountInfo).toHaveBeenCalled();
    });

    test('should detect Token-2022 token', async () => {
        mockGetAccountInfo.mockReturnValue(
            Promise.resolve({
                data: 'test-data',
                executable: false,
                lamports: 1000000,
                owner: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
                rentEpoch: 0,
            }),
        );

        await queryMetadata('So11111111111111111111111111111111111111112');

        // Should check for both Metaplex and Token-2022 metadata
        expect(mockGetAccountInfo).toHaveBeenCalled();
        expect(mockParseToken2022Extensions).toHaveBeenCalled();
    });

    test('should handle account not found', async () => {
        mockGetAccountInfo.mockReturnValue(Promise.resolve(null));

        // Should complete without throwing
        await queryMetadata('So11111111111111111111111111111111111111112');

        expect(mockGetAccountInfo).toHaveBeenCalled();
    });

    test('should handle RPC errors gracefully', async () => {
        mockGetAccountInfo.mockImplementation(() => {
            throw new Error('RPC connection failed');
        });

        // Should not throw, just log the error
        await queryMetadata('So11111111111111111111111111111111111111112');
    });

    test('should decode Metaplex metadata when found', async () => {
        // First call for mint account
        mockGetAccountInfo
            .mockReturnValueOnce(
                Promise.resolve({
                    data: 'mint-data',
                    executable: false,
                    lamports: 1000000,
                    owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                    rentEpoch: 0,
                }),
            )
            // Second call for metadata PDA
            .mockReturnValueOnce(
                Promise.resolve({
                    data: 'metaplex-data',
                    executable: false,
                    lamports: 1000000,
                    owner: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
                    rentEpoch: 0,
                }),
            );

        mockDecodeMetaplexMetadata.mockReturnValue({
            name: 'Test Token',
            symbol: 'TEST',
            uri: 'https://example.com/metadata.json',
            sellerFeeBasisPoints: 0,
            primarySaleHappened: false,
            isMutable: true,
        });

        await queryMetadata('So11111111111111111111111111111111111111112');

        expect(mockDecodeMetaplexMetadata).toHaveBeenCalled();
    });
});

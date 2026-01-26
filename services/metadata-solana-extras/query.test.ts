/**
 * Tests for Solana LP metadata query service
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock dependencies
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

mock.module('../../lib/solana/index', () => ({
    isPumpAmmLpToken: mockIsPumpAmmLpToken,
    derivePumpAmmLpMetadata: mockDerivePumpAmmLpMetadata,
    isMeteoraDlmmLpToken: mockIsMeteoraDlmmLpToken,
    deriveMeteoraDlmmLpMetadata: mockDeriveMeteoraDlmmLpMetadata,
    isRaydiumAmmLpToken: mockIsRaydiumAmmLpToken,
    deriveRaydiumLpMetadata: mockDeriveRaydiumLpMetadata,
    PUMP_AMM_PROGRAM_ID: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
    METEORA_DLMM_PROGRAM_ID: '24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi',
    RAYDIUM_AMM_PROGRAM_ID: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    RAYDIUM_CPMM_PROGRAM_ID: 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',
}));

// Import the queryLpMetadata function after mocking
const { queryLpMetadata } = await import('./query');

describe('Solana LP metadata query service', () => {
    beforeEach(() => {
        mockIsPumpAmmLpToken.mockClear();
        mockDerivePumpAmmLpMetadata.mockClear();
        mockIsMeteoraDlmmLpToken.mockClear();
        mockDeriveMeteoraDlmmLpMetadata.mockClear();
        mockIsRaydiumAmmLpToken.mockClear();
        mockDeriveRaydiumLpMetadata.mockClear();

        // Reset to default implementations
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
        await queryLpMetadata('So11111111111111111111111111111111111111112');
        expect(mockIsPumpAmmLpToken).toHaveBeenCalled();
    });

    test('should reject invalid mint address (too short)', async () => {
        await queryLpMetadata('short');
        // Should not proceed to LP checks
        expect(mockIsPumpAmmLpToken).not.toHaveBeenCalled();
    });

    test('should detect Pump.fun AMM LP token', async () => {
        mockIsPumpAmmLpToken.mockReturnValue(
            Promise.resolve({
                isLpToken: true,
                poolAddress: 'pool123456789012345678901234567890123456',
            }),
        );
        mockDerivePumpAmmLpMetadata.mockReturnValue(
            Promise.resolve({
                name: 'Pump AMM LP',
                symbol: 'PUMP-LP',
            }),
        );

        await queryLpMetadata('So11111111111111111111111111111111111111112');

        expect(mockIsPumpAmmLpToken).toHaveBeenCalled();
        expect(mockDerivePumpAmmLpMetadata).toHaveBeenCalled();
    });

    test('should detect Meteora DLMM LP token', async () => {
        mockIsMeteoraDlmmLpToken.mockReturnValue(
            Promise.resolve({
                isLpToken: true,
                poolAddress: 'pool123456789012345678901234567890123456',
            }),
        );
        mockDeriveMeteoraDlmmLpMetadata.mockReturnValue(
            Promise.resolve({
                name: 'Meteora DLMM LP',
                symbol: 'DLMM-LP',
            }),
        );

        await queryLpMetadata('So11111111111111111111111111111111111111112');

        expect(mockIsMeteoraDlmmLpToken).toHaveBeenCalled();
        expect(mockDeriveMeteoraDlmmLpMetadata).toHaveBeenCalled();
    });

    test('should detect Raydium LP token', async () => {
        mockIsRaydiumAmmLpToken.mockReturnValue(
            Promise.resolve({
                isLpToken: true,
                poolAddress: 'pool123456789012345678901234567890123456',
                poolType: 'amm-v4',
            }),
        );
        mockDeriveRaydiumLpMetadata.mockReturnValue(
            Promise.resolve({
                name: 'Raydium LP',
                symbol: 'RAY-LP',
            }),
        );

        await queryLpMetadata('So11111111111111111111111111111111111111112');

        expect(mockIsRaydiumAmmLpToken).toHaveBeenCalled();
        expect(mockDeriveRaydiumLpMetadata).toHaveBeenCalled();
    });

    test('should handle non-LP token gracefully', async () => {
        // All checks return false
        mockIsPumpAmmLpToken.mockReturnValue(
            Promise.resolve({ isLpToken: false, poolAddress: null }),
        );
        mockIsMeteoraDlmmLpToken.mockReturnValue(
            Promise.resolve({ isLpToken: false, poolAddress: null }),
        );
        mockIsRaydiumAmmLpToken.mockReturnValue(
            Promise.resolve({
                isLpToken: false,
                poolAddress: null,
                poolType: null,
            }),
        );

        // Should complete without throwing
        await queryLpMetadata('So11111111111111111111111111111111111111112');

        expect(mockIsPumpAmmLpToken).toHaveBeenCalled();
        expect(mockIsMeteoraDlmmLpToken).toHaveBeenCalled();
        expect(mockIsRaydiumAmmLpToken).toHaveBeenCalled();
    });

    test('should handle RPC errors gracefully', async () => {
        mockIsPumpAmmLpToken.mockImplementation(() => {
            throw new Error('RPC connection failed');
        });

        // Should not throw, just log the error
        await queryLpMetadata('So11111111111111111111111111111111111111112');

        // Should still attempt other checks
        expect(mockIsMeteoraDlmmLpToken).toHaveBeenCalled();
        expect(mockIsRaydiumAmmLpToken).toHaveBeenCalled();
    });

    test('should handle pool address not found for Raydium', async () => {
        mockIsRaydiumAmmLpToken.mockReturnValue(
            Promise.resolve({
                isLpToken: true,
                poolAddress: null, // Pool address not found
                poolType: 'amm-v4',
            }),
        );

        await queryLpMetadata('So11111111111111111111111111111111111111112');

        expect(mockIsRaydiumAmmLpToken).toHaveBeenCalled();
        // Should not attempt to derive metadata without pool address
        expect(mockDeriveRaydiumLpMetadata).not.toHaveBeenCalled();
    });
});

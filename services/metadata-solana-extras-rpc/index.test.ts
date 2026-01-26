/**
 * Tests for Solana metadata extras processing service
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

mock.module('../../lib/clickhouse', () => ({
    query: mockQuery,
}));

mock.module('../../lib/solana/index', () => ({
    isPumpAmmLpToken: mockIsPumpAmmLpToken,
    derivePumpAmmLpMetadata: mockDerivePumpAmmLpMetadata,
    isMeteoraDlmmLpToken: mockIsMeteoraDlmmLpToken,
    deriveMeteoraDlmmLpMetadata: mockDeriveMeteoraDlmmLpMetadata,
    isRaydiumAmmLpToken: mockIsRaydiumAmmLpToken,
    deriveRaydiumLpMetadata: mockDeriveRaydiumLpMetadata,
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

describe('Solana metadata extras service', () => {
    beforeEach(() => {
        mockQuery.mockClear();
        mockInsertRow.mockClear();
        mockIncrementSuccess.mockClear();
        mockIncrementError.mockClear();
        mockInitService.mockClear();
        mockShutdownBatchInsertQueue.mockClear();
        mockIsPumpAmmLpToken.mockClear();
        mockDerivePumpAmmLpMetadata.mockClear();
        mockIsMeteoraDlmmLpToken.mockClear();
        mockDeriveMeteoraDlmmLpMetadata.mockClear();
        mockIsRaydiumAmmLpToken.mockClear();
        mockDeriveRaydiumLpMetadata.mockClear();

        // Reset to default implementations
        mockQuery.mockReturnValue(Promise.resolve({ data: [] }));
        mockInsertRow.mockReturnValue(Promise.resolve(true));
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

    test('should detect Pump.fun AMM LP token', async () => {
        mockIsPumpAmmLpToken.mockReturnValue(
            Promise.resolve({
                isLpToken: true,
                poolAddress: 'test-pool-address',
            }),
        );
        mockDerivePumpAmmLpMetadata.mockReturnValue(
            Promise.resolve({
                name: 'Pump.fun AMM (SOL-TEST) LP Token',
                symbol: 'SOL-TEST-LP',
            }),
        );

        const result = await mockIsPumpAmmLpToken('test-mint');
        expect(result.isLpToken).toBe(true);
        expect(result.poolAddress).toBe('test-pool-address');

        const lpMetadata =
            await mockDerivePumpAmmLpMetadata('test-pool-address');
        expect(lpMetadata?.name).toBe('Pump.fun AMM (SOL-TEST) LP Token');
        expect(lpMetadata?.symbol).toBe('SOL-TEST-LP');
    });

    test('should detect Meteora DLMM LP token', async () => {
        mockIsMeteoraDlmmLpToken.mockReturnValue(
            Promise.resolve({
                isLpToken: true,
                poolAddress: 'meteora-pool-address',
            }),
        );
        mockDeriveMeteoraDlmmLpMetadata.mockReturnValue(
            Promise.resolve({
                name: 'Meteora DLMM SOL-USDC LP',
                symbol: 'SOL-USDC-LP',
            }),
        );

        const result = await mockIsMeteoraDlmmLpToken('test-mint');
        expect(result.isLpToken).toBe(true);
        expect(result.poolAddress).toBe('meteora-pool-address');

        const lpMetadata = await mockDeriveMeteoraDlmmLpMetadata(
            'meteora-pool-address',
        );
        expect(lpMetadata?.name).toBe('Meteora DLMM SOL-USDC LP');
        expect(lpMetadata?.symbol).toBe('SOL-USDC-LP');
    });

    test('should detect Raydium AMM LP token', async () => {
        mockIsRaydiumAmmLpToken.mockReturnValue(
            Promise.resolve({
                isLpToken: true,
                poolAddress: 'raydium-pool-address',
                poolType: 'amm-v4' as const,
            }),
        );
        mockDeriveRaydiumLpMetadata.mockReturnValue(
            Promise.resolve({
                name: 'Raydium (SOL-USDC) LP Token',
                symbol: 'SOL-USDC-LP',
            }),
        );

        const result = await mockIsRaydiumAmmLpToken('test-mint');
        expect(result.isLpToken).toBe(true);
        expect(result.poolAddress).toBe('raydium-pool-address');
        expect(result.poolType).toBe('amm-v4');

        const lpMetadata = await mockDeriveRaydiumLpMetadata(
            'raydium-pool-address',
            'amm-v4',
        );
        expect(lpMetadata?.name).toBe('Raydium (SOL-USDC) LP Token');
        expect(lpMetadata?.symbol).toBe('SOL-USDC-LP');
    });

    test('should detect Raydium CPMM LP token', async () => {
        mockIsRaydiumAmmLpToken.mockReturnValue(
            Promise.resolve({
                isLpToken: true,
                poolAddress: 'cpmm-pool-address',
                poolType: 'cpmm' as const,
            }),
        );
        mockDeriveRaydiumLpMetadata.mockReturnValue(
            Promise.resolve({
                name: 'Raydium (TOKEN-SOL) LP Token',
                symbol: 'TOKEN-SOL-LP',
            }),
        );

        const result = await mockIsRaydiumAmmLpToken('test-mint');
        expect(result.isLpToken).toBe(true);
        expect(result.poolAddress).toBe('cpmm-pool-address');
        expect(result.poolType).toBe('cpmm');

        const lpMetadata = await mockDeriveRaydiumLpMetadata(
            'cpmm-pool-address',
            'cpmm',
        );
        expect(lpMetadata?.name).toBe('Raydium (TOKEN-SOL) LP Token');
        expect(lpMetadata?.symbol).toBe('TOKEN-SOL-LP');
    });

    test('should handle token that is not an LP token', async () => {
        const pumpResult = await mockIsPumpAmmLpToken('regular-token');
        expect(pumpResult.isLpToken).toBe(false);

        const meteoraResult = await mockIsMeteoraDlmmLpToken('regular-token');
        expect(meteoraResult.isLpToken).toBe(false);

        const raydiumResult = await mockIsRaydiumAmmLpToken('regular-token');
        expect(raydiumResult.isLpToken).toBe(false);
    });

    test('should handle LP detection errors gracefully', async () => {
        mockIsPumpAmmLpToken.mockImplementation(() => {
            throw new Error('RPC error');
        });

        expect(() => mockIsPumpAmmLpToken('error-mint')).toThrow('RPC error');
    });

    test('should insert LP metadata correctly when detected', async () => {
        const metadataData = {
            network: 'solana',
            contract: 'lp-mint',
            block_num: 12345,
            timestamp: 1609459200,
            decimals: 9,
            name: 'Pump.fun AMM (SOL-TEST) LP Token',
            symbol: 'SOL-TEST-LP',
            uri: '',
            source: 'pump-amm',
            image: '',
            description: '',
        };

        await mockInsertRow('metadata', metadataData, 'test context', {
            contract: 'lp-mint',
        });

        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            metadataData,
            'test context',
            { contract: 'lp-mint' },
        );
    });
});

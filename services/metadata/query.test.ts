/**
 * Tests for EVM metadata query service
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock dependencies - must be defined BEFORE mock.module calls
const mockCallContract = mock(() => Promise.resolve(''));
const mockGetContractCode = mock(() => Promise.resolve('0x'));
const mockDecodeSymbolHex = mock(() => '');
const mockDecodeNameHex = mock(() => '');
const mockDecodeNumberHex = mock<() => number | null>(() => null);

// Mock modules BEFORE importing the module under test
mock.module('../../lib/rpc', () => ({
    callContract: mockCallContract,
    getContractCode: mockGetContractCode,
}));

mock.module('../../lib/hex-decode', () => ({
    decodeSymbolHex: mockDecodeSymbolHex,
    decodeNameHex: mockDecodeNameHex,
    decodeNumberHex: mockDecodeNumberHex,
}));

// Import module under test AFTER setting up mocks
const { queryMetadata } = await import('./query');

describe('EVM metadata query service', () => {
    beforeEach(() => {
        mockCallContract.mockClear();
        mockGetContractCode.mockClear();
        mockDecodeSymbolHex.mockClear();
        mockDecodeNameHex.mockClear();
        mockDecodeNumberHex.mockClear();

        // Reset to default implementations
        mockCallContract.mockReturnValue(Promise.resolve(''));
        mockGetContractCode.mockReturnValue(Promise.resolve('0x'));
        mockDecodeSymbolHex.mockReturnValue('');
        mockDecodeNameHex.mockReturnValue('');
        mockDecodeNumberHex.mockReturnValue(null);
    });

    test('should validate EVM hex address format', async () => {
        // Test with valid EVM address
        mockGetContractCode.mockReturnValue(
            Promise.resolve(
                '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe',
            ),
        );

        await queryMetadata('0x1234567890123456789012345678901234567890');

        // Should proceed to fetch contract code
        expect(mockGetContractCode).toHaveBeenCalled();
    });

    test('should validate TRON base58 address format', async () => {
        // Test with valid TRON address
        mockGetContractCode.mockReturnValue(
            Promise.resolve(
                '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe',
            ),
        );

        await queryMetadata('TJCnKsPa7y5okkXvQAidZBzqx3QyQ6sxMW');

        // Should proceed to fetch contract code
        expect(mockGetContractCode).toHaveBeenCalled();
    });

    test('should reject invalid address (too short)', async () => {
        await queryMetadata('0x1234');

        // Should not proceed to contract code check
        expect(mockGetContractCode).not.toHaveBeenCalled();
    });

    test('should reject invalid address (wrong format)', async () => {
        await queryMetadata('invalid-address');

        // Should not proceed to contract code check
        expect(mockGetContractCode).not.toHaveBeenCalled();
    });

    test('should detect contract with no code', async () => {
        mockGetContractCode.mockReturnValue(Promise.resolve('0x'));

        await queryMetadata('0x1234567890123456789012345678901234567890');

        expect(mockGetContractCode).toHaveBeenCalled();
        // Should still try to call decimals() even with no code
        expect(mockCallContract).toHaveBeenCalled();
    });

    test('should fetch all token metadata (decimals, symbol, name)', async () => {
        mockGetContractCode.mockReturnValue(
            Promise.resolve(
                '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe',
            ),
        );
        mockCallContract.mockImplementation((_contract, signature) => {
            if (signature === 'decimals()') return Promise.resolve('0x12');
            if (signature === 'symbol()') return Promise.resolve('0xSYM');
            if (signature === 'name()') return Promise.resolve('0xNAME');
            return Promise.resolve('');
        });
        mockDecodeNumberHex.mockReturnValue(18);
        mockDecodeSymbolHex.mockReturnValue('USDT');
        mockDecodeNameHex.mockReturnValue('Tether USD');

        await queryMetadata('0x1234567890123456789012345678901234567890');

        // All methods should be called
        expect(mockGetContractCode).toHaveBeenCalled();
        expect(mockCallContract).toHaveBeenCalledTimes(3);
        expect(mockDecodeNumberHex).toHaveBeenCalled();
        expect(mockDecodeSymbolHex).toHaveBeenCalled();
        expect(mockDecodeNameHex).toHaveBeenCalled();
    });

    test('should handle missing symbol() gracefully', async () => {
        mockGetContractCode.mockReturnValue(
            Promise.resolve(
                '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe',
            ),
        );
        mockCallContract.mockImplementation((_contract, signature) => {
            if (signature === 'decimals()') return Promise.resolve('0x12');
            if (signature === 'symbol()')
                return Promise.reject(new Error('execution reverted'));
            if (signature === 'name()') return Promise.resolve('0xNAME');
            return Promise.resolve('');
        });
        mockDecodeNumberHex.mockReturnValue(18);
        mockDecodeNameHex.mockReturnValue('Token Name');

        // Should complete without throwing
        await queryMetadata('0x1234567890123456789012345678901234567890');
    });

    test('should handle missing name() gracefully', async () => {
        mockGetContractCode.mockReturnValue(
            Promise.resolve(
                '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe',
            ),
        );
        mockCallContract.mockImplementation((_contract, signature) => {
            if (signature === 'decimals()') return Promise.resolve('0x12');
            if (signature === 'symbol()') return Promise.resolve('0xSYM');
            if (signature === 'name()')
                return Promise.reject(new Error('execution reverted'));
            return Promise.resolve('');
        });
        mockDecodeNumberHex.mockReturnValue(18);
        mockDecodeSymbolHex.mockReturnValue('TKN');

        // Should complete without throwing
        await queryMetadata('0x1234567890123456789012345678901234567890');
    });

    test('should handle RPC errors gracefully', async () => {
        mockGetContractCode.mockImplementation(() => {
            throw new Error('RPC connection failed');
        });

        // Should not throw, just log the error
        await queryMetadata('0x1234567890123456789012345678901234567890');
    });

    test('should handle contract with decimals but no symbol or name', async () => {
        mockGetContractCode.mockReturnValue(
            Promise.resolve(
                '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe',
            ),
        );
        mockCallContract.mockImplementation((_contract, signature) => {
            if (signature === 'decimals()') return Promise.resolve('0x12');
            if (signature === 'symbol()') return Promise.resolve('');
            if (signature === 'name()') return Promise.resolve('');
            return Promise.resolve('');
        });
        mockDecodeNumberHex.mockReturnValue(18);
        mockDecodeSymbolHex.mockReturnValue('');
        mockDecodeNameHex.mockReturnValue('');

        // Should complete without throwing
        await queryMetadata('0x1234567890123456789012345678901234567890');
    });
});

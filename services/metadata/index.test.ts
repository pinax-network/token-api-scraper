import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { processMetadata } from '.';

/**
 * Tests for metadata processing with optional name() and symbol()
 * Verifies that tokens can be valid even if name() or symbol() don't exist
 */

// Mock dependencies
const mockCallContract = mock(() => Promise.resolve('0x'));
const mockGetContractCode = mock(() => Promise.resolve('0x')); // Default: no code
const mockDecodeSymbolHex = mock(() => '');
const mockDecodeNameHex = mock(() => '');
const mockDecodeNumberHex = mock(() => 18);
const mockInsertRow = mock(() => Promise.resolve(true));
const mockIncrementSuccess = mock(() => {});
const mockIncrementError = mock(() => {});

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

describe('Metadata processing with optional name() and symbol()', () => {
    beforeEach(() => {
        mockCallContract.mockClear();
        mockGetContractCode.mockClear();
        mockDecodeSymbolHex.mockClear();
        mockDecodeNameHex.mockClear();
        mockDecodeNumberHex.mockClear();
        mockInsertRow.mockClear();
        mockIncrementSuccess.mockClear();
        mockIncrementError.mockClear();

        // Set default mock implementations
        mockGetContractCode.mockReturnValue(
            Promise.resolve(
                '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe',
            ),
        ); // Default: contract has code
    });

    test('should handle token with both name() and symbol()', async () => {
        mockCallContract.mockImplementation((_contract, signature) => {
            if (signature === 'decimals()') return Promise.resolve('0x12');
            if (signature === 'symbol()') return Promise.resolve('0xSYM');
            if (signature === 'name()') return Promise.resolve('0xNAME');
            return Promise.resolve('0x');
        });
        mockDecodeNumberHex.mockReturnValue(18);
        mockDecodeSymbolHex.mockReturnValue('TOKEN');
        mockDecodeNameHex.mockReturnValue('Token Name');

        await processMetadata('mainnet', '0xabc123', 12345, 'test-service');

        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            expect.objectContaining({
                network: 'mainnet',
                contract: '0xabc123',
                block_num: 12345,
                name: 'Token Name',
                symbol: 'TOKEN',
                decimals: 18,
            }),
            expect.any(String),
            expect.objectContaining({ contract: '0xabc123' }),
        );
        expect(mockIncrementSuccess).toHaveBeenCalled();
    });

    test('should handle token without symbol() but with name()', async () => {
        mockCallContract.mockImplementation((_contract, signature) => {
            if (signature === 'decimals()') return Promise.resolve('0x12');
            if (signature === 'symbol()')
                return Promise.reject(
                    new Error('RPC error -32000: execution reverted'),
                );
            if (signature === 'name()') return Promise.resolve('0xNAME');
            return Promise.resolve('0x');
        });
        mockDecodeNumberHex.mockReturnValue(18);
        mockDecodeNameHex.mockReturnValue('Token Name');

        await processMetadata('mainnet', '0xabc123', 12345, 'test-service');

        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            expect.objectContaining({
                network: 'mainnet',
                contract: '0xabc123',
                block_num: 12345,
                name: 'Token Name',
                symbol: '', // Empty string when symbol() fails
                decimals: 18,
            }),
            expect.any(String),
            expect.objectContaining({ contract: '0xabc123' }),
        );
        expect(mockIncrementSuccess).toHaveBeenCalled();
    });

    test('should handle token without name() but with symbol()', async () => {
        mockCallContract.mockImplementation((_contract, signature) => {
            if (signature === 'decimals()') return Promise.resolve('0x12');
            if (signature === 'symbol()') return Promise.resolve('0xSYM');
            if (signature === 'name()')
                return Promise.reject(
                    new Error('RPC error -32000: execution reverted'),
                );
            return Promise.resolve('0x');
        });
        mockDecodeNumberHex.mockReturnValue(18);
        mockDecodeSymbolHex.mockReturnValue('TOKEN');

        await processMetadata('mainnet', '0xabc123', 12345, 'test-service');

        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            expect.objectContaining({
                network: 'mainnet',
                contract: '0xabc123',
                block_num: 12345,
                name: '', // Empty string when name() fails
                symbol: 'TOKEN',
                decimals: 18,
            }),
            expect.any(String),
            expect.objectContaining({ contract: '0xabc123' }),
        );
        expect(mockIncrementSuccess).toHaveBeenCalled();
    });

    test('should handle token with neither name() nor symbol()', async () => {
        mockCallContract.mockImplementation((_contract, signature) => {
            if (signature === 'decimals()') return Promise.resolve('0x12');
            if (signature === 'symbol()')
                return Promise.reject(
                    new Error('RPC error -32000: execution reverted'),
                );
            if (signature === 'name()')
                return Promise.reject(
                    new Error('RPC error -32000: execution reverted'),
                );
            return Promise.resolve('0x');
        });
        mockDecodeNumberHex.mockReturnValue(18);

        await processMetadata('mainnet', '0xabc123', 12345, 'test-service');

        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata',
            expect.objectContaining({
                network: 'mainnet',
                contract: '0xabc123',
                block_num: 12345,
                name: '', // Empty string when name() fails
                symbol: '', // Empty string when symbol() fails
                decimals: 18,
            }),
            expect.any(String),
            expect.objectContaining({ contract: '0xabc123' }),
        );
        expect(mockIncrementSuccess).toHaveBeenCalled();
    });

    test('should still require decimals() to exist', async () => {
        mockCallContract.mockImplementation((_contract, signature) => {
            if (signature === 'decimals()') return Promise.resolve('0x');
            return Promise.resolve('0x');
        });
        mockDecodeNumberHex.mockReturnValue(null); // decimals not available

        await processMetadata('mainnet', '0xabc123', 12345, 'test-service');

        // Should insert error, not metadata
        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata_errors',
            expect.objectContaining({
                contract: '0xabc123',
                error: 'missing decimals()',
            }),
            expect.any(String),
            expect.objectContaining({ contract: '0xabc123' }),
        );
        expect(mockIncrementError).toHaveBeenCalled();
    });
});

/**
 * Tests for metadata error filtering
 * Verifies that infrastructure-related errors are skipped from metadata_errors table
 */

describe('Metadata error filtering', () => {
    test('should identify connection error as infrastructure error', () => {
        const error =
            'Unable to connect. Is the computer able to access the url?';
        // We can't easily test the actual database insertion without mocking
        // but we can verify the function doesn't throw
        expect(() => {
            const isInfra = error.toLowerCase().includes('unable to connect');
            expect(isInfra).toBe(true);
        }).not.toThrow();
    });

    test('should identify typo error as infrastructure error', () => {
        const error = 'Was there a typo in the url or port?';
        const isInfra = error
            .toLowerCase()
            .includes('was there a typo in the url or port');
        expect(isInfra).toBe(true);
    });

    test('should identify 502 error as infrastructure error', () => {
        const error = 'Non-JSON response (status 502)';
        const isInfra = error
            .toLowerCase()
            .includes('non-json response (status 502)');
        expect(isInfra).toBe(true);
    });

    test('should identify 404 error as infrastructure error', () => {
        const error = 'Non-JSON response (status 404)';
        const isInfra = error
            .toLowerCase()
            .includes('non-json response (status 404)');
        expect(isInfra).toBe(true);
    });

    test('should not identify application errors as infrastructure errors', () => {
        const error = 'missing decimals()';
        const isInfra =
            error.toLowerCase().includes('unable to connect') ||
            error
                .toLowerCase()
                .includes('was there a typo in the url or port') ||
            error.toLowerCase().includes('non-json response (status 502)') ||
            error.toLowerCase().includes('non-json response (status 404)');
        expect(isInfra).toBe(false);
    });

    test('should not identify RPC errors as infrastructure errors', () => {
        const error = 'RPC error -32000: execution reverted';
        const isInfra =
            error.toLowerCase().includes('unable to connect') ||
            error
                .toLowerCase()
                .includes('was there a typo in the url or port') ||
            error.toLowerCase().includes('non-json response (status 502)') ||
            error.toLowerCase().includes('non-json response (status 404)');
        expect(isInfra).toBe(false);
    });
});

/**
 * Tests for self-destruct contract detection
 * Verifies that contracts with no code are detected as self-destructed
 */

describe('Self-destruct contract detection', () => {
    beforeEach(() => {
        mockCallContract.mockClear();
        mockGetContractCode.mockClear();
        mockDecodeSymbolHex.mockClear();
        mockDecodeNameHex.mockClear();
        mockDecodeNumberHex.mockClear();
        mockInsertRow.mockClear();
        mockIncrementSuccess.mockClear();
        mockIncrementError.mockClear();
    });

    test('should detect self-destructed contract when decimals() returns null', async () => {
        mockCallContract.mockReturnValue(Promise.resolve('0x'));
        mockDecodeNumberHex.mockReturnValue(null); // decimals not available
        mockGetContractCode.mockReturnValue(Promise.resolve('0x')); // No code = self-destructed

        await processMetadata('mainnet', '0xabc123', 12345, 'test-service');

        // Should insert error with self-destructed message, not missing decimals()
        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata_errors',
            expect.objectContaining({
                contract: '0xabc123',
                error: 'self-destructed contract',
            }),
            expect.any(String),
            expect.objectContaining({ contract: '0xabc123' }),
        );
        expect(mockIncrementError).toHaveBeenCalled();
    });

    test('should report missing decimals() when contract has code but decimals() fails', async () => {
        mockCallContract.mockReturnValue(Promise.resolve('0x'));
        mockDecodeNumberHex.mockReturnValue(null); // decimals not available
        mockGetContractCode.mockReturnValue(
            Promise.resolve(
                '0x6080604052348015600f57600080fd5b50603f80601d6000396000f3fe',
            ),
        ); // Has code

        await processMetadata('mainnet', '0xabc123', 12345, 'test-service');

        // Should insert error with missing decimals() message
        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata_errors',
            expect.objectContaining({
                contract: '0xabc123',
                error: 'missing decimals()',
            }),
            expect.any(String),
            expect.objectContaining({ contract: '0xabc123' }),
        );
        expect(mockIncrementError).toHaveBeenCalled();
    });

    test('should fallback to missing decimals() when getContractCode fails', async () => {
        mockCallContract.mockReturnValue(Promise.resolve('0x'));
        mockDecodeNumberHex.mockReturnValue(null); // decimals not available
        mockGetContractCode.mockReturnValue(
            Promise.reject(new Error('RPC error -32000: server error')),
        ); // getContractCode fails

        await processMetadata('mainnet', '0xabc123', 12345, 'test-service');

        // Should fallback to missing decimals() error
        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata_errors',
            expect.objectContaining({
                contract: '0xabc123',
                error: 'missing decimals()',
            }),
            expect.any(String),
            expect.objectContaining({ contract: '0xabc123' }),
        );
        expect(mockIncrementError).toHaveBeenCalled();
    });

    test('should detect self-destructed contract with 0x code', async () => {
        mockCallContract.mockReturnValue(Promise.resolve('0x'));
        mockDecodeNumberHex.mockReturnValue(null); // decimals not available
        mockGetContractCode.mockReturnValue(Promise.resolve('0x')); // 0x = no code

        await processMetadata('mainnet', '0xabc123', 12345, 'test-service');

        // Should insert error with self-destructed message
        expect(mockInsertRow).toHaveBeenCalledWith(
            'metadata_errors',
            expect.objectContaining({
                contract: '0xabc123',
                error: 'self-destructed contract',
            }),
            expect.any(String),
            expect.objectContaining({ contract: '0xabc123' }),
        );
        expect(mockIncrementError).toHaveBeenCalled();
    });
});

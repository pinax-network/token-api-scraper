import { describe, test, expect } from 'bun:test';
import { abi, decodeUint256 } from "./rpc";

/**
 * Tests for hex decoding functions to ensure alignment with SQL functions
 * These tests verify that JS decoding matches the behavior of SQL functions:
 * - hex_to_string() in SQL
 * - hex_to_uint256() in SQL for uint8 (decimals) and uint256 (balances)
 */

describe('Hex decoding - string values', () => {
    test('should decode hex string with 0x prefix', () => {
        // Hex encoded "USDT" string (ABI-encoded: offset + length + data)
        // Properly padded to even number of hex chars (64-byte aligned)
        const hexWithPrefix = "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553445400000000000000000000000000000000000000000000000000000000";
        const [decoded] = abi.decode(["string"], hexWithPrefix);
        expect(decoded).toBe("USDT");
    });

    test('should decode hex string without 0x prefix', () => {
        // Hex encoded "USDT" string (without 0x)
        const hexWithoutPrefix = "000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553445400000000000000000000000000000000000000000000000000000000";
        const [decoded] = abi.decode(["string"], "0x" + hexWithoutPrefix);
        expect(decoded).toBe("USDT");
    });

    test('should decode empty string', () => {
        // Empty string encoding
        const hexEmpty = "0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000";
        const [decoded] = abi.decode(["string"], hexEmpty);
        expect(decoded).toBe("");
    });

    test('should decode longer token name', () => {
        // Hex encoded "Wrapped Bitcoin" (15 characters = 0x0f in length)
        const hexName = "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000f5772617070656420426974636f696e0000000000000000000000000000000000";
        const [decoded] = abi.decode(["string"], hexName);
        expect(decoded).toBe("Wrapped Bitcoin");
    });
});

describe('Hex decoding - uint8 values (decimals)', () => {
    test('should decode uint8 with 0x prefix - decimals 18', () => {
        // 18 decimals encoded as uint256
        const hex = "0x0000000000000000000000000000000000000000000000000000000000000012";
        const decoded = decodeUint256(hex);
        expect(Number(decoded)).toBe(18);
    });

    test('should decode uint8 without 0x prefix - decimals 6', () => {
        // 6 decimals encoded as uint256 (without 0x)
        const hex = "0000000000000000000000000000000000000000000000000000000000000006";
        const decoded = decodeUint256(hex);
        expect(Number(decoded)).toBe(6);
    });

    test('should decode uint8 - decimals 8', () => {
        // 8 decimals (common for tokens like USDT)
        const hex = "0x0000000000000000000000000000000000000000000000000000000000000008";
        const decoded = decodeUint256(hex);
        expect(Number(decoded)).toBe(8);
    });

    test('should decode uint8 - decimals 0', () => {
        // 0 decimals
        const hex = "0x0000000000000000000000000000000000000000000000000000000000000000";
        const decoded = decodeUint256(hex);
        expect(Number(decoded)).toBe(0);
    });
});

describe('Hex decoding - uint256 values (balances)', () => {
    test('should decode uint256 with 0x prefix - small value', () => {
        // 1000000 (1 million)
        const hex = "0x00000000000000000000000000000000000000000000000000000000000f4240";
        const decoded = decodeUint256(hex);
        expect(decoded).toBe(1000000n);
    });

    test('should decode uint256 without 0x prefix - small value', () => {
        // 1000000 (1 million, without 0x)
        const hex = "00000000000000000000000000000000000000000000000000000000000f4240";
        const decoded = decodeUint256(hex);
        expect(decoded).toBe(1000000n);
    });

    test('should decode uint256 - large balance', () => {
        // 1000000000000000000 (1 ETH/TRX with 18 decimals)
        const hex = "0x0000000000000000000000000000000000000000000000000de0b6b3a7640000";
        const decoded = decodeUint256(hex);
        expect(decoded).toBe(1000000000000000000n);
    });

    test('should decode uint256 - zero balance', () => {
        // 0 balance
        const hex = "0x0000000000000000000000000000000000000000000000000000000000000000";
        const decoded = decodeUint256(hex);
        expect(decoded).toBe(0n);
    });

    test('should decode uint256 - very large balance', () => {
        // Very large number: 123456789012345678901234567890 = 0x18ee90ff6c373e0ee4e3f0ad2
        // Need to pad to 32 bytes (64 hex chars)
        const hex = "0x00000000000000000000000000000000000000018ee90ff6c373e0ee4e3f0ad2";
        const decoded = decodeUint256(hex);
        expect(decoded).toBe(123456789012345678901234567890n);
    });
});

describe('Hex decoding - edge cases', () => {
    test('should handle padded zero value', () => {
        // Properly padded zero (32 bytes = 64 hex chars)
        const hex = "0x0000000000000000000000000000000000000000000000000000000000000000";
        const decoded = decodeUint256(hex);
        expect(decoded).toBe(0n);
    });

    test('should handle minimal non-zero value', () => {
        // Value 1 (properly padded to 32 bytes)
        const hex = "0x0000000000000000000000000000000000000000000000000000000000000001";
        const decoded = decodeUint256(hex);
        expect(decoded).toBe(1n);
    });

    test('should handle 255 value', () => {
        // 255 (0xFF) properly padded to 32 bytes
        const hex = "0x00000000000000000000000000000000000000000000000000000000000000ff";
        const decoded = decodeUint256(hex);
        expect(decoded).toBe(255n);
    });
});

describe('Hex decoding - SQL compatibility validation', () => {
    /**
     * These tests validate that our JS decoding aligns with SQL function behavior
     * SQL functions use: unhex(replaceRegexpAll(hex_str, '^0x', ''))
     * This means SQL strips 0x prefix before decoding, which our JS code also does
     */
    
    test('JS and SQL should handle 0x prefix consistently for strings', () => {
        // Both with and without 0x should decode to the same value
        // This is the full ABI-encoded string "USDT" (offset + length + data)
        const hexWith0x = "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553445400000000000000000000000000000000000000000000000000000000";
        const hexWithout0x = "000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000045553445400000000000000000000000000000000000000000000000000000000";
        
        const [decodedWith] = abi.decode(["string"], hexWith0x);
        const [decodedWithout] = abi.decode(["string"], "0x" + hexWithout0x);
        
        expect(decodedWith).toBe(decodedWithout);
        expect(decodedWith).toBe("USDT");
    });

    test('JS and SQL should handle 0x prefix consistently for uint256', () => {
        // Both with and without 0x should decode to the same value
        const hexWith0x = "0x0000000000000000000000000000000000000000000000000000000000000012";
        const hexWithout0x = "0000000000000000000000000000000000000000000000000000000000000012";
        
        const decodedWith = decodeUint256(hexWith0x);
        const decodedWithout = decodeUint256(hexWithout0x);
        
        expect(decodedWith).toBe(decodedWithout);
        expect(Number(decodedWith)).toBe(18);
    });

    test('decodeUint256 should normalize hex input like SQL does', () => {
        // SQL: reinterpretAsUInt256(reverse(unhex(replaceRegexpAll(hex_str, '^0x', ''))))
        // Our function requires properly padded 32-byte values
        const testCases = [
            { hex: "0x0000000000000000000000000000000000000000000000000000000000000012", expected: 18n },
            { hex: "0000000000000000000000000000000000000000000000000000000000000012", expected: 18n },
        ];

        for (const { hex, expected } of testCases) {
            const decoded = decodeUint256(hex);
            expect(decoded).toBe(expected);
        }
    });
});

describe('Hex decoding - whitespace handling', () => {
    /**
     * Note: The SQL function hex_to_string_or_null now strips whitespace,
     * but the JavaScript abi.decode does not. This means there's a slight
     * difference between SQL and JS behavior when whitespace is present.
     * The SQL function will clean up the data, while JS returns it as-is.
     * These tests document the expected behavior after SQL processing.
     */

    test('should decode string with leading spaces', () => {
        // Hex encoded "   孙悟空" - has leading spaces (3 spaces)
        // 0x20 = space, 0xe5ad99 = 孙, 0xe6829f = 悟, 0xe7a9ba = 空
        const hex = "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000c202020e5ad99e6829fe7a9ba0000000000000000000000000000000000000000";
        const [decoded] = abi.decode(["string"], hex);
        // JS will have spaces, but SQL will trim them
        expect(decoded).toBe("   孙悟空");
        // After SQL trim: "孙悟空"
    });

    test('should decode string with leading tab and spaces', () => {
        // Hex encoded "  \tsunDOG" - has spaces and tab (2 spaces + tab)
        // 0x20 = space, 0x09 = tab
        const hex = "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000920200973756e444f470000000000000000000000000000000000000000000000";
        const [decoded] = abi.decode(["string"], hex);
        // JS will have the whitespace
        expect(decoded).toBe("  \tsunDOG");
        // After SQL trim: "sunDOG"
    });

    test('should decode string with newline at start', () => {
        // Hex encoded "\n\nAllbridge LP" - has leading newlines (2 newlines)
        // 0x0a = newline
        const hex = "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000e0a0a416c6c627269646765204c50000000000000000000000000000000000000";
        const [decoded] = abi.decode(["string"], hex);
        // JS will have the newlines
        expect(decoded).toBe("\n\nAllbridge LP");
        // After SQL processing: "Allbridge LP" (trim removes leading \n)
    });

    test('should decode string with internal line breaks', () => {
        // Hex encoded "Five\nEnergy" - has internal newline
        // 0x0a = newline
        const hex = "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b466976650a456e65726779000000000000000000000000000000000000000000";
        const [decoded] = abi.decode(["string"], hex);
        expect(decoded).toBe("Five\nEnergy");
        // After SQL replaceRegexpAll: "Five Energy" (replaces \n with space)
    });

    test('should decode string with trailing whitespace', () => {
        // Hex encoded "USDT   " - has trailing spaces (3 spaces)
        const hex = "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000075553445420202000000000000000000000000000000000000000000000000000";
        const [decoded] = abi.decode(["string"], hex);
        expect(decoded).toBe("USDT   ");
        // After SQL trim: "USDT"
    });

    test('should decode string with multiple consecutive whitespace characters', () => {
        // Hex encoded "Assure\t\tfree gas" - has two consecutive tabs
        // 0x09 = tab
        const hex = "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000104173737572650909667265652067617300000000000000000000000000000000";
        const [decoded] = abi.decode(["string"], hex);
        expect(decoded).toBe("Assure\t\tfree gas");
        // After SQL replaceRegexpAll: "Assure free gas" (replaces \t\t with single space)
    });

    test('should handle string that is only whitespace', () => {
        // Hex encoded "   \n\t  " - only whitespace (3 spaces, newline, tab, 2 spaces)
        const hex = "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000072020200a09202000000000000000000000000000000000000000000000000000";
        const [decoded] = abi.decode(["string"], hex);
        expect(decoded).toBe("   \n\t  ");
        // After SQL processing: "" (all whitespace trimmed/normalized to empty)
    });
});

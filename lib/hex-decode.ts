import { abi, decodeUint256 } from './rpc';

/**
 * Sanitize a string by removing NULL bytes and trimming whitespace
 * @param str - The string to sanitize
 * @returns The sanitized string
 */
export function sanitizeString(str: string): string {
    return str.replace(/\0/g, '').trim();
}

/**
 * Decode an ABI-encoded hex string to a string value
 * Used for decoding token name and symbol from RPC calls
 *
 * @param hexValue - The hex-encoded string (with or without 0x prefix)
 * @returns The decoded string, sanitized (NULL bytes removed, trimmed), or empty string if decoding fails
 */
export function decodeHexString(hexValue: string | null | undefined): string {
    if (!hexValue) return '';

    try {
        // Ensure 0x prefix
        const normalized = hexValue.startsWith('0x')
            ? hexValue
            : `0x${hexValue}`;

        // Decode using ethers ABI decoder
        const [decoded] = abi.decode(['string'], normalized);

        // Sanitize: remove NULL bytes and trim whitespace
        return decoded ? sanitizeString(decoded) : '';
    } catch (_error) {
        // If decoding fails, return empty string
        return '';
    }
}

/**
 * Decode token symbol from hex-encoded RPC response
 * This is an alias for decodeHexString for clarity when used with symbol data
 *
 * @param symbolHex - The hex-encoded symbol string
 * @returns The decoded symbol string
 */
export function decodeSymbolHex(symbolHex: string | null | undefined): string {
    return decodeHexString(symbolHex);
}

/**
 * Decode token name from hex-encoded RPC response
 * This is an alias for decodeHexString for clarity when used with name data
 *
 * @param nameHex - The hex-encoded name string
 * @returns The decoded name string
 */
export function decodeNameHex(nameHex: string | null | undefined): string {
    return decodeHexString(nameHex);
}

/**
 * Decode token decimals from hex-encoded RPC response
 * @param numberHex - The hex-encoded decimals value
 * @returns The decoded decimals as a number, or null if decoding fails
 */
export function decodeNumberHex(
    numberHex: string | null | undefined,
): number | null {
    if (!numberHex) return null;

    try {
        // Ensure 0x prefix
        const normalized = numberHex.startsWith('0x')
            ? numberHex
            : `0x${numberHex}`;

        // Decode using ethers ABI decoder
        const uint256 = decodeUint256(normalized);
        // must be UInt8 range
        if (uint256 < 0 || uint256 > 255) return null;
        return Number(uint256);
    } catch (_error) {
        // If decoding fails, return null
        return null;
    }
}

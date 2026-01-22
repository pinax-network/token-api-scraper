import { describe, expect, test } from 'bun:test';
import {
    base58Decode,
    base58Encode,
    decodeMetaplexMetadata,
    findMetadataPda,
    METAPLEX_PROGRAM_ID,
    parseToken2022Extensions,
    TOKEN_2022_PROGRAM_ID,
} from './solana-rpc';

describe('base58 encoding/decoding', () => {
    test('should encode and decode correctly', () => {
        const testCases = [
            // Empty
            { bytes: new Uint8Array([]), base58: '' },
            // Single byte
            { bytes: new Uint8Array([0]), base58: '1' },
            { bytes: new Uint8Array([1]), base58: '2' },
            { bytes: new Uint8Array([58]), base58: '21' },
            // Leading zeros
            { bytes: new Uint8Array([0, 0, 1]), base58: '112' },
        ];

        for (const { bytes, base58 } of testCases) {
            expect(base58Encode(bytes)).toBe(base58);
            expect(base58Decode(base58)).toEqual(bytes);
        }
    });

    test('should decode known Solana addresses', () => {
        // Metaplex program ID
        const metaplexBytes = base58Decode(METAPLEX_PROGRAM_ID);
        expect(metaplexBytes.length).toBe(32);

        // Re-encode and verify
        expect(base58Encode(metaplexBytes)).toBe(METAPLEX_PROGRAM_ID);
    });

    test('should throw on invalid base58 characters', () => {
        expect(() => base58Decode('0OIl')).toThrow('Invalid base58 character');
    });
});

describe('Metaplex PDA derivation', () => {
    test('should derive a valid PDA for a known mint', () => {
        // This is a simple test to verify the function runs without error
        // The actual PDA can be verified against on-chain data
        const mint = 'So11111111111111111111111111111111111111112'; // Wrapped SOL
        const pda = findMetadataPda(mint);

        // PDA should be a valid base58 string
        expect(pda).toBeTruthy();
        expect(typeof pda).toBe('string');
        expect(pda.length).toBeGreaterThan(0);

        // Should decode to 32 bytes
        const pdaBytes = base58Decode(pda);
        expect(pdaBytes.length).toBe(32);
    });

    test('should produce consistent PDAs for the same mint', () => {
        const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC
        const pda1 = findMetadataPda(mint);
        const pda2 = findMetadataPda(mint);
        expect(pda1).toBe(pda2);
    });
});

describe('Metaplex metadata decoding', () => {
    test('should return null for empty data', () => {
        expect(decodeMetaplexMetadata('')).toBeNull();
    });

    test('should return null for data too short', () => {
        // Less than minimum (1 + 32 + 32 + 4 = 69 bytes)
        const shortData = btoa(
            String.fromCharCode(...new Uint8Array(50).fill(0)),
        );
        expect(decodeMetaplexMetadata(shortData)).toBeNull();
    });

    test('should return null for invalid key', () => {
        // Create data with wrong key (not 4)
        const data = new Uint8Array(100);
        data[0] = 1; // Wrong key
        const base64 = btoa(String.fromCharCode(...data));
        expect(decodeMetaplexMetadata(base64)).toBeNull();
    });

    test('should decode valid Metaplex metadata structure', () => {
        // Create a mock Metaplex metadata structure
        const data = new Uint8Array(200);
        let offset = 0;

        // Key = 4 (Metadata)
        data[offset++] = 4;

        // Update authority (32 bytes)
        offset += 32;

        // Mint (32 bytes)
        offset += 32;

        // Name: "Test Token" (Borsh string: u32 length + bytes)
        const name = 'Test Token';
        const nameBytes = new TextEncoder().encode(name);
        data[offset++] = nameBytes.length;
        data[offset++] = 0;
        data[offset++] = 0;
        data[offset++] = 0;
        data.set(nameBytes, offset);
        offset += nameBytes.length;

        // Symbol: "TEST" (Borsh string)
        const symbol = 'TEST';
        const symbolBytes = new TextEncoder().encode(symbol);
        data[offset++] = symbolBytes.length;
        data[offset++] = 0;
        data[offset++] = 0;
        data[offset++] = 0;
        data.set(symbolBytes, offset);
        offset += symbolBytes.length;

        // URI: "https://example.com/metadata.json" (Borsh string)
        const uri = 'https://example.com/metadata.json';
        const uriBytes = new TextEncoder().encode(uri);
        data[offset++] = uriBytes.length;
        data[offset++] = 0;
        data[offset++] = 0;
        data[offset++] = 0;
        data.set(uriBytes, offset);
        offset += uriBytes.length;

        // Seller fee basis points (u16 LE)
        data[offset++] = 0xe8; // 1000 = 0x03E8
        data[offset++] = 0x03;

        const base64 = btoa(String.fromCharCode(...data));
        const result = decodeMetaplexMetadata(base64);

        expect(result).not.toBeNull();
        expect(result?.name).toBe('Test Token');
        expect(result?.symbol).toBe('TEST');
        expect(result?.uri).toBe('https://example.com/metadata.json');
        expect(result?.sellerFeeBasisPoints).toBe(1000);
    });

    test('should handle strings with null bytes', () => {
        // Create metadata with null-padded strings (common in on-chain data)
        const data = new Uint8Array(200);
        let offset = 0;

        data[offset++] = 4; // Key
        offset += 32; // Update authority
        offset += 32; // Mint

        // Name with null padding: "TOKEN\0\0\0" (length includes nulls)
        const nameWithNulls = 'TOKEN\0\0\0';
        const nameBytes = new TextEncoder().encode(nameWithNulls);
        data[offset++] = nameBytes.length;
        data[offset++] = 0;
        data[offset++] = 0;
        data[offset++] = 0;
        data.set(nameBytes, offset);
        offset += nameBytes.length;

        // Symbol
        const symbol = 'TKN';
        const symbolBytes = new TextEncoder().encode(symbol);
        data[offset++] = symbolBytes.length;
        data[offset++] = 0;
        data[offset++] = 0;
        data[offset++] = 0;
        data.set(symbolBytes, offset);
        offset += symbolBytes.length;

        // URI
        const _uri = '';
        data[offset++] = 0;
        data[offset++] = 0;
        data[offset++] = 0;
        data[offset++] = 0;

        const base64 = btoa(String.fromCharCode(...data));
        const result = decodeMetaplexMetadata(base64);

        expect(result).not.toBeNull();
        expect(result?.name).toBe('TOKEN'); // Null bytes removed
        expect(result?.symbol).toBe('TKN');
        expect(result?.uri).toBe('');
    });
});

describe('Token-2022 extension parsing', () => {
    test('should return null for non-Token-2022 accounts', () => {
        const data = btoa(String.fromCharCode(...new Uint8Array(100)));
        // Wrong owner
        expect(parseToken2022Extensions(data, 'SomeOtherProgram')).toBeNull();
    });

    test('should return null for data too short', () => {
        const data = btoa(String.fromCharCode(...new Uint8Array(50)));
        expect(
            parseToken2022Extensions(data, TOKEN_2022_PROGRAM_ID),
        ).toBeNull();
    });

    test('should return null for standard mint without extensions', () => {
        // Standard mint data (82 bytes) without extensions
        const data = btoa(String.fromCharCode(...new Uint8Array(82)));
        expect(
            parseToken2022Extensions(data, TOKEN_2022_PROGRAM_ID),
        ).toBeNull();
    });

    test('should return null for account with wrong account type', () => {
        // Create mint data with account type != 1
        const data = new Uint8Array(100);
        data[82] = 2; // Account type = 2 (not a mint)
        const base64 = btoa(String.fromCharCode(...data));
        expect(
            parseToken2022Extensions(base64, TOKEN_2022_PROGRAM_ID),
        ).toBeNull();
    });
});

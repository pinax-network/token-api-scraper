/**
 * Tests for Solana metadata decoding functions using real on-chain data.
 *
 * This file contains tests for `decodeMetaplexMetadata` and `parseToken2022Extensions`
 * using actual responses from Solana's `getAccountInfo` RPC method.
 *
 * Add new test contracts here as they are discovered.
 */

import { describe, expect, test } from 'bun:test';
import {
    decodeMetaplexMetadata,
    METAPLEX_PROGRAM_ID,
    parseToken2022Extensions,
    TOKEN_2022_PROGRAM_ID,
} from './solana-rpc';

/**
 * Test data from actual Solana `getAccountInfo` responses.
 * These values are copied directly from RPC responses and should not be modified.
 */

/**
 * Metaplex PDA account data for "The 75" token
 * - This is a Metaplex metadata PDA account
 * - Owner: metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s
 */
const METAPLEX_PDA_DATA = {
    data: 'BFd0NJ3Kw/KxKFLN8K5flEY8954PwSvUPDi8xTLzeZoJSPyZUG01ZMfQQLaBzVogxjhd9TmE1gSH0kxnnKi7TjcgAAAAVGhlIDc1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKAAAAAAAAAAAAAAAAAMgAAABodHRwczovL2Fyd2VhdmUubmV0L2lrYmlCMV9BSDZWd3FLcHZoRkd2bEV5TWdheVMzbWJxblROUTNnNC1aM2sAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMgAAQIAAABE3FEbJ5WPkotF0hwkVo49URY76KUxeWlnqLWCeLjzTQBkV3Q0ncrD8rEoUs3wrl+URjz3ng/BK9Q8OLzFMvN5mgkBAAEAAf8BAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    executable: false,
    lamports: 5115600,
    owner: 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
    rentEpoch: 18446744073709552000,
};

/**
 * Token-2022 mint account data with metadata extension
 * - This is a Token-2022 mint account
 * - Owner: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb
 */
const TOKEN_2022_MINT_DATA = {
    data: 'AQAAACNuANhbbkPSzIu2mMpZcIBxMHpQIGX7KOuyqdxD6dX9dZjoOwAAAAACAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    executable: false,
    lamports: 1461600,
    owner: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    rentEpoch: 18446744073709552000,
};

describe('Solana metadata decoding with real contract data', () => {
    describe('decodeMetaplexMetadata', () => {
        test('should decode Metaplex PDA data for "The 75" token', () => {
            // Verify the owner is the Metaplex program
            expect(METAPLEX_PDA_DATA.owner).toBe(METAPLEX_PROGRAM_ID);

            const result = decodeMetaplexMetadata(METAPLEX_PDA_DATA.data);

            expect(result).not.toBeNull();
            expect(result?.name).toBe('The 75');
            expect(result?.symbol).toBe(''); // No symbol in the data
            expect(result?.uri).toBe(
                'https://arweave.net/ikbiB1_AH6VwqKpvhFGvlEyMgayS3mbqnTNQ3g4-Z3k',
            );
            expect(result?.sellerFeeBasisPoints).toBe(200); // 2%
        });

        test('should extract correct metadata fields from Metaplex PDA', () => {
            const result = decodeMetaplexMetadata(METAPLEX_PDA_DATA.data);

            expect(result).not.toBeNull();
            // The name should be trimmed of null padding
            expect(result?.name).not.toContain('\0');
            // The URI should be valid and accessible
            expect(result?.uri).toMatch(/^https:\/\//);
        });
    });

    describe('parseToken2022Extensions', () => {
        test('should return null for Token-2022 mint without metadata extension', () => {
            // This mint doesn't have a TOKEN_METADATA extension
            const result = parseToken2022Extensions(
                TOKEN_2022_MINT_DATA.data,
                TOKEN_2022_MINT_DATA.owner,
            );

            // The provided data is a basic Token-2022 mint without metadata extension
            // It should return null
            expect(result).toBeNull();
        });

        test('should correctly identify Token-2022 owner', () => {
            // Verify the owner matches Token-2022 program ID
            expect(TOKEN_2022_MINT_DATA.owner).toBe(TOKEN_2022_PROGRAM_ID);
        });

        test('should return null for non-Token-2022 accounts', () => {
            // Try parsing Metaplex data with Token-2022 parser
            const result = parseToken2022Extensions(
                METAPLEX_PDA_DATA.data,
                METAPLEX_PDA_DATA.owner,
            );

            // Should return null because owner is not Token-2022
            expect(result).toBeNull();
        });
    });
});

/**
 * Additional test contracts can be added below.
 *
 * Example format:
 *
 * const MY_TOKEN_DATA = {
 *     data: '... base64 encoded data from getAccountInfo ...',
 *     executable: false,
 *     lamports: 1234567,
 *     owner: 'program_id_here',
 *     rentEpoch: 18446744073709552000,
 * };
 *
 * Then add tests:
 *
 * test('should decode MY_TOKEN metadata', () => {
 *     const result = decodeMetaplexMetadata(MY_TOKEN_DATA.data);
 *     expect(result?.name).toBe('Expected Name');
 *     // ... more assertions
 * });
 */

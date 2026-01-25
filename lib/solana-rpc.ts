/**
 * Solana RPC client for fetching token metadata
 * Supports Metaplex Token Metadata and Token-2022 extensions
 */

import { Point } from '@noble/ed25519';
import { sleep } from 'bun';
import PQueue from 'p-queue';
import { DEFAULT_CONFIG } from './config';
import { createLogger } from './logger';

const log = createLogger('solana-rpc');

/** -----------------------------------------------------------------------
 *  Config
 *  ---------------------------------------------------------------------*/
// Read retry config from environment variables
const MAX_RETRIES = parseInt(
    process.env.MAX_RETRIES || String(DEFAULT_CONFIG.MAX_RETRIES),
    10,
);
const BASE_DELAY_MS = parseInt(
    process.env.BASE_DELAY_MS || String(DEFAULT_CONFIG.BASE_DELAY_MS),
    10,
);
const JITTER_MIN = parseFloat(
    process.env.JITTER_MIN || String(DEFAULT_CONFIG.JITTER_MIN),
);
const JITTER_MAX = parseFloat(
    process.env.JITTER_MAX || String(DEFAULT_CONFIG.JITTER_MAX),
);
const MAX_DELAY_MS = parseInt(
    process.env.MAX_DELAY_MS || String(DEFAULT_CONFIG.MAX_DELAY_MS),
    10,
);
const TIMEOUT_MS = parseInt(
    process.env.TIMEOUT_MS || String(DEFAULT_CONFIG.TIMEOUT_MS),
    10,
);

/** Get SOLANA_NODE_URL at runtime to support CLI overrides */
function getSolanaNodeUrl(): string {
    const url = process.env.SOLANA_NODE_URL || process.env.NODE_URL;
    if (!url) {
        throw new Error(
            'SOLANA_NODE_URL or NODE_URL environment variable is not set.',
        );
    }
    return url;
}

/** -----------------------------------------------------------------------
 *  Metaplex Token Metadata Program Constants
 *  ---------------------------------------------------------------------*/
export const METAPLEX_PROGRAM_ID =
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

/**
 * Base58 alphabet used by Solana
 */
const BASE58_ALPHABET =
    '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Decode a base58 string to a Uint8Array
 */
export function base58Decode(str: string): Uint8Array {
    if (str.length === 0) return new Uint8Array(0);

    const bytes = [0];
    for (const char of str) {
        const idx = BASE58_ALPHABET.indexOf(char);
        if (idx === -1) {
            throw new Error(`Invalid base58 character: ${char}`);
        }
        let carry = idx;
        for (let j = 0; j < bytes.length; j++) {
            carry += bytes[j] * 58;
            bytes[j] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }

    // Count leading '1's (zeros in decoded form)
    let leadingZeros = 0;
    for (const char of str) {
        if (char !== '1') break;
        leadingZeros++;
    }

    // Reverse the bytes array
    bytes.reverse();

    // Remove leading zeros from the computed bytes (we'll add explicit ones)
    while (bytes.length > 0 && bytes[0] === 0) {
        bytes.shift();
    }

    // Create result with leading zeros prepended
    const result = new Uint8Array(leadingZeros + bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        result[leadingZeros + i] = bytes[i];
    }

    return result;
}

/**
 * Encode a Uint8Array to a base58 string
 */
export function base58Encode(bytes: Uint8Array): string {
    if (bytes.length === 0) return '';

    // Count leading zeros
    let leadingZeros = 0;
    for (const byte of bytes) {
        if (byte !== 0) break;
        leadingZeros++;
    }

    // Convert bytes to bigint
    let num = 0n;
    for (const byte of bytes) {
        num = num * 256n + BigInt(byte);
    }

    // Convert to base58
    let result = '';
    while (num > 0n) {
        const rem = Number(num % 58n);
        result = BASE58_ALPHABET[rem] + result;
        num = num / 58n;
    }

    // Add leading '1's for leading zeros
    return '1'.repeat(leadingZeros) + result;
}

/**
 * Find the Program Derived Address (PDA) for Metaplex metadata
 * Seeds: ["metadata", METAPLEX_PROGRAM_ID, mint]
 */
export function findMetadataPda(mint: string): string {
    const seeds = [
        new TextEncoder().encode('metadata'),
        base58Decode(METAPLEX_PROGRAM_ID),
        base58Decode(mint),
    ];

    const programId = base58Decode(METAPLEX_PROGRAM_ID);
    const [pda] = findProgramAddressSync(seeds, programId);
    return base58Encode(pda);
}

/**
 * Find a program-derived address synchronously
 * This is a simplified implementation of Solana's PDA derivation
 */
function findProgramAddressSync(
    seeds: Uint8Array[],
    programId: Uint8Array,
): [Uint8Array, number] {
    let bump = 255;
    while (bump > 0) {
        try {
            const seedsWithBump = [...seeds, new Uint8Array([bump])];
            const address = createProgramAddress(seedsWithBump, programId);
            return [address, bump];
        } catch {
            bump--;
        }
    }
    throw new Error('Unable to find a valid program address');
}

/**
 * Create a program address from seeds and program ID
 * Uses SHA256 hash (Solana uses a custom curve check but we use a simplified approach)
 */
function createProgramAddress(
    seeds: Uint8Array[],
    programId: Uint8Array,
): Uint8Array {
    // Concatenate all seeds, program ID, and "ProgramDerivedAddress" marker
    const buffer: number[] = [];
    for (const seed of seeds) {
        if (seed.length > 32) {
            throw new Error('Max seed length exceeded');
        }
        buffer.push(...seed);
    }
    buffer.push(...programId);
    buffer.push(...new TextEncoder().encode('ProgramDerivedAddress'));

    // Use Web Crypto API for SHA256
    const data = new Uint8Array(buffer);

    // We need to use synchronous hashing - use a simple JS implementation
    const hash = sha256(data);

    // Check if the point is on the curve
    // In practice, Solana checks if the point is NOT on the ed25519 curve
    // For PDA derivation, we rely on the bump seed to find a valid address
    if (isOnCurve(hash)) {
        throw new Error('Address is on curve');
    }

    return hash;
}

/**
 * Check if a 32-byte array represents a point on the ed25519 curve.
 *
 * Uses the @noble/ed25519 library to properly validate if the given public key
 * is a valid point on the ed25519 curve. This is required for correct PDA
 * (Program Derived Address) derivation in Solana.
 *
 * Solana PDAs must be off-curve (not valid ed25519 points) to ensure they
 * cannot be used as regular signing keys. The bump seed iteration finds the
 * first bump value that produces an off-curve address.
 */
function isOnCurve(publicKey: Uint8Array): boolean {
    try {
        // Point.fromBytes() will throw if the bytes don't represent a valid ed25519 point
        // This includes both malformed data and off-curve points
        Point.fromBytes(publicKey);
        return true;
    } catch {
        // If parsing/decompression fails, the bytes don't represent a valid curve point
        return false;
    }
}

/**
 * Simple SHA256 implementation for synchronous hashing
 */
function sha256(data: Uint8Array): Uint8Array {
    // Initialize hash values (first 32 bits of fractional parts of square roots of first 8 primes)
    const h = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
        0x1f83d9ab, 0x5be0cd19,
    ]);

    // Round constants
    const k = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
        0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
        0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
        0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
        0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
        0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
        0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
        0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]);

    // Pre-processing: adding padding bits
    const bitLen = data.length * 8;
    const padLen = (data.length % 64 < 56 ? 56 : 120) - (data.length % 64);
    const padded = new Uint8Array(data.length + padLen + 8);
    padded.set(data);
    padded[data.length] = 0x80;

    // Append original length in bits as 64-bit big-endian
    const view = new DataView(padded.buffer);
    view.setBigUint64(padded.length - 8, BigInt(bitLen), false);

    // Process each 64-byte chunk
    const w = new Uint32Array(64);
    for (let i = 0; i < padded.length; i += 64) {
        // Copy chunk into first 16 words
        for (let j = 0; j < 16; j++) {
            w[j] = view.getUint32(i + j * 4, false);
        }

        // Extend the first 16 words into the remaining 48 words
        for (let j = 16; j < 64; j++) {
            const s0 =
                rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
            const s1 =
                rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
            w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
        }

        // Initialize working variables
        let [a, b, c, d, e, f, g, hh] = h;

        // Compression function main loop
        for (let j = 0; j < 64; j++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (hh + S1 + ch + k[j] + w[j]) >>> 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (S0 + maj) >>> 0;

            hh = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }

        // Add the compressed chunk to the current hash value
        h[0] = (h[0] + a) >>> 0;
        h[1] = (h[1] + b) >>> 0;
        h[2] = (h[2] + c) >>> 0;
        h[3] = (h[3] + d) >>> 0;
        h[4] = (h[4] + e) >>> 0;
        h[5] = (h[5] + f) >>> 0;
        h[6] = (h[6] + g) >>> 0;
        h[7] = (h[7] + hh) >>> 0;
    }

    // Produce the final hash value (big-endian)
    const result = new Uint8Array(32);
    const resultView = new DataView(result.buffer);
    for (let i = 0; i < 8; i++) {
        resultView.setUint32(i * 4, h[i], false);
    }
    return result;
}

function rotr(x: number, n: number): number {
    return (x >>> n) | (x << (32 - n));
}

/** -----------------------------------------------------------------------
 *  Error + Retry helpers
 *  ---------------------------------------------------------------------*/
class RetryableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RetryableError';
    }
}

const lc = (s: any) => String(s || '').toLowerCase();

function isRetryable(e?: any, status?: number, json?: any) {
    const msg = lc(e?.message || e);
    const jmsg = lc(json?.error?.message);
    const code = json?.error?.code;

    // Transport / fetch layer
    if (
        msg.includes('network') ||
        msg.includes('econnreset') ||
        msg.includes('etimedout') ||
        msg.includes('enotfound') ||
        msg.includes('socket hang up') ||
        msg.includes('operation was aborted') ||
        msg.includes('fetch failed') ||
        msg.includes('aborterror')
    )
        return true;

    // HTTP: transient statuses
    if (status) {
        if ([408, 425, 429, 499, 502, 503, 504, 522, 523, 524].includes(status))
            return true;
        if (status >= 500) return true;
    }

    // JSON-RPC codes
    if (
        typeof code === 'number' &&
        [-32000, -32001, -32002, -32603].includes(code)
    )
        return true;

    // Rate limit messages
    if (
        jmsg.includes('too many requests') ||
        jmsg.includes('rate limit') ||
        jmsg.includes('temporarily unavailable') ||
        jmsg.includes('timeout') ||
        jmsg.includes('busy') ||
        jmsg.includes('overloaded') ||
        jmsg.includes('try again')
    )
        return true;

    // Non-JSON / parsing errors
    if (
        msg.includes('unexpected token') ||
        msg.includes('failed to parse') ||
        msg.includes('non-json')
    )
        return true;

    return false;
}

interface RetryOptions {
    retries?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
    jitterMin?: number;
    jitterMax?: number;
    maxDelayMs?: number;
}

function toOptions(retryOrOpts?: number | RetryOptions) {
    if (typeof retryOrOpts === 'number') {
        return {
            retries: retryOrOpts,
            baseDelayMs: BASE_DELAY_MS,
            timeoutMs: TIMEOUT_MS,
            jitterMin: JITTER_MIN,
            jitterMax: JITTER_MAX,
            maxDelayMs: MAX_DELAY_MS,
        };
    }
    return {
        retries: retryOrOpts?.retries ?? MAX_RETRIES,
        baseDelayMs: retryOrOpts?.baseDelayMs ?? BASE_DELAY_MS,
        timeoutMs: retryOrOpts?.timeoutMs ?? TIMEOUT_MS,
        jitterMin: retryOrOpts?.jitterMin ?? JITTER_MIN,
        jitterMax: retryOrOpts?.jitterMax ?? JITTER_MAX,
        maxDelayMs: retryOrOpts?.maxDelayMs ?? MAX_DELAY_MS,
    };
}

/** -----------------------------------------------------------------------
 *  Solana RPC calls
 *  ---------------------------------------------------------------------*/

/**
 * Account info returned by getAccountInfo
 */
export interface AccountInfo {
    data: string; // base64 encoded
    executable: boolean;
    lamports: number;
    owner: string;
    rentEpoch: number;
}

/**
 * Execute a single JSON-RPC request to Solana
 */
async function makeSolanaRpcRequest(
    method: string,
    params: any[],
    timeoutMs: number,
): Promise<any> {
    const body = {
        jsonrpc: '2.0',
        method,
        params,
        id: 1,
    };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
        const res = await fetch(getSolanaNodeUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });

        let json: any = null;
        try {
            json = await res.json();
        } catch (parseErr) {
            if (isRetryable(parseErr, res.status)) {
                throw new RetryableError(
                    `Non-JSON response (status ${res.status})`,
                );
            }
            throw new Error(`Failed to parse JSON (status ${res.status})`);
        } finally {
            clearTimeout(timer);
        }

        if (!res.ok) {
            if (isRetryable(null, res.status, json)) {
                throw new RetryableError(`HTTP ${res.status}`);
            }
            throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
        }

        if (json?.error) {
            if (isRetryable(null, res.status, json)) {
                throw new RetryableError(
                    `RPC error ${json.error.code}: ${json.error.message}`,
                );
            }
            throw new Error(
                `RPC error ${json.error.code}: ${json.error.message}`,
            );
        }

        return json?.result ?? null;
    } catch (err: any) {
        clearTimeout(timer);
        throw err;
    }
}

/**
 * Make a Solana JSON-RPC call with retry logic
 */
async function makeSolanaRpcCall(
    method: string,
    params: any[],
    retryOrOpts?: number | RetryOptions,
    errorContext?: string,
): Promise<any> {
    const {
        retries,
        baseDelayMs,
        timeoutMs,
        jitterMin,
        jitterMax,
        maxDelayMs,
    } = toOptions(retryOrOpts);

    const attempts = Math.max(1, retries);
    let lastError: any;

    const queue = new PQueue({ concurrency: 1 });

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const result = await queue.add(async () => {
                return await makeSolanaRpcRequest(method, params, timeoutMs);
            });

            return result;
        } catch (err: any) {
            lastError = err;

            const retryable = err instanceof RetryableError || isRetryable(err);
            if (!retryable || attempt === attempts) {
                throw err;
            }

            log.debug('Solana RPC request failed, retrying', {
                method,
                attempt,
                maxAttempts: attempts,
                error: err.message,
                endpoint: getSolanaNodeUrl(),
                context: errorContext,
            });

            // Exponential backoff with jitter
            const backoffMs = Math.floor(baseDelayMs * 2 ** (attempt - 1));
            const jitterRange = jitterMax - jitterMin;
            const jitter = Math.floor(
                backoffMs * (jitterMin + Math.random() * jitterRange),
            );
            const delay = Math.min(maxDelayMs, jitter);
            await sleep(delay);
        }
    }

    throw (
        lastError ??
        new Error(
            `Unknown error in Solana RPC call${errorContext ? `: ${errorContext}` : ''}`,
        )
    );
}

/**
 * Get account info for a Solana address
 */
export async function getAccountInfo(
    address: string,
    retryOrOpts?: number | RetryOptions,
): Promise<AccountInfo | null> {
    const result = await makeSolanaRpcCall(
        'getAccountInfo',
        [address, { encoding: 'base64', commitment: 'confirmed' }],
        retryOrOpts,
        `getting account info for ${address}`,
    );

    if (!result || !result.value) {
        return null;
    }

    return {
        data: result.value.data[0],
        executable: result.value.executable,
        lamports: result.value.lamports,
        owner: result.value.owner,
        rentEpoch: result.value.rentEpoch,
    };
}

/**
 * Get multiple account infos in a single RPC call
 */
export async function getMultipleAccountsInfo(
    addresses: string[],
    retryOrOpts?: number | RetryOptions,
): Promise<(AccountInfo | null)[]> {
    const result = await makeSolanaRpcCall(
        'getMultipleAccounts',
        [addresses, { encoding: 'base64', commitment: 'confirmed' }],
        retryOrOpts,
        `getting multiple accounts (${addresses.length})`,
    );

    if (!result || !result.value) {
        return addresses.map(() => null);
    }

    return result.value.map((item: any) => {
        if (!item) return null;
        return {
            data: item.data[0],
            executable: item.executable,
            lamports: item.lamports,
            owner: item.owner,
            rentEpoch: item.rentEpoch,
        };
    });
}

/** -----------------------------------------------------------------------
 *  Metaplex Metadata Decoding
 *  ---------------------------------------------------------------------*/

/**
 * Metaplex Token Standard enum values
 * See: https://developers.metaplex.com/token-metadata/token-standard
 */
export enum TokenStandard {
    NonFungible = 0, // NFT
    FungibleAsset = 1, // Semi-fungible (SFT)
    Fungible = 2, // Fungible token
    NonFungibleEdition = 3, // NFT edition
    ProgrammableNonFungible = 4, // Programmable NFT
    ProgrammableNonFungibleEdition = 5, // Programmable NFT edition
}

/**
 * Check if a token standard represents an NFT type
 */
export function isNftTokenStandard(
    tokenStandard: TokenStandard | null,
): boolean {
    if (tokenStandard === null) return false;
    return (
        tokenStandard === TokenStandard.NonFungible ||
        tokenStandard === TokenStandard.NonFungibleEdition ||
        tokenStandard === TokenStandard.ProgrammableNonFungible ||
        tokenStandard === TokenStandard.ProgrammableNonFungibleEdition
    );
}

/**
 * Metaplex metadata structure
 */
export interface MetaplexMetadata {
    name: string;
    symbol: string;
    uri: string;
    sellerFeeBasisPoints: number;
    primarySaleHappened: boolean;
    isMutable: boolean;
    tokenStandard: TokenStandard | null;
}

/**
 * Decode Metaplex metadata from account data (base64)
 * Based on Metaplex Token Metadata Program v1.1.0 format
 *
 * Account structure:
 * - 1 byte: key (discriminator, should be 4 for Metadata)
 * - 32 bytes: update authority
 * - 32 bytes: mint
 * - Data struct:
 *   - 4 bytes: name length (u32 LE) + name string
 *   - 4 bytes: symbol length (u32 LE) + symbol string
 *   - 4 bytes: uri length (u32 LE) + uri string
 *   - 2 bytes: seller fee basis points (u16 LE)
 *   - Optional creators, etc.
 */
export function decodeMetaplexMetadata(
    base64Data: string,
): MetaplexMetadata | null {
    try {
        const data = base64ToUint8Array(base64Data);

        // Minimum size check
        if (data.length < 1 + 32 + 32 + 4) {
            log.debug('Metaplex data too short', { length: data.length });
            return null;
        }

        let offset = 0;

        // Read key (discriminator)
        const key = data[offset];
        offset += 1;

        // Key should be 4 for Metadata account
        if (key !== 4) {
            log.debug('Invalid Metaplex key', { key, expected: 4 });
            return null;
        }

        // Skip update authority (32 bytes)
        offset += 32;

        // Skip mint (32 bytes)
        offset += 32;

        // Read name (borsh string: u32 length + bytes)
        const name = readBorshString(data, offset);
        offset += 4 + name.length;

        // Read symbol
        const symbol = readBorshString(data, offset);
        offset += 4 + symbol.length;

        // Read URI
        const uri = readBorshString(data, offset);
        offset += 4 + uri.length;

        // Read seller fee basis points (u16 LE)
        let sellerFeeBasisPoints = 0;
        if (offset + 2 <= data.length) {
            sellerFeeBasisPoints = data[offset] | (data[offset + 1] << 8);
            offset += 2;
        }

        // Read creators option + vector (skip for now)
        // We'll just check if there are more fields

        // Read primary sale happened (bool)
        let primarySaleHappened = false;
        let isMutable = true;
        let tokenStandard: TokenStandard | null = null;

        if (offset < data.length) {
            // Skip creators option (1 byte for option, then variable)
            const hasCreators = data[offset] === 1;
            offset += 1;

            if (hasCreators && offset + 4 <= data.length) {
                // Read creators vector length
                const creatorsLen =
                    data[offset] |
                    (data[offset + 1] << 8) |
                    (data[offset + 2] << 16) |
                    (data[offset + 3] << 24);
                offset += 4;

                // Skip each creator (32 bytes address + 1 byte verified + 1 byte share = 34 bytes)
                offset += creatorsLen * 34;
            }

            // Read primary sale happened
            if (offset < data.length) {
                primarySaleHappened = data[offset] === 1;
                offset += 1;
            }

            // Read is mutable
            if (offset < data.length) {
                isMutable = data[offset] === 1;
                offset += 1;
            }

            // Read token standard (optional field - 1 byte for Option, then 1 byte for value)
            if (offset < data.length) {
                const hasTokenStandard = data[offset] === 1;
                offset += 1;

                if (hasTokenStandard && offset < data.length) {
                    const standardValue = data[offset];
                    // Validate it's a known TokenStandard value (0-5)
                    if (standardValue <= 5) {
                        tokenStandard = standardValue as TokenStandard;
                    }
                    offset += 1;
                }
            }
        }

        // Clean up strings (remove null bytes and trim)
        return {
            name: cleanString(name),
            symbol: cleanString(symbol),
            uri: cleanString(uri),
            sellerFeeBasisPoints,
            primarySaleHappened,
            isMutable,
            tokenStandard,
        };
    } catch (error) {
        log.debug('Failed to decode Metaplex metadata', {
            error: (error as Error).message,
        });
        return null;
    }
}

/**
 * Read a Borsh string (u32 length + bytes)
 */
function readBorshString(data: Uint8Array, offset: number): string {
    if (offset + 4 > data.length) {
        return '';
    }

    const length =
        data[offset] |
        (data[offset + 1] << 8) |
        (data[offset + 2] << 16) |
        (data[offset + 3] << 24);

    if (length === 0 || offset + 4 + length > data.length) {
        return '';
    }

    const bytes = data.slice(offset + 4, offset + 4 + length);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Clean a string by removing null bytes and trimming whitespace
 */
function cleanString(str: string): string {
    // Remove null bytes and other control characters
    return str.replace(/\0/g, '').trim();
}

/**
 * Convert base64 to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
    // Handle both standard and URL-safe base64
    const normalizedBase64 = base64
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .replace(/\s/g, '');

    const binaryString = atob(normalizedBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

/** -----------------------------------------------------------------------
 *  Token-2022 Extension Parsing
 *  ---------------------------------------------------------------------*/

/**
 * Token-2022 metadata extension data
 */
export interface Token2022Metadata {
    name: string;
    symbol: string;
    uri: string;
}

/**
 * Token-2022 extension types
 */
const TOKEN_2022_EXTENSION_TYPES = {
    UNINITIALIZED: 0,
    TRANSFER_FEE_CONFIG: 1,
    TRANSFER_FEE_AMOUNT: 2,
    MINT_CLOSE_AUTHORITY: 3,
    CONFIDENTIAL_TRANSFER_MINT: 4,
    CONFIDENTIAL_TRANSFER_ACCOUNT: 5,
    DEFAULT_ACCOUNT_STATE: 6,
    IMMUTABLE_OWNER: 7,
    MEMO_TRANSFER: 8,
    NON_TRANSFERABLE: 9,
    INTEREST_BEARING_CONFIG: 10,
    CPI_GUARD: 11,
    PERMANENT_DELEGATE: 12,
    NON_TRANSFERABLE_ACCOUNT: 13,
    TRANSFER_HOOK: 14,
    TRANSFER_HOOK_ACCOUNT: 15,
    CONFIDENTIAL_TRANSFER_FEE_CONFIG: 16,
    CONFIDENTIAL_TRANSFER_FEE_AMOUNT: 17,
    METADATA_POINTER: 18,
    TOKEN_METADATA: 19,
    GROUP_POINTER: 20,
    TOKEN_GROUP: 21,
    GROUP_MEMBER_POINTER: 22,
    TOKEN_GROUP_MEMBER: 23,
};

/**
 * SPL Token program ID
 */
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

/**
 * Token-2022 program ID
 */
export const TOKEN_2022_PROGRAM_ID =
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/**
 * Parse Token-2022 extensions from mint account data
 * Returns metadata if TOKEN_METADATA extension is found
 *
 * Token-2022 Mint layout:
 * - Bytes 0-81: Standard mint data (82 bytes)
 * - Bytes 82-164: Padding (83 bytes of zeros)
 * - Byte 165: Account type (1 = Mint, 2 = Account)
 * - Bytes 166+: TLV extensions
 */
export function parseToken2022Extensions(
    base64Data: string,
    owner: string,
): Token2022Metadata | null {
    try {
        // Check if this is a Token-2022 mint
        if (owner !== TOKEN_2022_PROGRAM_ID) {
            return null;
        }

        const data = base64ToUint8Array(base64Data);

        // Token-2022 mint with extensions is at least 166 bytes
        // (82 mint data + 83 padding + 1 account type)
        if (data.length <= 165) {
            return null;
        }

        // Account type is at offset 165
        const accountType = data[165];

        // Account type 1 = Mint, 2 = Account
        if (accountType !== 1) {
            // Not a mint account or uninitialized
            return null;
        }

        // TLV extensions start at offset 166
        let offset = 166;

        // Parse TLV (Type-Length-Value) extensions
        while (offset + 4 <= data.length) {
            // Read type (2 bytes LE)
            const extensionType = data[offset] | (data[offset + 1] << 8);
            offset += 2;

            // Read length (2 bytes LE)
            const length = data[offset] | (data[offset + 1] << 8);
            offset += 2;

            if (offset + length > data.length) {
                break;
            }

            // Check if this is TOKEN_METADATA extension
            if (extensionType === TOKEN_2022_EXTENSION_TYPES.TOKEN_METADATA) {
                return parseTokenMetadataExtension(
                    data.slice(offset, offset + length),
                );
            }

            offset += length;
        }

        return null;
    } catch (error) {
        log.debug('Failed to parse Token-2022 extensions', {
            error: (error as Error).message,
        });
        return null;
    }
}

/**
 * Parse the TOKEN_METADATA extension data
 * Structure:
 * - 32 bytes: update authority
 * - 32 bytes: mint
 * - 4 bytes: name length + name
 * - 4 bytes: symbol length + symbol
 * - 4 bytes: uri length + uri
 * - 4 bytes: additional metadata count + entries
 */
function parseTokenMetadataExtension(data: Uint8Array): Token2022Metadata {
    let offset = 0;

    // Skip update authority (32 bytes)
    offset += 32;

    // Skip mint (32 bytes)
    offset += 32;

    // Read name
    const name = readBorshString(data, offset);
    const nameLen =
        data[offset] |
        (data[offset + 1] << 8) |
        (data[offset + 2] << 16) |
        (data[offset + 3] << 24);
    offset += 4 + nameLen;

    // Read symbol
    const symbol = readBorshString(data, offset);
    const symbolLen =
        data[offset] |
        (data[offset + 1] << 8) |
        (data[offset + 2] << 16) |
        (data[offset + 3] << 24);
    offset += 4 + symbolLen;

    // Read uri
    const uri = readBorshString(data, offset);

    return {
        name: cleanString(name),
        symbol: cleanString(symbol),
        uri: cleanString(uri),
    };
}

/** -----------------------------------------------------------------------
 *  High-level metadata fetch function
 *  ---------------------------------------------------------------------*/

/**
 * Result of fetching Solana token metadata
 */
export interface SolanaTokenMetadata {
    mint: string;
    name: string;
    symbol: string;
    uri: string;
    source: 'metaplex' | 'token2022' | 'none';
    tokenStandard: TokenStandard | null;
    /** Whether the mint account exists on-chain (false if burned/closed) */
    mintAccountExists: boolean;
}

/**
 * Check if a mint account exists on-chain
 * Returns false if the account has been burned/closed
 */
export async function checkMintAccountExists(
    mint: string,
    retryOrOpts?: number | RetryOptions,
): Promise<boolean> {
    try {
        const accountInfo = await getAccountInfo(mint, retryOrOpts);
        return accountInfo !== null;
    } catch {
        return false;
    }
}

/**
 * Fetch token metadata for a Solana mint address
 * Tries Metaplex first, then Token-2022 extensions (if applicable)
 *
 * @param mint - The mint address to fetch metadata for
 * @param programId - Program ID of the token (required). Used to determine if Token-2022 lookup is needed.
 * @param retryOrOpts - Retry options for RPC calls
 */
export async function fetchSolanaTokenMetadata(
    mint: string,
    programId: string,
    retryOrOpts?: number | RetryOptions,
): Promise<SolanaTokenMetadata> {
    // Validate programId is always provided - this is critical data we should always have
    if (!programId) {
        log.error('CRITICAL: programId is required but not provided', { mint });
        console.error(
            `CRITICAL ERROR: programId is required for mint ${mint}. This indicates missing data in the source.`,
        );
        process.exit(1);
    }

    // Check if mint account exists
    const mintAccountExists = await checkMintAccountExists(mint, retryOrOpts);

    // First, try Metaplex metadata (works for both SPL Token and Token-2022)
    try {
        const metadataPda = findMetadataPda(mint);

        log.debug('Looking up Metaplex metadata', {
            mint,
            metadataPda,
            programId,
        });

        const accountInfo = await getAccountInfo(metadataPda, retryOrOpts);

        if (accountInfo?.data) {
            const metadata = decodeMetaplexMetadata(accountInfo.data);
            if (metadata) {
                log.debug('Found Metaplex metadata', {
                    mint,
                    name: metadata.name,
                    symbol: metadata.symbol,
                    tokenStandard: metadata.tokenStandard,
                });
                return {
                    mint,
                    name: metadata.name,
                    symbol: metadata.symbol,
                    uri: metadata.uri,
                    source: 'metaplex',
                    tokenStandard: metadata.tokenStandard,
                    mintAccountExists,
                };
            }
        }
    } catch (error) {
        log.debug('Metaplex lookup failed', {
            mint,
            error: (error as Error).message,
        });
    }

    // Only try Token-2022 extensions if programId is the Token-2022 program
    // Skip for standard SPL Token program as it doesn't support extensions
    if (programId === TOKEN_2022_PROGRAM_ID) {
        try {
            const mintAccountInfo = await getAccountInfo(mint, retryOrOpts);

            if (mintAccountInfo?.data) {
                const token2022Metadata = parseToken2022Extensions(
                    mintAccountInfo.data,
                    mintAccountInfo.owner,
                );

                if (token2022Metadata) {
                    log.debug('Found Token-2022 metadata', {
                        mint,
                        name: token2022Metadata.name,
                        symbol: token2022Metadata.symbol,
                    });
                    return {
                        mint,
                        name: token2022Metadata.name,
                        symbol: token2022Metadata.symbol,
                        uri: token2022Metadata.uri,
                        source: 'token2022',
                        tokenStandard: null, // Token-2022 doesn't use Metaplex tokenStandard
                        mintAccountExists,
                    };
                }
            }
        } catch (error) {
            log.debug('Token-2022 lookup failed', {
                mint,
                error: (error as Error).message,
            });
        }
    } else {
        log.debug('Skipping Token-2022 lookup for standard SPL token', {
            mint,
            programId,
        });
    }

    // No metadata found
    log.debug('No metadata found for mint', { mint, mintAccountExists });
    return {
        mint,
        name: '',
        symbol: '',
        uri: '',
        source: '',
        tokenStandard: null,
        mintAccountExists,
    };
}

/** -----------------------------------------------------------------------
 *  Pump.fun AMM LP Token Support
 *  ---------------------------------------------------------------------*/

export const PUMP_AMM_PROGRAM_ID =
    'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

/**
 * Pump.fun AMM Pool Layout:
 * - Offset 0-7: discriminator (8 bytes)
 * - Offset 8-42: pool config/authority (35 bytes)
 * - Offset 43-74: quote_mint (32 bytes) - typically WSOL
 * - Offset 75-106: base_mint (32 bytes) - the token
 * - Offset 107-138: lp_mint (32 bytes)
 * - ... additional fields
 */
const PUMP_AMM_POOL_QUOTE_MINT_OFFSET = 43;
const PUMP_AMM_POOL_BASE_MINT_OFFSET = 75;
const PUMP_AMM_POOL_LP_MINT_OFFSET = 107;
// Minimum pool size - pools can be larger if struct is extended with new fields
const PUMP_AMM_POOL_MIN_SIZE = 139; // lpMint ends at offset 107 + 32 = 139

export interface PumpAmmPoolInfo {
    quoteMint: string;
    baseMint: string;
    lpMint: string;
}

/**
 * Parse Pump.fun AMM pool data to extract token mints
 */
export function parsePumpAmmPool(data: string): PumpAmmPoolInfo | null {
    const buffer = Buffer.from(data, 'base64');

    // Check minimum size to ensure all required fields are present
    if (buffer.length < PUMP_AMM_POOL_MIN_SIZE) {
        return null;
    }

    // Extract pubkeys at known offsets
    const quoteMint = base58Encode(
        buffer.slice(
            PUMP_AMM_POOL_QUOTE_MINT_OFFSET,
            PUMP_AMM_POOL_QUOTE_MINT_OFFSET + 32,
        ),
    );
    const baseMint = base58Encode(
        buffer.slice(
            PUMP_AMM_POOL_BASE_MINT_OFFSET,
            PUMP_AMM_POOL_BASE_MINT_OFFSET + 32,
        ),
    );
    const lpMint = base58Encode(
        buffer.slice(
            PUMP_AMM_POOL_LP_MINT_OFFSET,
            PUMP_AMM_POOL_LP_MINT_OFFSET + 32,
        ),
    );

    return { quoteMint, baseMint, lpMint };
}

/**
 * Derive LP token name from pool constituent tokens
 * Returns a name like "Pump.fun AMM (SOL-VIBECOIN) LP Token"
 */
export async function derivePumpAmmLpMetadata(
    poolAddress: string,
    retryOrOpts?: number | RetryOptions,
): Promise<{ name: string; symbol: string } | null> {
    try {
        // Get pool account data
        const poolInfo = await getAccountInfo(poolAddress, retryOrOpts);
        if (!poolInfo?.data || poolInfo.owner !== PUMP_AMM_PROGRAM_ID) {
            return null;
        }

        const pool = parsePumpAmmPool(poolInfo.data);
        if (!pool) {
            return null;
        }

        // Get metadata PDAs and mint accounts for both tokens
        const [baseMetaInfo, quoteMetaInfo, baseMintInfo, quoteMintInfo] =
            await getMultipleAccountsInfo(
                [
                    findMetadataPda(pool.baseMint),
                    findMetadataPda(pool.quoteMint),
                    pool.baseMint,
                    pool.quoteMint,
                ],
                retryOrOpts,
            );

        // Helper to get symbol from various sources
        const getSymbol = (
            metaInfo: { data: string; owner: string } | null,
            mintInfo: { data: string; owner: string } | null,
            mint: string,
        ): string => {
            // Try Metaplex first
            if (metaInfo?.data) {
                const metadata = decodeMetaplexMetadata(metaInfo.data);
                if (metadata?.symbol) {
                    return metadata.symbol;
                }
            }

            // Try Token-2022 extensions
            if (mintInfo?.data && mintInfo.owner === TOKEN_2022_PROGRAM_ID) {
                const t2022 = parseToken2022Extensions(
                    mintInfo.data,
                    mintInfo.owner,
                );
                if (t2022?.symbol) {
                    return t2022.symbol;
                }
            }

            // Handle well-known tokens
            if (mint === 'So11111111111111111111111111111111111111112') {
                return 'SOL';
            }

            // Fall back to truncated mint address
            return mint.slice(0, 6);
        };

        const baseSymbol = getSymbol(baseMetaInfo, baseMintInfo, pool.baseMint);
        const quoteSymbol = getSymbol(
            quoteMetaInfo,
            quoteMintInfo,
            pool.quoteMint,
        );

        return {
            name: `Pump.fun AMM (${quoteSymbol}-${baseSymbol}) LP Token`,
            symbol: `${quoteSymbol}-${baseSymbol}-LP`,
        };
    } catch (error) {
        log.debug('Failed to derive Pump.fun AMM LP metadata', {
            poolAddress,
            error: (error as Error).message,
        });
        return null;
    }
}

/**
 * Check if a mint is a Pump.fun AMM LP token and get its pool address
 * LP tokens have the pool account as their mint authority
 */
export async function isPumpAmmLpToken(
    mintAddress: string,
    retryOrOpts?: number | RetryOptions,
): Promise<{ isLpToken: boolean; poolAddress: string | null }> {
    try {
        // Get mint account
        const mintInfo = await getAccountInfo(mintAddress, retryOrOpts);
        if (!mintInfo?.data) {
            return { isLpToken: false, poolAddress: null };
        }

        // Parse mint data - mint authority is at offset 4 (after 4 bytes of coption + maybe discriminator)
        // Standard SPL mint layout: 4 bytes coption + 32 bytes mint authority
        const buffer = Buffer.from(mintInfo.data, 'base64');

        // Check if it has a mint authority
        const hasAuthority = buffer.readUInt32LE(0) === 1; // COption::Some
        if (!hasAuthority) {
            return { isLpToken: false, poolAddress: null };
        }

        const mintAuthority = base58Encode(buffer.slice(4, 36));

        // Check if mint authority is owned by Pump.fun AMM program
        const authorityInfo = await getAccountInfo(mintAuthority, retryOrOpts);
        if (authorityInfo?.owner === PUMP_AMM_PROGRAM_ID) {
            return { isLpToken: true, poolAddress: mintAuthority };
        }

        return { isLpToken: false, poolAddress: null };
    } catch (error) {
        log.debug('Failed to check if mint is Pump.fun AMM LP token', {
            mintAddress,
            error: (error as Error).message,
        });
        return { isLpToken: false, poolAddress: null };
    }
}

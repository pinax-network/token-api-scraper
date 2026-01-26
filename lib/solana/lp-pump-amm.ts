/**
 * Pump.fun AMM LP Token Support
 * Provides functions to detect and derive metadata for Pump.fun AMM LP tokens
 */

import { createLogger } from '../logger';
import {
    base58Encode,
    decodeMetaplexMetadata,
    findMetadataPda,
    getAccountInfo,
    getMultipleAccountsInfo,
    parseToken2022Extensions,
    type RetryOptions,
    TOKEN_2022_PROGRAM_ID,
} from '../solana-rpc';

const log = createLogger('lp-pump-amm');

/** Pump.fun AMM Program ID */
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

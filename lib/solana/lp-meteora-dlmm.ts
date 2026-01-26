/**
 * Meteora DLMM LP Token Support
 * Provides functions to detect and derive metadata for Meteora DLMM LP tokens
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

const log = createLogger('lp-meteora-dlmm');

/** Meteora DLMM Program ID */
export const METEORA_DLMM_PROGRAM_ID =
    '24Uqj9JCLxUeoC3hGfh5W3s9FM9uCHDS2SG3LYwBpyTi';

/**
 * Meteora DLMM LbPair Pool Layout (empirically determined):
 * - Offset 0-7: discriminator (8 bytes)
 * - Offset 8-50: parameters + vParameters + small fields (43 bytes)
 * - Offset 51-82: tokenXMint (32 bytes) - can be all zeros for native SOL
 * - Offset 83-114: tokenYMint (32 bytes)
 * - Offset 115-146: lbMint (32 bytes) - the LP token
 * - ... additional fields (reserveX, reserveY, etc.)
 */
const METEORA_DLMM_TOKEN_X_MINT_OFFSET = 51;
const METEORA_DLMM_TOKEN_Y_MINT_OFFSET = 83;
const METEORA_DLMM_LB_MINT_OFFSET = 115;
const METEORA_DLMM_POOL_MIN_SIZE = 147; // lbMint ends at offset 115 + 32 = 147

export interface MeteoraDlmmPoolInfo {
    tokenXMint: string;
    tokenYMint: string;
    lbMint: string;
}

/**
 * Parse Meteora DLMM pool data to extract token mints
 */
export function parseMeteoraDlmmPool(data: string): MeteoraDlmmPoolInfo | null {
    const buffer = Buffer.from(data, 'base64');

    // Check minimum size to ensure all required fields are present
    if (buffer.length < METEORA_DLMM_POOL_MIN_SIZE) {
        return null;
    }

    // Extract pubkeys at known offsets
    const tokenXMint = base58Encode(
        buffer.slice(
            METEORA_DLMM_TOKEN_X_MINT_OFFSET,
            METEORA_DLMM_TOKEN_X_MINT_OFFSET + 32,
        ),
    );
    const tokenYMint = base58Encode(
        buffer.slice(
            METEORA_DLMM_TOKEN_Y_MINT_OFFSET,
            METEORA_DLMM_TOKEN_Y_MINT_OFFSET + 32,
        ),
    );
    const lbMint = base58Encode(
        buffer.slice(
            METEORA_DLMM_LB_MINT_OFFSET,
            METEORA_DLMM_LB_MINT_OFFSET + 32,
        ),
    );

    return { tokenXMint, tokenYMint, lbMint };
}

/**
 * Derive LP token name from pool constituent tokens
 * Returns a name like "Meteora DLMM SOL-CATS LP"
 */
export async function deriveMeteoraDlmmLpMetadata(
    poolAddress: string,
    retryOrOpts?: number | RetryOptions,
): Promise<{ name: string; symbol: string } | null> {
    try {
        // Get pool account data
        const poolInfo = await getAccountInfo(poolAddress, retryOrOpts);
        if (!poolInfo?.data || poolInfo.owner !== METEORA_DLMM_PROGRAM_ID) {
            return null;
        }

        const pool = parseMeteoraDlmmPool(poolInfo.data);
        if (!pool) {
            return null;
        }

        // Check if tokenXMint is the system program (all zeros = native SOL)
        const isTokenXNativeSol =
            pool.tokenXMint === '11111111111111111111111111111111';

        // Get metadata for the tokens we need to fetch
        const addressesToFetch: string[] = [];
        if (!isTokenXNativeSol) {
            addressesToFetch.push(findMetadataPda(pool.tokenXMint));
            addressesToFetch.push(pool.tokenXMint);
        }
        addressesToFetch.push(findMetadataPda(pool.tokenYMint));
        addressesToFetch.push(pool.tokenYMint);

        const accountInfos = await getMultipleAccountsInfo(
            addressesToFetch,
            retryOrOpts,
        );

        // Helper to get symbol from various sources
        const getSymbol = (
            metaInfo: { data: string; owner: string } | null,
            mintInfo: { data: string; owner: string } | null,
            mint: string,
        ): string => {
            // Handle well-known tokens first
            if (mint === 'So11111111111111111111111111111111111111112') {
                return 'SOL';
            }

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

            // Fall back to truncated mint address
            return mint.slice(0, 6);
        };

        let tokenXSymbol: string;
        let tokenYSymbol: string;

        if (isTokenXNativeSol) {
            // Native SOL - no need to fetch metadata
            tokenXSymbol = 'SOL';
            const tokenYMetaInfo = accountInfos[0];
            const tokenYMintInfo = accountInfos[1];
            tokenYSymbol = getSymbol(
                tokenYMetaInfo,
                tokenYMintInfo,
                pool.tokenYMint,
            );
        } else {
            const tokenXMetaInfo = accountInfos[0];
            const tokenXMintInfo = accountInfos[1];
            const tokenYMetaInfo = accountInfos[2];
            const tokenYMintInfo = accountInfos[3];
            tokenXSymbol = getSymbol(
                tokenXMetaInfo,
                tokenXMintInfo,
                pool.tokenXMint,
            );
            tokenYSymbol = getSymbol(
                tokenYMetaInfo,
                tokenYMintInfo,
                pool.tokenYMint,
            );
        }

        return {
            name: `Meteora DLMM ${tokenXSymbol}-${tokenYSymbol} LP`,
            symbol: `${tokenXSymbol}-${tokenYSymbol}-LP`,
        };
    } catch (error) {
        log.debug('Failed to derive Meteora DLMM LP metadata', {
            poolAddress,
            error: (error as Error).message,
        });
        return null;
    }
}

/**
 * Check if a mint is a Meteora DLMM LP token and get its pool address
 * LP tokens have the pool account as their mint authority
 */
export async function isMeteoraDlmmLpToken(
    mintAddress: string,
    retryOrOpts?: number | RetryOptions,
): Promise<{ isLpToken: boolean; poolAddress: string | null }> {
    try {
        // Get mint account
        const mintInfo = await getAccountInfo(mintAddress, retryOrOpts);
        if (!mintInfo?.data) {
            return { isLpToken: false, poolAddress: null };
        }

        // Parse mint data - mint authority is at offset 4 (after 4 bytes coption)
        // Standard SPL mint layout: 4 bytes coption + 32 bytes mint authority
        const buffer = Buffer.from(mintInfo.data, 'base64');

        // Check if it has a mint authority
        const hasAuthority = buffer.readUInt32LE(0) === 1; // COption::Some
        if (!hasAuthority) {
            return { isLpToken: false, poolAddress: null };
        }

        const mintAuthority = base58Encode(buffer.slice(4, 36));

        // Check if mint authority is owned by Meteora DLMM program
        const authorityInfo = await getAccountInfo(mintAuthority, retryOrOpts);
        if (authorityInfo?.owner === METEORA_DLMM_PROGRAM_ID) {
            return { isLpToken: true, poolAddress: mintAuthority };
        }

        return { isLpToken: false, poolAddress: null };
    } catch (error) {
        log.debug('Failed to check if mint is Meteora DLMM LP token', {
            mintAddress,
            error: (error as Error).message,
        });
        return { isLpToken: false, poolAddress: null };
    }
}

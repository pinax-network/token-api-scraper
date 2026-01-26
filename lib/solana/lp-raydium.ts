/**
 * Raydium LP Token Support (AMM V4 + CPMM)
 * Provides functions to detect and derive metadata for Raydium LP tokens
 *
 * NOTE: The isRaydiumAmmLpToken function uses getProgramAccounts which is a heavy RPC call.
 * This should be used in the metadata-solana-extras service for tokens that don't have standard metadata.
 */

import { createLogger } from '../logger';
import {
    base58Encode,
    decodeMetaplexMetadata,
    findMetadataPda,
    getAccountInfo,
    getMultipleAccountsInfo,
    getProgramAccounts,
    parseToken2022Extensions,
    type RetryOptions,
    TOKEN_2022_PROGRAM_ID,
} from '../solana-rpc';

const log = createLogger('lp-raydium');

/**
 * Raydium AMM V4 Program ID (mainnet)
 * This is the standard AMM program for Raydium liquidity pools
 */
export const RAYDIUM_AMM_PROGRAM_ID =
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

/**
 * Raydium CPMM (Constant Product Market Maker) Program ID (mainnet)
 * This is the newer AMM program used for many recent Raydium pools
 */
export const RAYDIUM_CPMM_PROGRAM_ID =
    'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';

/**
 * Raydium AMM V4 Authority PDA
 * Derived from seeds [b"amm authority"] with bump 254
 */
export const RAYDIUM_AMM_AUTHORITY =
    '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1';

/**
 * Raydium CPMM Authority - Fixed address for all CPMM pools
 */
export const RAYDIUM_CPMM_AUTHORITY =
    'GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL';

/**
 * Raydium AMM Pool (AmmInfo) Layout:
 * Based on the official Raydium AMM state.rs struct
 * https://github.com/raydium-io/raydium-amm/blob/master/program/src/state.rs
 *
 * The struct is #[repr(C, packed)] with the following fields:
 * - status to sys_decimal_value: 17 x u64 = 136 bytes (offset 0-135)
 * - fees: Fees struct = 64 bytes (offset 136-199)
 * - state_data: StateData struct = 144 bytes (offset 200-343)
 * - coin_vault: Pubkey = 32 bytes (offset 344-375)
 * - pc_vault: Pubkey = 32 bytes (offset 376-407)
 * - coin_vault_mint: Pubkey = 32 bytes (offset 408-439) - token A mint
 * - pc_vault_mint: Pubkey = 32 bytes (offset 440-471) - token B mint
 * - lp_mint: Pubkey = 32 bytes (offset 472-503) - LP token mint
 */
const RAYDIUM_AMM_COIN_MINT_OFFSET = 408;
const RAYDIUM_AMM_PC_MINT_OFFSET = 440;
const RAYDIUM_AMM_LP_MINT_OFFSET = 472;
const RAYDIUM_AMM_MIN_SIZE = 504; // lp_mint ends at offset 472 + 32 = 504

export interface RaydiumAmmPoolInfo {
    coinMint: string;
    pcMint: string;
    lpMint: string;
}

/**
 * Parse Raydium AMM pool data to extract token mints
 */
export function parseRaydiumAmmPool(data: string): RaydiumAmmPoolInfo | null {
    const buffer = Buffer.from(data, 'base64');

    // Check minimum size to ensure all required fields are present
    if (buffer.length < RAYDIUM_AMM_MIN_SIZE) {
        return null;
    }

    // Extract pubkeys at known offsets
    const coinMint = base58Encode(
        buffer.slice(
            RAYDIUM_AMM_COIN_MINT_OFFSET,
            RAYDIUM_AMM_COIN_MINT_OFFSET + 32,
        ),
    );
    const pcMint = base58Encode(
        buffer.slice(
            RAYDIUM_AMM_PC_MINT_OFFSET,
            RAYDIUM_AMM_PC_MINT_OFFSET + 32,
        ),
    );
    const lpMint = base58Encode(
        buffer.slice(
            RAYDIUM_AMM_LP_MINT_OFFSET,
            RAYDIUM_AMM_LP_MINT_OFFSET + 32,
        ),
    );

    return { coinMint, pcMint, lpMint };
}

/**
 * CPMM pool layout offsets
 * Layout: 8 (discriminator) + amm_config(32) + pool_creator(32) + token_0_vault(32) + token_1_vault(32)
 *       + lp_mint(32) + token_0_mint(32) + token_1_mint(32) + ...
 */
const RAYDIUM_CPMM_TOKEN_0_MINT_OFFSET = 8 + 5 * 32; // = 168
const RAYDIUM_CPMM_TOKEN_1_MINT_OFFSET = 8 + 6 * 32; // = 200
const RAYDIUM_CPMM_MIN_SIZE = 8 + 7 * 32; // = 232 (through token_1_mint)

export interface RaydiumCpmmPoolInfo {
    token0Mint: string;
    token1Mint: string;
}

/**
 * Parse Raydium CPMM pool data to extract token mints
 */
export function parseRaydiumCpmmPool(data: string): RaydiumCpmmPoolInfo | null {
    const buffer = Buffer.from(data, 'base64');

    // Check minimum size
    if (buffer.length < RAYDIUM_CPMM_MIN_SIZE) {
        return null;
    }

    const token0Mint = base58Encode(
        buffer.slice(
            RAYDIUM_CPMM_TOKEN_0_MINT_OFFSET,
            RAYDIUM_CPMM_TOKEN_0_MINT_OFFSET + 32,
        ),
    );
    const token1Mint = base58Encode(
        buffer.slice(
            RAYDIUM_CPMM_TOKEN_1_MINT_OFFSET,
            RAYDIUM_CPMM_TOKEN_1_MINT_OFFSET + 32,
        ),
    );

    return { token0Mint, token1Mint };
}

/**
 * Type of Raydium pool
 */
export type RaydiumPoolType = 'amm-v4' | 'cpmm';

/**
 * Derive LP token name from pool constituent tokens
 * Supports both AMM V4 and CPMM pools
 * Returns a name like "Raydium (WSOL-AURA) LP Token"
 */
export async function deriveRaydiumLpMetadata(
    poolAddress: string,
    poolType: RaydiumPoolType = 'amm-v4',
    retryOrOpts?: number | RetryOptions,
): Promise<{ name: string; symbol: string } | null> {
    try {
        // Get pool account data
        const poolInfo = await getAccountInfo(poolAddress, retryOrOpts);
        if (!poolInfo?.data) {
            return null;
        }

        // Verify owner matches expected program
        const expectedOwner =
            poolType === 'amm-v4'
                ? RAYDIUM_AMM_PROGRAM_ID
                : RAYDIUM_CPMM_PROGRAM_ID;
        if (poolInfo.owner !== expectedOwner) {
            return null;
        }

        // Parse pool based on type
        let coinMint: string;
        let pcMint: string;

        if (poolType === 'amm-v4') {
            const pool = parseRaydiumAmmPool(poolInfo.data);
            if (!pool) {
                return null;
            }
            coinMint = pool.coinMint;
            pcMint = pool.pcMint;
        } else {
            const pool = parseRaydiumCpmmPool(poolInfo.data);
            if (!pool) {
                return null;
            }
            coinMint = pool.token0Mint;
            pcMint = pool.token1Mint;
        }

        // Get metadata PDAs and mint accounts for both tokens
        const [coinMetaInfo, pcMetaInfo, coinMintInfo, pcMintInfo] =
            await getMultipleAccountsInfo(
                [
                    findMetadataPda(coinMint),
                    findMetadataPda(pcMint),
                    coinMint,
                    pcMint,
                ],
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

        const coinSymbol = getSymbol(coinMetaInfo, coinMintInfo, coinMint);
        const pcSymbol = getSymbol(pcMetaInfo, pcMintInfo, pcMint);

        return {
            name: `Raydium (${coinSymbol}-${pcSymbol}) LP Token`,
            symbol: `${coinSymbol}-${pcSymbol}-LP`,
        };
    } catch (error) {
        log.debug('Failed to derive Raydium LP metadata', {
            poolAddress,
            poolType,
            error: (error as Error).message,
        });
        return null;
    }
}

/**
 * Set of all valid Raydium LP token mint authorities.
 * This includes:
 * - AMM V4 authority: 5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1
 * - CPMM authority: GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL
 */
const RAYDIUM_AUTHORITIES = new Set([
    RAYDIUM_AMM_AUTHORITY, // AMM V4
    RAYDIUM_CPMM_AUTHORITY, // CPMM
]);

/**
 * Check if a mint is a Raydium LP token (AMM V4 or CPMM).
 *
 * Raydium LP tokens have known mint authorities:
 * - AMM V4: 5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1
 * - CPMM: GpMZbSM2GgvTKHJirzeGfMFoaZ8UR2X7F4v8vHTvxFbL
 *
 * This function checks if the mint authority matches any known Raydium authority.
 *
 * NOTE: This function uses getProgramAccounts which is a heavy RPC call.
 * It should only be used in the metadata-solana-extras service for tokens without standard metadata.
 */
export async function isRaydiumAmmLpToken(
    mintAddress: string,
    retryOrOpts?: number | RetryOptions,
): Promise<{
    isLpToken: boolean;
    poolAddress: string | null;
    poolType: RaydiumPoolType | null;
}> {
    try {
        // Get mint account to check mint authority
        const mintInfo = await getAccountInfo(mintAddress, retryOrOpts);
        if (!mintInfo?.data) {
            return { isLpToken: false, poolAddress: null, poolType: null };
        }

        // Parse mint data
        const buffer = Buffer.from(mintInfo.data, 'base64');

        // Check if it has a mint authority (COption::Some at offset 0)
        const hasAuthority = buffer.readUInt32LE(0) === 1;
        if (!hasAuthority) {
            return { isLpToken: false, poolAddress: null, poolType: null };
        }

        const mintAuthority = base58Encode(buffer.slice(4, 36));

        // Check if mint authority is one of the known Raydium authorities
        if (!RAYDIUM_AUTHORITIES.has(mintAuthority)) {
            return { isLpToken: false, poolAddress: null, poolType: null };
        }

        // Determine pool type based on authority
        const poolType: RaydiumPoolType =
            mintAuthority === RAYDIUM_AMM_AUTHORITY ? 'amm-v4' : 'cpmm';

        // Try to find the pool address (in separate try-catch so authority detection still works)
        let poolAddress: string | null = null;

        try {
            if (poolType === 'amm-v4') {
                // AMM V4: lp_mint at offset 472
                const pools = await getProgramAccounts(
                    RAYDIUM_AMM_PROGRAM_ID,
                    {
                        filters: [
                            {
                                memcmp: {
                                    offset: RAYDIUM_AMM_LP_MINT_OFFSET, // 472
                                    bytes: mintAddress,
                                },
                            },
                            { dataSize: 752 },
                        ],
                        encoding: 'base64',
                        dataSlice: { offset: 0, length: 0 },
                    },
                    retryOrOpts,
                );
                poolAddress =
                    pools && pools.length > 0 ? pools[0].pubkey : null;
            } else {
                // CPMM: lp_mint at offset 8 + 4*32 = 136 (after discriminator + first 4 pubkeys)
                // Layout: 8 (discriminator) + amm_config(32) + pool_creator(32) + token_0_vault(32) + token_1_vault(32) + lp_mint(32)
                const CPMM_LP_MINT_OFFSET = 8 + 4 * 32; // = 136
                const pools = await getProgramAccounts(
                    RAYDIUM_CPMM_PROGRAM_ID,
                    {
                        filters: [
                            {
                                memcmp: {
                                    offset: CPMM_LP_MINT_OFFSET,
                                    bytes: mintAddress,
                                },
                            },
                        ],
                        encoding: 'base64',
                        dataSlice: { offset: 0, length: 0 },
                    },
                    retryOrOpts,
                );
                poolAddress =
                    pools && pools.length > 0 ? pools[0].pubkey : null;
            }
        } catch (poolError) {
            log.debug(
                'Failed to find Raydium pool address (LP detection still valid)',
                {
                    mintAddress,
                    poolType,
                    error: (poolError as Error).message,
                },
            );
            // Pool search failed but authority matched, so it's still an LP token
        }

        return { isLpToken: true, poolAddress, poolType };
    } catch (error) {
        log.debug('Failed to check if mint is Raydium LP token', {
            mintAddress,
            error: (error as Error).message,
        });
        return { isLpToken: false, poolAddress: null, poolType: null };
    }
}

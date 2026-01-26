/**
 * Solana metadata extras processing service (RPC-based)
 * Handles heavier RPC calls (LP token detection using getProgramAccounts)
 * for tokens that don't have standard metadata.
 *
 * This service processes tokens that have been inserted into the metadata table
 * with empty source/name/symbol, attempting to derive LP token metadata.
 */

import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import { CLICKHOUSE_DATABASE_INSERT, CONCURRENCY } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { ProcessingStats } from '../../lib/processing-stats';
import { incrementError, incrementSuccess } from '../../lib/prometheus';
import { initService } from '../../lib/service-init';
import {
    deriveMeteoraDlmmLpMetadata,
    derivePumpAmmLpMetadata,
    deriveRaydiumLpMetadata,
    isMeteoraDlmmLpToken,
    isPumpAmmLpToken,
    isRaydiumAmmLpToken,
} from '../../lib/solana/index';
import { insertRow } from '../../src/insert';

const serviceName = 'metadata-solana-extras-rpc';
const log = createLogger(serviceName);

/**
 * Interface for Solana mint data without metadata from ClickHouse
 */
export interface SolanaMintWithoutMetadata {
    contract: string;
    decimals: number;
    block_num: number;
    timestamp: number;
}

/**
 * Process a single Solana mint and attempt to derive LP metadata
 */
async function processSolanaMint(
    data: SolanaMintWithoutMetadata,
    network: string,
    stats: ProcessingStats,
): Promise<void> {
    const startTime = performance.now();

    try {
        let lpName = '';
        let lpSymbol = '';
        let lpSource = '';
        let isLpToken = false;

        // Check Pump.fun AMM LP token
        try {
            const pumpAmmCheck = await isPumpAmmLpToken(data.contract);
            if (pumpAmmCheck.isLpToken && pumpAmmCheck.poolAddress) {
                const lpMetadata = await derivePumpAmmLpMetadata(
                    pumpAmmCheck.poolAddress,
                );
                if (lpMetadata) {
                    isLpToken = true;
                    lpName = lpMetadata.name;
                    lpSymbol = lpMetadata.symbol;
                    lpSource = 'pump-amm';
                    log.debug('Derived Pump.fun AMM LP metadata', {
                        mint: data.contract,
                        poolAddress: pumpAmmCheck.poolAddress,
                        name: lpName,
                        symbol: lpSymbol,
                    });
                }
            }
        } catch (lpError) {
            log.debug('Failed to check for Pump.fun AMM LP token', {
                mint: data.contract,
                error: (lpError as Error).message,
            });
        }

        // Check Meteora DLMM LP token (if not already identified as LP)
        if (!isLpToken) {
            try {
                const meteoraCheck = await isMeteoraDlmmLpToken(data.contract);
                if (meteoraCheck.isLpToken && meteoraCheck.poolAddress) {
                    const lpMetadata = await deriveMeteoraDlmmLpMetadata(
                        meteoraCheck.poolAddress,
                    );
                    if (lpMetadata) {
                        isLpToken = true;
                        lpName = lpMetadata.name;
                        lpSymbol = lpMetadata.symbol;
                        lpSource = 'meteora-dlmm';
                        log.debug('Derived Meteora DLMM LP metadata', {
                            mint: data.contract,
                            poolAddress: meteoraCheck.poolAddress,
                            name: lpName,
                            symbol: lpSymbol,
                        });
                    }
                }
            } catch (lpError) {
                log.debug('Failed to check for Meteora DLMM LP token', {
                    mint: data.contract,
                    error: (lpError as Error).message,
                });
            }
        }

        // Check Raydium LP token - AMM V4 or CPMM (if not already identified as LP)
        // NOTE: This uses getProgramAccounts which is a heavy RPC call
        if (!isLpToken) {
            try {
                const raydiumCheck = await isRaydiumAmmLpToken(data.contract);
                if (raydiumCheck.isLpToken && raydiumCheck.poolType) {
                    // If we have a pool address, try to derive full metadata
                    if (raydiumCheck.poolAddress) {
                        const lpMetadata = await deriveRaydiumLpMetadata(
                            raydiumCheck.poolAddress,
                            raydiumCheck.poolType,
                        );
                        if (lpMetadata) {
                            isLpToken = true;
                            lpName = lpMetadata.name;
                            lpSymbol = lpMetadata.symbol;
                            lpSource = 'raydium';
                            log.debug('Derived Raydium LP metadata', {
                                mint: data.contract,
                                poolAddress: raydiumCheck.poolAddress,
                                poolType: raydiumCheck.poolType,
                                name: lpName,
                                symbol: lpSymbol,
                            });
                        }
                    } else {
                        // Pool address not found but we know it's a Raydium LP token
                        // Mark as LP with generic metadata
                        isLpToken = true;
                        lpName = `Raydium ${raydiumCheck.poolType.toUpperCase()} LP`;
                        lpSymbol = 'RAY-LP';
                        lpSource = 'raydium';
                        log.debug(
                            'Detected Raydium LP token (pool address not found)',
                            {
                                mint: data.contract,
                                poolType: raydiumCheck.poolType,
                                name: lpName,
                                symbol: lpSymbol,
                            },
                        );
                    }
                }
            } catch (lpError) {
                log.debug('Failed to check for Raydium LP token', {
                    mint: data.contract,
                    error: (lpError as Error).message,
                });
            }
        }

        const queryTimeMs = Math.round(performance.now() - startTime);

        // If we derived LP metadata, update the metadata table
        if (isLpToken && lpName) {
            const success = await insertRow(
                'metadata',
                {
                    network,
                    contract: data.contract,
                    block_num: data.block_num,
                    timestamp: data.timestamp,
                    decimals: data.decimals,
                    name: lpName,
                    symbol: lpSymbol,
                    uri: '',
                    source: lpSource,
                    image: '',
                    description: '',
                },
                `Failed to update metadata for mint ${data.contract}`,
                { contract: data.contract },
            );

            if (success) {
                incrementSuccess(serviceName);
                stats.incrementSuccess();
                log.debug('LP metadata derived and updated', {
                    mint: data.contract,
                    name: lpName,
                    symbol: lpSymbol,
                    source: lpSource,
                    decimals: data.decimals,
                    blockNum: data.block_num,
                    queryTimeMs,
                });
            } else {
                incrementError(serviceName);
                stats.incrementError();
            }
        } else {
            // No LP metadata could be derived, skip
            stats.incrementSuccess();
            log.debug('No LP metadata found for mint', {
                mint: data.contract,
                blockNum: data.block_num,
                queryTimeMs,
            });
        }
    } catch (error) {
        const message = (error as Error).message || String(error);

        log.debug('LP metadata check failed', {
            mint: data.contract,
            blockNum: data.block_num,
            error: message,
        });

        incrementError(serviceName);
        stats.incrementError();
    }
}

/**
 * Main run function for the Solana metadata extras service
 */
export async function run(): Promise<void> {
    // Initialize service
    initService({ serviceName });

    // For Solana, the network is always 'solana'
    const network = 'solana';

    // Track processing stats
    const stats = new ProcessingStats(serviceName, network);

    const queue = new PQueue({ concurrency: CONCURRENCY });

    log.info('Querying database for Solana mints without metadata');
    const queryStartTime = performance.now();

    // Query for mints without metadata (candidates for LP token detection)
    const mints = await query<SolanaMintWithoutMetadata>(
        await Bun.file(__dirname + '/get_mints_without_metadata.sql').text(),
        {
            network,
            db: CLICKHOUSE_DATABASE_INSERT,
        },
    );

    const queryTimeSecs = (performance.now() - queryStartTime) / 1000;

    if (mints.data.length > 0) {
        log.info('Processing Solana mints for LP metadata', {
            mintCount: mints.data.length,
            queryTimeSecs,
        });

        // Start progress logging
        stats.startProgressLogging(mints.data.length);

        // Process all mints
        for (const data of mints.data) {
            queue.add(async () => {
                await processSolanaMint(data, network, stats);
            });
        }

        // Wait for all tasks to complete
        await queue.onIdle();
    } else {
        log.info('No Solana mints to process for LP metadata');
    }

    stats.logCompletion();

    // Shutdown batch insert queue
    await shutdownBatchInsertQueue();
}

// Run the service if this is the main module
if (import.meta.main) {
    run().catch((error) => {
        console.error('Service failed:', error);
        process.exit(1);
    });
}

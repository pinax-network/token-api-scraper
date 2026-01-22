/**
 * Solana metadata processing service
 * Fetches token metadata from Metaplex Token Metadata or Token-2022 extensions
 */

import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import { CLICKHOUSE_DATABASE_INSERT, CONCURRENCY } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { ProcessingStats } from '../../lib/processing-stats';
import { incrementError, incrementSuccess } from '../../lib/prometheus';
import { initService } from '../../lib/service-init';
import { fetchSolanaTokenMetadata } from '../../lib/solana-rpc';
import { insertRow } from '../../src/insert';

const serviceName = 'solana-metadata';
const log = createLogger(serviceName);

/**
 * Interface for Solana mint data from ClickHouse
 */
interface SolanaMint {
    mint: string;
    decimals: number;
    block_num: number;
    timestamp: number;
}

/**
 * Process a single Solana mint and fetch its metadata
 */
async function processSolanaMint(
    mint: SolanaMint,
    network: string,
    stats: ProcessingStats,
): Promise<void> {
    const startTime = performance.now();

    try {
        const metadata = await fetchSolanaTokenMetadata(
            mint.mint,
            mint.decimals,
        );
        const queryTimeMs = Math.round(performance.now() - startTime);

        if (metadata.source !== 'none') {
            // Successfully found metadata
            const success = await insertRow(
                'metadata',
                {
                    network,
                    contract: mint.mint,
                    block_num: mint.block_num,
                    timestamp: mint.timestamp,
                    decimals: mint.decimals,
                    name: metadata.name,
                    symbol: metadata.symbol,
                },
                `Failed to insert metadata for mint ${mint.mint}`,
                { contract: mint.mint },
            );

            if (success) {
                incrementSuccess(serviceName);
                stats.incrementSuccess();
                log.debug('Metadata scraped successfully', {
                    mint: mint.mint,
                    name: metadata.name,
                    symbol: metadata.symbol,
                    decimals: mint.decimals,
                    source: metadata.source,
                    blockNum: mint.block_num,
                    queryTimeMs,
                });
            } else {
                incrementError(serviceName);
                stats.incrementError();
            }
        } else {
            // No metadata found - insert with empty name/symbol
            // The mint exists and has decimals, just no metadata
            const success = await insertRow(
                'metadata',
                {
                    network,
                    contract: mint.mint,
                    block_num: mint.block_num,
                    timestamp: mint.timestamp,
                    decimals: mint.decimals,
                    name: '',
                    symbol: '',
                },
                `Failed to insert metadata for mint ${mint.mint}`,
                { contract: mint.mint },
            );

            if (success) {
                incrementSuccess(serviceName);
                stats.incrementSuccess();
                log.debug('Metadata inserted (no on-chain metadata found)', {
                    mint: mint.mint,
                    decimals: mint.decimals,
                    blockNum: mint.block_num,
                    queryTimeMs,
                });
            } else {
                incrementError(serviceName);
                stats.incrementError();
            }
        }
    } catch (error) {
        const message = (error as Error).message || String(error);

        log.debug('Metadata RPC call failed', {
            mint: mint.mint,
            blockNum: mint.block_num,
            error: message,
        });

        // Insert error record
        await insertRow(
            'metadata_errors',
            {
                network,
                contract: mint.mint,
                error: message,
            },
            `Failed to insert error metadata for mint ${mint.mint}`,
            { contract: mint.mint },
        );

        incrementError(serviceName);
        stats.incrementError();
    }
}

/**
 * Main run function for the Solana metadata service
 */
export async function run(): Promise<void> {
    // Initialize service
    initService({ serviceName });

    // For Solana, the network is always 'solana'
    const network = 'solana';

    // Track processing stats
    const stats = new ProcessingStats(serviceName, network);

    const queue = new PQueue({ concurrency: CONCURRENCY });

    log.info('Querying database for Solana mints to process');
    const queryStartTime = performance.now();

    // Query for unprocessed Solana mints
    const mints = await query<SolanaMint>(
        await Bun.file(__dirname + '/get_unprocessed_mints.sql').text(),
        {
            network,
            db: CLICKHOUSE_DATABASE_INSERT,
        },
    );

    const queryTimeSecs = (performance.now() - queryStartTime) / 1000;

    if (mints.data.length > 0) {
        log.info('Processing Solana mints metadata', {
            mintCount: mints.data.length,
            queryTimeSecs,
        });

        // Start progress logging
        stats.startProgressLogging(mints.data.length);

        // Process all mints
        for (const mint of mints.data) {
            queue.add(async () => {
                await processSolanaMint(mint, network, stats);
            });
        }

        // Wait for all tasks to complete
        await queue.onIdle();
    } else {
        log.info('No Solana mints to process');
    }

    stats.logCompletion();

    // Shutdown batch insert queue
    await shutdownBatchInsertQueue();
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}

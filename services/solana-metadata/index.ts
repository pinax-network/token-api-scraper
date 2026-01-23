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
export interface SolanaMint {
    contract: string;
    program_id: string;
    decimals: number;
    block_num: number;
    timestamp: number;
}

/**
 * Process a single Solana mint and fetch its metadata
 */
async function processSolanaMint(
    data: SolanaMint,
    network: string,
    stats: ProcessingStats,
): Promise<void> {
    const startTime = performance.now();
    console.log(data);

    try {
        const metadata = await fetchSolanaTokenMetadata(
            data.contract,
            undefined,
            data.program_id,
        );
        const queryTimeMs = Math.round(performance.now() - startTime);

        if (metadata.source !== 'none') {
            // Successfully found metadata
            const success = await insertRow(
                'metadata',
                {
                    network,
                    contract: data.contract,
                    block_num: data.block_num,
                    timestamp: data.timestamp,
                    decimals: data.decimals,
                    name: metadata.name,
                    symbol: metadata.symbol,
                },
                `Failed to insert metadata for mint ${data.contract}`,
                { contract: data.contract },
            );

            if (success) {
                incrementSuccess(serviceName);
                stats.incrementSuccess();
                log.debug('Metadata scraped successfully', {
                    mint: data.contract,
                    name: metadata.name,
                    symbol: metadata.symbol,
                    decimals: data.decimals,
                    source: metadata.source,
                    blockNum: data.block_num,
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
                    contract: data.contract,
                    block_num: data.block_num,
                    timestamp: data.timestamp,
                    decimals: data.decimals,
                    name: '',
                    symbol: '',
                },
                `Failed to insert metadata for mint ${data.contract}`,
                { contract: data.contract },
            );

            if (success) {
                incrementSuccess(serviceName);
                stats.incrementSuccess();
                log.debug('Metadata inserted (no on-chain metadata found)', {
                    mint: data.contract,
                    decimals: data.decimals,
                    blockNum: data.block_num,
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
            mint: data.contract,
            blockNum: data.block_num,
            error: message,
        });

        // Insert error record
        await insertRow(
            'metadata_errors',
            {
                network,
                contract: data.contract,
                error: message,
            },
            `Failed to insert error metadata for mint ${data.contract}`,
            { contract: data.contract },
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
        for (const data of mints.data) {
            queue.add(async () => {
                await processSolanaMint(data, network, stats);
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
    run().catch((error) => {
        console.error('Service failed:', error);
        process.exit(1);
    });
}

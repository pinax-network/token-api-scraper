/**
 * Solana metadata processing service (ClickHouse-based)
 * Fetches token metadata from ClickHouse tables (initialize_mint, metadata_view)
 * that are populated by the substreams-solana Substreams.
 *
 * This service is purely ClickHouse query-based and does not make any RPC calls.
 * It combines data from:
 * - initialize_mint: mint address, decimals, block_num, timestamp
 * - metadata_view: name, symbol, uri (from Metaplex Token Metadata)
 */

import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import { CLICKHOUSE_DATABASE_INSERT, CONCURRENCY } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { ProcessingStats } from '../../lib/processing-stats';
import { incrementError, incrementSuccess } from '../../lib/prometheus';
import { initService } from '../../lib/service-init';
import type { MetadataSource } from '../../lib/solana-rpc';
import { insertRow } from '../../src/insert';

const serviceName = 'metadata-solana-clickhouse';
const log = createLogger(serviceName);

/**
 * Interface for Solana token metadata from ClickHouse
 */
export interface SolanaTokenMetadata {
    contract: string;
    block_num: number;
    timestamp: number;
    decimals: number;
    name: string;
    symbol: string;
    uri: string;
}

/**
 * Determine the metadata source based on available fields
 * Note: metadata_view only contains Metaplex Token Metadata program data
 */
function determineSource(data: SolanaTokenMetadata): MetadataSource {
    // If we have name/symbol/uri, it's from Metaplex metadata
    if (data.name || data.symbol || data.uri) {
        return 'metaplex';
    }
    // No metadata found
    return '';
}

/**
 * Process a single Solana token metadata record
 */
async function processTokenMetadata(
    data: SolanaTokenMetadata,
    network: string,
    stats: ProcessingStats,
): Promise<void> {
    try {
        const source = determineSource(data);

        if (source !== '') {
            // Successfully found metadata
            const success = await insertRow(
                'metadata',
                {
                    network,
                    contract: data.contract,
                    block_num: data.block_num,
                    timestamp: data.timestamp,
                    decimals: data.decimals,
                    name: data.name,
                    symbol: data.symbol,
                    uri: data.uri,
                    source,
                    image: '', // Not available from ClickHouse tables
                    description: '', // Not available from ClickHouse tables
                },
                `Failed to insert metadata for mint ${data.contract}`,
                { contract: data.contract },
            );

            if (success) {
                incrementSuccess(serviceName);
                stats.incrementSuccess();
                log.debug('Metadata fetched from ClickHouse', {
                    mint: data.contract,
                    name: data.name,
                    symbol: data.symbol,
                    decimals: data.decimals,
                    source,
                    blockNum: data.block_num,
                });
            } else {
                incrementError(serviceName);
                stats.incrementError();
            }
        } else {
            // No metadata found - insert with empty source
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
                    uri: '',
                    source: '',
                    image: '',
                    description: '',
                },
                `Failed to insert metadata for mint ${data.contract}`,
                { contract: data.contract },
            );

            // Also insert to metadata_errors for tracking
            await insertRow(
                'metadata_errors',
                {
                    network,
                    contract: data.contract,
                    error: 'No on-chain metadata found in ClickHouse',
                },
                `Failed to insert error for mint ${data.contract}`,
                { contract: data.contract },
            );

            if (success) {
                incrementSuccess(serviceName);
                stats.incrementSuccess();
                log.debug('Token inserted with no metadata', {
                    mint: data.contract,
                    decimals: data.decimals,
                    blockNum: data.block_num,
                });
            } else {
                incrementError(serviceName);
                stats.incrementError();
            }
        }
    } catch (error) {
        const message = (error as Error).message || String(error);

        log.debug('Metadata processing failed', {
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
 * Main run function for the Solana metadata ClickHouse service
 */
export async function run(): Promise<void> {
    // Initialize service
    initService({ serviceName });

    // For Solana, the network is always 'solana'
    const network = 'solana';

    // Track processing stats
    const stats = new ProcessingStats(serviceName, network);

    const queue = new PQueue({ concurrency: CONCURRENCY });

    log.info('Querying ClickHouse for Solana token metadata');
    const queryStartTime = performance.now();

    // Query for unprocessed Solana tokens from ClickHouse views
    const tokens = await query<SolanaTokenMetadata>(
        await Bun.file(__dirname + '/get_unprocessed_metadata.sql').text(),
        {
            network,
            db: process.env.CLICKHOUSE_DATABASE, // Source data (svm-tokens)
            db_insert: CLICKHOUSE_DATABASE_INSERT, // Metadata tables
        },
    );

    const queryTimeSecs = (performance.now() - queryStartTime) / 1000;

    if (tokens.data.length > 0) {
        log.info('Processing Solana token metadata from ClickHouse', {
            tokenCount: tokens.data.length,
            queryTimeSecs,
        });

        // Start progress logging
        stats.startProgressLogging(tokens.data.length);

        // Process all tokens
        for (const data of tokens.data) {
            queue.add(async () => {
                await processTokenMetadata(data, network, stats);
            });
        }

        // Wait for all tasks to complete
        await queue.onIdle();
    } else {
        log.info('No Solana tokens to process from ClickHouse');
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

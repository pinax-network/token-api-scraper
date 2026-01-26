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
import { fetchUriMetadata } from '../../lib/uri-fetch';
import { insertRow } from '../../src/insert';

const serviceName = 'metadata-solana';
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

    try {
        // Fetch metadata: use default retry options (undefined) and pass program_id for optimization
        const metadata = await fetchSolanaTokenMetadata(
            data.contract,
            data.program_id, // Skip Token-2022 lookup if standard SPL token
        );
        const queryTimeMs = Math.round(performance.now() - startTime);

        if (metadata.source !== '') {
            // Fetch additional metadata from URI if available
            let image = '';
            let description = '';
            let uriName = '';
            let uriSymbol = '';

            if (metadata.uri) {
                // Check if URI is a direct image link (skip fetching JSON)
                const imageExtensions = [
                    '.png',
                    '.jpg',
                    '.jpeg',
                    '.gif',
                    '.webp',
                    '.svg',
                    '.bmp',
                    '.ico',
                ];
                const uriLower = metadata.uri.toLowerCase();
                const isDirectImageUri = imageExtensions.some((ext) =>
                    uriLower.endsWith(ext),
                );

                if (isDirectImageUri) {
                    // URI points directly to an image - use it as the image field
                    image = metadata.uri;
                    log.debug('URI is direct image link', {
                        mint: data.contract,
                        uri: metadata.uri,
                    });
                } else {
                    const uriResult = await fetchUriMetadata(metadata.uri);
                    if (uriResult.success && uriResult.metadata) {
                        image = uriResult.metadata.image || '';
                        description = uriResult.metadata.description || '';
                        uriName = uriResult.metadata.name || '';
                        uriSymbol = uriResult.metadata.symbol || '';
                        log.debug('URI metadata fetched', {
                            mint: data.contract,
                            hasImage: !!image,
                            hasDescription: !!description,
                            hasName: !!uriName,
                            hasSymbol: !!uriSymbol,
                        });
                    } else {
                        log.warn(
                            'Failed to fetch URI metadata after 3 retries',
                            {
                                mint: data.contract,
                                uri: metadata.uri,
                                error: uriResult.error,
                            },
                        );

                        // Track URI fetch failure as error (metadata will still be inserted)
                        await insertRow(
                            'metadata_errors',
                            {
                                network,
                                contract: data.contract,
                                error: `URI fetch failed: ${uriResult.error}`,
                            },
                            `Failed to insert URI error for mint ${data.contract}`,
                            { contract: data.contract },
                        );
                    }
                }
            }

            // Use on-chain name/symbol, falling back to URI metadata if empty
            const finalName = metadata.name || uriName;
            const finalSymbol = metadata.symbol || uriSymbol;

            // Successfully found metadata
            const success = await insertRow(
                'metadata',
                {
                    network,
                    contract: data.contract,
                    block_num: data.block_num,
                    timestamp: data.timestamp,
                    decimals: data.decimals,
                    name: finalName,
                    symbol: finalSymbol,
                    uri: metadata.uri,
                    source: metadata.source,
                    image,
                    description,
                },
                `Failed to insert metadata for mint ${data.contract}`,
                { contract: data.contract },
            );

            if (success) {
                incrementSuccess(serviceName);
                stats.incrementSuccess();
                log.debug('Metadata scraped successfully', {
                    mint: data.contract,
                    name: finalName,
                    symbol: finalSymbol,
                    decimals: data.decimals,
                    source: metadata.source,
                    blockNum: data.block_num,
                    queryTimeMs,
                    hasImage: !!image,
                    hasDescription: !!description,
                });
            } else {
                incrementError(serviceName);
                stats.incrementError();
            }
        } else {
            // No standard metadata found - insert token with empty source
            // LP token metadata will be derived by the metadata-solana-extras service
            const errorMessage = metadata.mintAccountExists
                ? 'No on-chain metadata found'
                : 'Mint account burned or closed';

            log.debug('Inserting token with no metadata', {
                mint: data.contract,
                decimals: data.decimals,
                blockNum: data.block_num,
                queryTimeMs,
                mintAccountExists: metadata.mintAccountExists,
            });

            // Insert to metadata table (with decimals info, empty source for later LP detection)
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
                    error: errorMessage,
                },
                `Failed to insert error for mint ${data.contract}`,
                { contract: data.contract },
            );

            if (success) {
                incrementSuccess(serviceName);
                stats.incrementSuccess();
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

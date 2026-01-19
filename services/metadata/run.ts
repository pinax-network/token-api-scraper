import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import {
    CLICKHOUSE_DATABASE_INSERT,
    CONCURRENCY,
    getNetwork,
} from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { ProcessingStats } from '../../lib/processing-stats';
import { initService } from '../../lib/service-init';
import { processMetadata } from '.';

/**
 * Valid metadata source types
 */
export type MetadataSource = 'transfers' | 'swaps' | 'balances';

/**
 * Unified run function for all metadata services
 * Derives serviceName and SQL file from the source parameter
 */
export async function run(source: MetadataSource) {
    const serviceName = `metadata-${source}`;
    const log = createLogger(serviceName);

    // Initialize service (must be called before using batch insert queue)
    initService({ serviceName });

    // Validate network is set
    const network = getNetwork();

    // Track processing stats for summary logging
    const stats = new ProcessingStats(serviceName, network);

    const queue = new PQueue({ concurrency: CONCURRENCY });

    log.info('Querying database for contracts to process');
    const queryStartTime = performance.now();
    const contracts = await query<{
        contract: string;
        block_num: number;
        timestamp: number;
    }>(await Bun.file(__dirname + `/get_contracts_by_${source}.sql`).text(), {
        network,
        db: CLICKHOUSE_DATABASE_INSERT,
    });
    const queryTimeSecs = (performance.now() - queryStartTime) / 1000;

    if (contracts.data.length > 0) {
        log.info('Processing contracts metadata', {
            contractCount: contracts.data.length,
            source,
            queryTimeSecs,
        });

        // Start progress logging (logs every 10 seconds)
        stats.startProgressLogging(contracts.data.length);

        // Process all contracts
        for (const { contract, block_num, timestamp } of contracts.data) {
            queue.add(async () => {
                await processMetadata(
                    network,
                    contract,
                    block_num,
                    timestamp,
                    serviceName,
                    stats,
                );
            });
        }

        // Wait for all tasks to complete
        await queue.onIdle();
    } else {
        log.info('No contracts to process');
    }

    stats.logCompletion();

    // Shutdown batch insert queue
    await shutdownBatchInsertQueue();
}

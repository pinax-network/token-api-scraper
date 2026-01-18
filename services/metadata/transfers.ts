import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import { CONCURRENCY, getNetwork } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { initService } from '../../lib/service-init';
import { processMetadata } from '.';

const serviceName = 'metadata-transfers';
const log = createLogger(serviceName);

/**
 * Counter object for tracking success and error counts
 * Using an object reference allows safe updates in async callbacks within a single-threaded event loop
 */
interface ProcessingStats {
    successCount: number;
    errorCount: number;
}

export async function run() {
    // Initialize service (must be called before using batch insert queue)
    initService({ serviceName });

    // Validate network is set
    const network = getNetwork();

    // Track processing stats for summary logging
    const stats: ProcessingStats = { successCount: 0, errorCount: 0 };

    const queue = new PQueue({ concurrency: CONCURRENCY });

    const contracts = await query<{
        contract: string;
        block_num: number;
        timestamp: number;
    }>(await Bun.file(__dirname + '/get_contracts_by_transfers.sql').text());

    if (contracts.data.length > 0) {
        log.info('Processing contracts metadata', {
            contractCount: contracts.data.length,
            source: 'transfers',
        });
    } else {
        log.info('No contracts to process');
        return;
    }

    // Process all contracts
    for (const { contract, block_num, timestamp } of contracts.data) {
        queue.add(async () => {
            const success = await processMetadata(
                network,
                contract,
                block_num,
                timestamp,
                serviceName,
            );
            if (success) {
                stats.successCount++;
            } else {
                stats.errorCount++;
            }
        });
    }

    // Wait for all tasks to complete
    await queue.onIdle();

    log.info('Service completed', {
        successCount: stats.successCount,
        errorCount: stats.errorCount,
        totalProcessed: stats.successCount + stats.errorCount,
    });

    // Shutdown batch insert queue
    await shutdownBatchInsertQueue();
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}

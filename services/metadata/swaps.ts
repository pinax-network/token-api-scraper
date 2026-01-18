import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import { CONCURRENCY, getNetwork } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { initService } from '../../lib/service-init';
import { processMetadata } from '.';

const serviceName = 'metadata-swaps';
const log = createLogger(serviceName);

export async function run() {
    // Initialize service (must be called before using batch insert queue)
    initService({ serviceName });

    // Validate network is set
    const network = getNetwork();

    const queue = new PQueue({ concurrency: CONCURRENCY });

    const contracts = await query<{
        contract: string;
        block_num: number;
        block_hash: string;
        timestamp: number;
    }>(await Bun.file(__dirname + '/get_contracts_by_swaps.sql').text());

    if (contracts.data.length > 0) {
        log.info('Processing contracts metadata', {
            contractCount: contracts.data.length,
            firstBlockNum: contracts.data[0]?.block_num ?? 'N/A',
            source: 'swaps',
        });
    } else {
        log.info('No contracts to process');
        return;
    }

    // Process all contracts
    for (const { contract, block_num, timestamp } of contracts.data) {
        queue.add(async () => {
            await processMetadata(
                network,
                contract,
                block_num,
                timestamp,
                serviceName,
            );
        });
    }

    // Wait for all tasks to complete
    await queue.onIdle();

    log.info('Service completed', {
        contractsProcessed: contracts.data.length,
    });

    // Shutdown batch insert queue
    await shutdownBatchInsertQueue();
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}

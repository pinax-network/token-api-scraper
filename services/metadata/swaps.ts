import PQueue from 'p-queue';
import { shutdownBatchInsertQueue } from '../../lib/batch-insert';
import { query } from '../../lib/clickhouse';
import { CONCURRENCY, NETWORK } from '../../lib/config';
import { createLogger } from '../../lib/logger';
import { initService } from '../../lib/service-init';
import { processMetadata } from '.';

const log = createLogger('metadata-swaps');
const SERVICE_NAME = 'Token Metadata by Swaps';

export async function run() {
    // Initialize service (must be called before using batch insert queue)
    initService({ serviceName: 'metadata RPC service' });

    const queue = new PQueue({ concurrency: CONCURRENCY });

    const contracts = await query<{ contract: string; block_num: number }>(
        await Bun.file(__dirname + '/get_contracts_by_swaps.sql').text(),
    );

    log.info('Found contracts to scrape', {
        count: contracts.data.length,
        blockNum: contracts.data?.[0]?.block_num ?? 'N/A',
        source: 'swaps',
    });

    // Process all contracts
    for (const { contract, block_num } of contracts.data) {
        queue.add(async () => {
            await processMetadata(NETWORK, contract, block_num, SERVICE_NAME);
        });
    }

    // Wait for all tasks to complete
    await queue.onIdle();

    log.info('Service completed');

    // Shutdown batch insert queue
    await shutdownBatchInsertQueue();
}

// Run the service if this is the main module
if (import.meta.main) {
    await run();
}
